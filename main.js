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
const MEDIAPIPE_BUNDLE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";
const HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const PRESETS = {
  standard: { fingerLength: 100, fingerWidth: 80, palmThickness: 100, jointRadius: 100 },
  wide: { fingerLength: 100, fingerWidth: 105, palmThickness: 105, jointRadius: 100 },
  thickPalm: { fingerLength: 100, fingerWidth: 80, palmThickness: 130, jointRadius: 100 },
  slim: { fingerLength: 100, fingerWidth: 65, palmThickness: 85, jointRadius: 90 },
  longFinger: { fingerLength: 120, fingerWidth: 75, palmThickness: 95, jointRadius: 95 },
  smallJoint: { fingerLength: 100, fingerWidth: 80, palmThickness: 100, jointRadius: 75 },
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
  download: document.querySelector("#download"),
  reset: document.querySelector("#reset"),
  status: document.querySelector("#status"),
  fingerLength: document.querySelector("#finger-length"),
  fingerWidth: document.querySelector("#finger-width"),
  jointRadius: document.querySelector("#joint-radius"),
  palmThickness: document.querySelector("#palm-thickness"),
  presetButtons: [...document.querySelectorAll(".preset-button")],
};

let handLandmarker = null;
let cameraStream = null;
let animationId = 0;
let lastVideoTime = -1;
let latestDetectedLandmarks = null;
let heldLandmarks = null;
let currentObj = "";
let currentSettings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      fingerLength: Number(saved.fingerLength ?? 100),
      fingerWidth: Number(saved.fingerWidth ?? DEFAULT_SETTINGS.fingerWidth),
      palmThickness: Number(saved.palmThickness ?? DEFAULT_SETTINGS.palmThickness),
      jointRadius: Number(saved.jointRadius ?? DEFAULT_SETTINGS.jointRadius),
      targetHand: saved.targetHand === "Left" ? "Left" : "Right",
      facingMode: saved.facingMode ?? "user",
    };
  } catch {
    return { fingerLength: 100, ...DEFAULT_SETTINGS, targetHand: "Right", facingMode: "user" };
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

function sliderSettings() {
  return {
    fingerLength: Number(elements.fingerLength.value),
    fingerWidth: Number(elements.fingerWidth.value),
    palmThickness: Number(elements.palmThickness.value),
    jointRadius: Number(elements.jointRadius.value),
  };
}

function syncSlidersFromSettings() {
  elements.fingerLength.value = currentSettings.fingerLength;
  elements.fingerWidth.value = currentSettings.fingerWidth;
  elements.palmThickness.value = currentSettings.palmThickness;
  elements.jointRadius.value = currentSettings.jointRadius;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function cameraErrorMessage(error) {
  if (!window.isSecureContext) {
    return "HTTPSまたはlocalhostで開いてください";
  }
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "カメラ使用が許可されていません";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "使用できるカメラが見つかりません";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "他のアプリがカメラを使用中の可能性があります";
  }
  if (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError") {
    return "選択したカメラ条件で起動できません";
  }
  return `Camera error: ${error.message}`;
}

function adjustedLandmarks(rawLandmarks) {
  const scale = Number(currentSettings.fingerLength ?? 100) / 100;
  if (Math.abs(scale - 1) < 1e-6) {
    return rawLandmarks.map((point) => [...point]);
  }

  const adjusted = rawLandmarks.map((point) => [...point]);
  const chains = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ];

  for (const chain of chains) {
    const base = rawLandmarks[chain[0]];
    for (const index of chain.slice(1)) {
      adjusted[index] = [
        base[0] + (rawLandmarks[index][0] - base[0]) * scale,
        base[1] + (rawLandmarks[index][1] - base[1]) * scale,
        base[2] + (rawLandmarks[index][2] - base[2]) * scale,
      ];
    }
  }
  return adjusted;
}

function withTimeout(promise, milliseconds, label) {
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

async function initializeHandLandmarker() {
  if (handLandmarker) return handLandmarker;
  setStatus("MediaPipeライブラリを読み込み中...");
  const { FilesetResolver, HandLandmarker } = await withTimeout(import(MEDIAPIPE_BUNDLE_URL), 45000, "MediaPipe library load");
  setStatus("MediaPipeモデルを読み込み中...");
  const vision = await withTimeout(FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL), 45000, "MediaPipe wasm load");
  handLandmarker = await withTimeout(HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }), 45000, "Hand model load");
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

async function requestCameraStream() {
  try {
    return await navigator.mediaDevices.getUserMedia(cameraConstraints());
  } catch (firstError) {
    if (elements.cameraSelect.value) {
      throw firstError;
    }
    setStatus("標準カメラで再試行中...");
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (fallbackError) {
      fallbackError.message = `${firstError.message} / fallback: ${fallbackError.message}`;
      throw fallbackError;
    }
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("このブラウザはカメラ入力に対応していません");
    return;
  }

  try {
    stopCamera(false);
    heldLandmarks = null;
    currentObj = "";
    elements.download.disabled = true;
    setStatus("カメラ起動中...");
    cameraStream = await requestCameraStream();
    elements.video.srcObject = cameraStream;
    elements.video.muted = true;
    elements.video.playsInline = true;
    await elements.video.play();
    await refreshCameraList();
    elements.startCamera.disabled = true;
    elements.stopCamera.disabled = false;
    await initializeHandLandmarker();
    setStatus("手をカメラに映してください");
    detectLoop();
  } catch (error) {
    stopCamera(false);
    setStatus(cameraErrorMessage(error));
  }
}

function stopCamera(freezePose = true) {
  if (freezePose && latestDetectedLandmarks) {
    heldLandmarks = latestDetectedLandmarks.map((point) => [...point]);
    buildCurrentObj(heldLandmarks);
    setStatus("停止しました。この手の形状でOBJを作成できます");
  } else if (freezePose) {
    setStatus("手が検出されていません");
  }

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
  return aspectCorrectLandmarks(landmarksList[bestIndex]);
}

function currentVideoAspect() {
  const width = Number(elements.video.videoWidth || 0);
  const height = Number(elements.video.videoHeight || 0);
  if (width <= 0 || height <= 0) return 1;
  return width / height;
}

function aspectCorrectLandmarks(landmarks) {
  const aspect = currentVideoAspect();
  // MediaPipe x is normalized by image width while y is normalized by image height.
  // Convert x and z into image-height units so portrait iPhone cameras do not
  // stretch the generated hand mesh sideways.
  return landmarks.map((point) => [
    point.x * aspect,
    point.y,
    point.z * aspect,
  ]);
}

function detectLoop() {
  if (!cameraStream || !handLandmarker) return;
  if (elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && elements.video.currentTime !== lastVideoTime) {
    try {
      const results = handLandmarker.detectForVideo(elements.video, performance.now());
      latestDetectedLandmarks = selectTargetHand(results);
      if (latestDetectedLandmarks) {
        renderBonePreview(elements.canvas, normalizeLandmarksForObj(adjustedLandmarks(latestDetectedLandmarks)));
        setStatus(`${targetHand() === "Right" ? "右手" : "左手"}を検出中`);
      }
      lastVideoTime = elements.video.currentTime;
    } catch (error) {
      setStatus(`Detection error: ${error.message}`);
    }
  }
  animationId = requestAnimationFrame(detectLoop);
}

function buildCurrentObj(landmarks) {
  const sourceLandmarks = adjustedLandmarks(landmarks);
  const { mesh, normalizedLandmarks } = buildMeshFromRawLandmarks(sourceLandmarks, currentSettings);
  currentObj = meshToObj(mesh);
  renderBonePreview(elements.canvas, normalizedLandmarks);
  elements.download.disabled = false;
}

function downloadObj() {
  if (!heldLandmarks) {
    setStatus("先に停止して手の形状を固定してください");
    return;
  }
  buildCurrentObj(heldLandmarks);
  downloadText(`hand_base_mesh_${timestampForFilename()}.obj`, currentObj, "text/plain");
  setStatus("OBJを保存しました");
}

function applyPreset(name) {
  currentSettings = { ...(PRESETS[name] ?? PRESETS.standard) };
  syncSlidersFromSettings();
  if (heldLandmarks) {
    buildCurrentObj(heldLandmarks);
  } else if (latestDetectedLandmarks) {
    renderBonePreview(elements.canvas, normalizeLandmarksForObj(adjustedLandmarks(latestDetectedLandmarks)));
  }
  saveSettings();
}

function resetApp() {
  heldLandmarks = null;
  currentObj = "";
  currentSettings = { ...PRESETS.standard };
  syncSlidersFromSettings();
  elements.download.disabled = true;
  renderBonePreview(elements.canvas, normalizeLandmarksForObj(DEFAULT_LANDMARKS));
  setStatus("Ready");
  saveSettings();
}

function initialize() {
  const settings = loadSettings();
  currentSettings = {
    fingerLength: settings.fingerLength,
    fingerWidth: settings.fingerWidth,
    palmThickness: settings.palmThickness,
    jointRadius: settings.jointRadius,
  };
  syncSlidersFromSettings();
  elements.handRight.checked = settings.targetHand !== "Left";
  elements.handLeft.checked = settings.targetHand === "Left";
  elements.facingMode.value = settings.facingMode;

  elements.startCamera.addEventListener("click", startCamera);
  elements.stopCamera.addEventListener("click", () => stopCamera(true));
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
  for (const slider of [elements.fingerLength, elements.fingerWidth, elements.jointRadius, elements.palmThickness]) {
    slider.addEventListener("input", () => {
      currentSettings = sliderSettings();
      if (heldLandmarks) {
        buildCurrentObj(heldLandmarks);
      } else if (latestDetectedLandmarks) {
        renderBonePreview(elements.canvas, normalizeLandmarksForObj(adjustedLandmarks(latestDetectedLandmarks)));
      }
      saveSettings();
    });
  }
  elements.presetButtons.forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  refreshCameraList().catch(() => {});
  renderBonePreview(elements.canvas, normalizeLandmarksForObj(DEFAULT_LANDMARKS));
  setStatus("Ready");
}

initialize();
