import {
  DEFAULT_LANDMARKS,
  DEFAULT_SETTINGS,
  buildMeshFromRawLandmarks,
  normalizeLandmarksForObj,
} from "./meshGenerator.js";
import { downloadText, meshToObj, timestampForFilename } from "./objExporter.js";
import { renderBonePreview } from "./previewRenderer.js";

const STORAGE_KEY = "hand-base-mesh-webcam-settings-v2";
const MEDIAPIPE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MEDIAPIPE_BUNDLE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";
const HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const PRESETS = {
  standard: { fingerWidth: 80, palmThickness: 100, jointRadius: 100 },
  wide: { fingerWidth: 105, palmThickness: 105, jointRadius: 100 },
  thickPalm: { fingerWidth: 80, palmThickness: 130, jointRadius: 100 },
  slim: { fingerWidth: 65, palmThickness: 85, jointRadius: 90 },
  longFinger: { fingerWidth: 75, palmThickness: 95, jointRadius: 95 },
  smallJoint: { fingerWidth: 80, palmThickness: 100, jointRadius: 75 },
};

const elements = {
  video: document.querySelector("#camera-video"),
  canvas: document.querySelector("#bone-preview"),
  cameraSelect: document.querySelector("#camera-select"),
  facingMode: document.querySelector("#facing-mode"),
  handRight: document.querySelector("#hand-right"),
  handLeft: document.querySelector("#hand-left"),
  startCamera: document.querySelector("#start-camera"),
  stopCamera: document.querySelector("#stop-camera"),
  captureCamera: document.querySelector("#capture-camera"),
  download: document.querySelector("#download"),
  reset: document.querySelector("#reset"),
  status: document.querySelector("#status"),
  presetButtons: [...document.querySelectorAll(".preset-button")],
};

let handLandmarker = null;
let cameraStream = null;
let animationId = 0;
let lastVideoTime = -1;
let latestDetectedLandmarks = null;
let capturedLandmarks = null;
let currentObj = "";
let currentSettings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      fingerWidth: Number(saved.fingerWidth ?? DEFAULT_SETTINGS.fingerWidth),
      palmThickness: Number(saved.palmThickness ?? DEFAULT_SETTINGS.palmThickness),
      jointRadius: Number(saved.jointRadius ?? DEFAULT_SETTINGS.jointRadius),
      targetHand: saved.targetHand === "Left" ? "Left" : "Right",
      facingMode: saved.facingMode ?? "user",
    };
  } catch {
    return { ...DEFAULT_SETTINGS, targetHand: "Right", facingMode: "user" };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...currentSettings,
    targetHand: targetHand(),
    facingMode: elements.facingMode.value,
  }));
}

function targetHand() {
  return elements.handLeft.checked ? "Left" : "Right";
}

function setStatus(message) {
  elements.status.textContent = message;
}

async function initializeHandLandmarker() {
  if (handLandmarker) return handLandmarker;
  setStatus("Loading MediaPipe...");
  const { FilesetResolver, HandLandmarker } = await import(MEDIAPIPE_BUNDLE_URL);
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return handLandmarker;
}

async function refreshCameraList() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const previous = elements.cameraSelect.value;
  elements.cameraSelect.innerHTML = '<option value="">Default / In Camera</option>';
  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || `Camera ${index + 1}`;
    elements.cameraSelect.appendChild(option);
  });
  if ([...elements.cameraSelect.options].some((option) => option.value === previous)) {
    elements.cameraSelect.value = previous;
  }
}

function cameraConstraints() {
  const selectedDeviceId = elements.cameraSelect.value;
  if (selectedDeviceId) {
    return {
      video: {
        deviceId: { exact: selectedDeviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };
  }
  return {
    video: {
      facingMode: { ideal: elements.facingMode.value },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("このブラウザはカメラ入力に対応していません");
    return;
  }

  try {
    await initializeHandLandmarker();
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
    elements.video.srcObject = cameraStream;
    await elements.video.play();
    await refreshCameraList();
    elements.startCamera.disabled = true;
    elements.stopCamera.disabled = false;
    elements.captureCamera.disabled = true;
    setStatus("手をカメラに映してください");
    detectLoop();
  } catch (error) {
    stopCamera();
    setStatus(`Camera error: ${error.message}`);
  }
}

function stopCamera() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = 0;
  }
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  elements.video.srcObject = null;
  latestDetectedLandmarks = null;
  lastVideoTime = -1;
  elements.startCamera.disabled = false;
  elements.stopCamera.disabled = true;
  elements.captureCamera.disabled = true;
}

function selectTargetHand(results) {
  const landmarksList = results.landmarks ?? [];
  if (landmarksList.length === 0) return null;
  const handednessList = results.handednesses ?? results.handedness ?? [];
  const wanted = targetHand();
  let bestIndex = -1;
  let bestScore = -Infinity;
  const imageCenter = [0.5, 0.5];

  landmarksList.forEach((landmarks, index) => {
    const handedness = handednessList[index]?.[0];
    const label = handedness?.categoryName ?? handedness?.displayName ?? "";
    if (label && label !== wanted) return;
    const confidence = Number(handedness?.score ?? 0);
    const center = landmarks.reduce((acc, point) => [acc[0] + point.x, acc[1] + point.y], [0, 0]).map((value) => value / landmarks.length);
    const distance = Math.hypot(center[0] - imageCenter[0], center[1] - imageCenter[1]);
    const score = confidence - distance * 0.25;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex < 0) return null;
  return landmarksList[bestIndex].map((point) => [point.x, point.y, point.z]);
}

function detectLoop() {
  if (!cameraStream || !handLandmarker) return;
  if (elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && elements.video.currentTime !== lastVideoTime) {
    const results = handLandmarker.detectForVideo(elements.video, performance.now());
    latestDetectedLandmarks = selectTargetHand(results);
    elements.captureCamera.disabled = !latestDetectedLandmarks;
    if (latestDetectedLandmarks) {
      renderBonePreview(elements.canvas, normalizeLandmarksForObj(latestDetectedLandmarks));
      setStatus(`${targetHand() === "Right" ? "右手" : "左手"}を検出中`);
    }
    lastVideoTime = elements.video.currentTime;
  }
  animationId = requestAnimationFrame(detectLoop);
}

function buildCurrentObj(landmarks) {
  const { mesh, normalizedLandmarks } = buildMeshFromRawLandmarks(landmarks, currentSettings);
  currentObj = meshToObj(mesh);
  renderBonePreview(elements.canvas, normalizedLandmarks);
  elements.download.disabled = false;
}

function capturePose() {
  if (!latestDetectedLandmarks) {
    setStatus("手が検出されていません");
    return;
  }
  capturedLandmarks = latestDetectedLandmarks.map((point) => [...point]);
  buildCurrentObj(capturedLandmarks);
  setStatus("撮影しました");
}

function downloadObj() {
  if (!capturedLandmarks) {
    if (!latestDetectedLandmarks) {
      setStatus("手が検出されていません");
      return;
    }
    capturedLandmarks = latestDetectedLandmarks.map((point) => [...point]);
    buildCurrentObj(capturedLandmarks);
  }
  downloadText(`hand_base_mesh_${timestampForFilename()}.obj`, currentObj, "text/plain");
  setStatus("OBJを保存しました");
}

function applyPreset(name) {
  currentSettings = { ...(PRESETS[name] ?? PRESETS.standard) };
  if (capturedLandmarks) {
    buildCurrentObj(capturedLandmarks);
  } else if (latestDetectedLandmarks) {
    renderBonePreview(elements.canvas, normalizeLandmarksForObj(latestDetectedLandmarks));
  }
  saveSettings();
}

function resetApp() {
  capturedLandmarks = null;
  currentObj = "";
  currentSettings = { ...PRESETS.standard };
  elements.download.disabled = true;
  renderBonePreview(elements.canvas, normalizeLandmarksForObj(DEFAULT_LANDMARKS));
  setStatus("Ready");
  saveSettings();
}

function initialize() {
  const settings = loadSettings();
  currentSettings = {
    fingerWidth: settings.fingerWidth,
    palmThickness: settings.palmThickness,
    jointRadius: settings.jointRadius,
  };
  elements.handRight.checked = settings.targetHand !== "Left";
  elements.handLeft.checked = settings.targetHand === "Left";
  elements.facingMode.value = settings.facingMode;

  elements.startCamera.addEventListener("click", startCamera);
  elements.stopCamera.addEventListener("click", stopCamera);
  elements.captureCamera.addEventListener("click", capturePose);
  elements.download.addEventListener("click", downloadObj);
  elements.reset.addEventListener("click", resetApp);
  elements.cameraSelect.addEventListener("change", () => {
    if (cameraStream) startCamera();
  });
  elements.facingMode.addEventListener("change", () => {
    saveSettings();
    if (cameraStream) startCamera();
  });
  elements.handRight.addEventListener("change", saveSettings);
  elements.handLeft.addEventListener("change", saveSettings);
  elements.presetButtons.forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  refreshCameraList().catch(() => {});
  renderBonePreview(elements.canvas, normalizeLandmarksForObj(DEFAULT_LANDMARKS));
  setStatus("Ready");
}

initialize();
