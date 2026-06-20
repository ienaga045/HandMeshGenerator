import {
  BONE_CONNECTIONS,
  DEFAULT_LANDMARKS,
  DEFAULT_SETTINGS,
  buildMeshFromRawLandmarks,
  expectedDefaultCounts,
} from "./meshGenerator.js";
import { downloadText, meshToObj, timestampForFilename } from "./objExporter.js";
import { renderBonePreview } from "./previewRenderer.js";

const STORAGE_KEY = "hand-base-mesh-js-settings-v1";
const MEDIAPIPE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MEDIAPIPE_BUNDLE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";
const HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const elements = {
  modeManual: document.querySelector("#mode-manual"),
  modeWebcam: document.querySelector("#mode-webcam"),
  cameraPanel: document.querySelector("#camera-panel"),
  cameraSelect: document.querySelector("#camera-select"),
  facingMode: document.querySelector("#facing-mode"),
  targetHand: document.querySelector("#target-hand"),
  startCamera: document.querySelector("#start-camera"),
  stopCamera: document.querySelector("#stop-camera"),
  captureCamera: document.querySelector("#capture-camera"),
  video: document.querySelector("#camera-video"),
  overlay: document.querySelector("#camera-overlay"),
  fingerWidth: document.querySelector("#finger-width"),
  palmThickness: document.querySelector("#palm-thickness"),
  jointRadius: document.querySelector("#joint-radius"),
  fingerWidthValue: document.querySelector("#finger-width-value"),
  palmThicknessValue: document.querySelector("#palm-thickness-value"),
  jointRadiusValue: document.querySelector("#joint-radius-value"),
  landmarks: document.querySelector("#landmarks-json"),
  resetLandmarks: document.querySelector("#reset-landmarks"),
  generate: document.querySelector("#generate"),
  download: document.querySelector("#download"),
  objOutput: document.querySelector("#obj-output"),
  status: document.querySelector("#status"),
  stats: document.querySelector("#stats"),
  canvas: document.querySelector("#bone-preview"),
};

let currentObj = "";
let currentMesh = null;
let handLandmarker = null;
let cameraStream = null;
let animationId = 0;
let lastVideoTime = -1;
let latestDetectedLandmarks = null;
let inputMode = "manual";

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      fingerWidth: Number(saved.fingerWidth ?? DEFAULT_SETTINGS.fingerWidth),
      palmThickness: Number(saved.palmThickness ?? DEFAULT_SETTINGS.palmThickness),
      jointRadius: Number(saved.jointRadius ?? DEFAULT_SETTINGS.jointRadius),
      landmarks: saved.landmarks ?? DEFAULT_LANDMARKS,
      inputMode: saved.inputMode ?? "manual",
      targetHand: saved.targetHand ?? "Any",
      facingMode: saved.facingMode ?? "user",
    };
  } catch {
    return { ...DEFAULT_SETTINGS, landmarks: DEFAULT_LANDMARKS, inputMode: "manual", targetHand: "Any", facingMode: "user" };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function sliderSettings() {
  return {
    fingerWidth: Number(elements.fingerWidth.value),
    palmThickness: Number(elements.palmThickness.value),
    jointRadius: Number(elements.jointRadius.value),
  };
}

function safeCurrentLandmarks() {
  try {
    return parseLandmarks();
  } catch {
    return DEFAULT_LANDMARKS;
  }
}

function updateSliderLabels() {
  elements.fingerWidthValue.textContent = elements.fingerWidth.value;
  elements.palmThicknessValue.textContent = elements.palmThickness.value;
  elements.jointRadiusValue.textContent = elements.jointRadius.value;
}

function parseLandmarks() {
  const parsed = JSON.parse(elements.landmarks.value);
  if (!Array.isArray(parsed) || parsed.length !== 21) {
    throw new Error("landmarks must be an array of 21 [x, y, z] points");
  }
  return parsed.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 3) {
      throw new Error(`landmark ${index} must be [x, y, z]`);
    }
    return point.map((value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`landmark ${index} has a non-numeric value`);
      return number;
    });
  });
}

function renderStats(mesh) {
  const expected = expectedDefaultCounts();
  const vertexOk = mesh.vertices.length === expected.vertices;
  const faceOk = mesh.faces.length === expected.faces;
  elements.stats.innerHTML = `
    <span>vertices: <strong>${mesh.vertices.length}</strong> / expected ${expected.vertices}</span>
    <span>faces: <strong>${mesh.faces.length}</strong> / expected ${expected.faces}</span>
    <span class="${vertexOk && faceOk ? "ok" : "warn"}">${vertexOk && faceOk ? "Python topology match" : "Topology mismatch"}</span>
  `;
}

function generate(statusMessage = "OBJ generated from manual landmarks.") {
  try {
    updateSliderLabels();
    const landmarks = parseLandmarks();
    const settings = sliderSettings();
    const { mesh, normalizedLandmarks } = buildMeshFromRawLandmarks(landmarks, settings);
    currentMesh = mesh;
    currentObj = meshToObj(mesh);
    elements.objOutput.value = currentObj;
    renderBonePreview(elements.canvas, normalizedLandmarks);
    renderStats(mesh);
    saveSettings({
      ...settings,
      landmarks,
      inputMode,
      targetHand: elements.targetHand.value,
      facingMode: elements.facingMode.value,
    });
    elements.status.textContent = statusMessage;
    elements.download.disabled = false;
  } catch (error) {
    elements.status.textContent = `Error: ${error.message}`;
    elements.download.disabled = true;
  }
}

function downloadObj() {
  if (!currentObj || !currentMesh) return;
  downloadText(`hand_base_mesh_${timestampForFilename()}.obj`, currentObj, "text/plain");
}

async function initializeHandLandmarker() {
  if (handLandmarker) return handLandmarker;
  elements.status.textContent = "Loading MediaPipe Hand Landmarker...";
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
  clearOverlay();
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
    elements.status.textContent = "このブラウザはカメラ入力に対応していません。";
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
    elements.status.textContent = "Camera running. 手をカメラに映してください。";
    detectLoop();
  } catch (error) {
    stopCamera();
    elements.status.textContent = `Camera error: ${error.message}`;
  }
}

function selectTargetHand(results) {
  const landmarksList = results.landmarks ?? [];
  if (landmarksList.length === 0) return null;
  const handednessList = results.handednesses ?? results.handedness ?? [];
  const target = elements.targetHand.value;
  let bestIndex = 0;
  let bestScore = -Infinity;
  const imageCenter = [0.5, 0.5];

  landmarksList.forEach((landmarks, index) => {
    const handedness = handednessList[index]?.[0];
    const label = handedness?.categoryName ?? handedness?.displayName ?? "";
    if (target !== "Any" && label !== target) return;
    const confidence = Number(handedness?.score ?? 0);
    const center = landmarks.reduce((acc, point) => [acc[0] + point.x, acc[1] + point.y], [0, 0]).map((value) => value / landmarks.length);
    const distance = Math.hypot(center[0] - imageCenter[0], center[1] - imageCenter[1]);
    const score = confidence - distance * 0.25;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestScore === -Infinity) return null;
  return landmarksList[bestIndex].map((point) => [point.x, point.y, point.z]);
}

function detectLoop() {
  if (!cameraStream || !handLandmarker) return;
  if (elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && elements.video.currentTime !== lastVideoTime) {
    const results = handLandmarker.detectForVideo(elements.video, performance.now());
    latestDetectedLandmarks = selectTargetHand(results);
    drawCameraOverlay(latestDetectedLandmarks);
    elements.captureCamera.disabled = !latestDetectedLandmarks;
    lastVideoTime = elements.video.currentTime;
  }
  animationId = requestAnimationFrame(detectLoop);
}

function clearOverlay() {
  const ctx = elements.overlay.getContext("2d");
  ctx.clearRect(0, 0, elements.overlay.width, elements.overlay.height);
}

function drawCameraOverlay(landmarks) {
  const videoWidth = elements.video.videoWidth || 640;
  const videoHeight = elements.video.videoHeight || 480;
  if (elements.overlay.width !== videoWidth || elements.overlay.height !== videoHeight) {
    elements.overlay.width = videoWidth;
    elements.overlay.height = videoHeight;
  }

  const ctx = elements.overlay.getContext("2d");
  ctx.clearRect(0, 0, videoWidth, videoHeight);
  if (!landmarks) return;

  const points = landmarks.map((point) => [(1 - point[0]) * videoWidth, point[1] * videoHeight]);
  ctx.lineCap = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ffd400";
  for (const [a, b] of BONE_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(points[a][0], points[a][1]);
    ctx.lineTo(points[b][0], points[b][1]);
    ctx.stroke();
  }
  points.forEach((point, index) => {
    ctx.fillStyle = index === 0 ? "#ffd45a" : "#4cff63";
    ctx.beginPath();
    ctx.arc(point[0], point[1], index === 0 ? 6 : 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function captureCameraPose() {
  if (!latestDetectedLandmarks) {
    elements.status.textContent = "手が検出されていません。";
    return;
  }
  elements.landmarks.value = JSON.stringify(latestDetectedLandmarks, null, 2);
  generate("OBJ generated from webcam capture.");
}

function setInputMode(nextMode) {
  inputMode = nextMode;
  elements.cameraPanel.hidden = inputMode !== "webcam";
  if (inputMode !== "webcam") {
    stopCamera();
    generate();
  } else {
    saveSettings({
      ...sliderSettings(),
      landmarks: safeCurrentLandmarks(),
      inputMode,
      targetHand: elements.targetHand.value,
      facingMode: elements.facingMode.value,
    });
    elements.status.textContent = "Webcam Captureを開始するには Start Camera を押してください。";
  }
}

function initialize() {
  const settings = loadSettings();
  inputMode = settings.inputMode;
  elements.modeManual.checked = inputMode === "manual";
  elements.modeWebcam.checked = inputMode === "webcam";
  elements.cameraPanel.hidden = inputMode !== "webcam";
  elements.targetHand.value = settings.targetHand;
  elements.facingMode.value = settings.facingMode;
  elements.fingerWidth.value = settings.fingerWidth;
  elements.palmThickness.value = settings.palmThickness;
  elements.jointRadius.value = settings.jointRadius;
  elements.landmarks.value = JSON.stringify(settings.landmarks, null, 2);
  updateSliderLabels();

  for (const input of [elements.fingerWidth, elements.palmThickness, elements.jointRadius]) {
    input.addEventListener("input", generate);
  }
  elements.landmarks.addEventListener("change", generate);
  elements.generate.addEventListener("click", generate);
  elements.download.addEventListener("click", downloadObj);
  elements.modeManual.addEventListener("change", () => setInputMode("manual"));
  elements.modeWebcam.addEventListener("change", () => setInputMode("webcam"));
  elements.startCamera.addEventListener("click", startCamera);
  elements.stopCamera.addEventListener("click", stopCamera);
  elements.captureCamera.addEventListener("click", captureCameraPose);
  elements.cameraSelect.addEventListener("change", () => {
    if (cameraStream) startCamera();
  });
  elements.facingMode.addEventListener("change", () => {
    if (cameraStream) startCamera();
  });
  elements.targetHand.addEventListener("change", () => saveSettings({
    ...sliderSettings(),
    landmarks: safeCurrentLandmarks(),
    inputMode,
    targetHand: elements.targetHand.value,
    facingMode: elements.facingMode.value,
  }));
  elements.resetLandmarks.addEventListener("click", () => {
    elements.landmarks.value = JSON.stringify(DEFAULT_LANDMARKS, null, 2);
    generate();
  });

  refreshCameraList().catch(() => {});
  generate();
}

initialize();
