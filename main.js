import {
  DEFAULT_LANDMARKS,
  DEFAULT_SETTINGS,
  buildMeshFromRawLandmarks,
  expectedDefaultCounts,
} from "./meshGenerator.js";
import { downloadText, meshToObj, timestampForFilename } from "./objExporter.js";
import { renderBonePreview } from "./previewRenderer.js";

const STORAGE_KEY = "hand-base-mesh-js-settings-v1";

const elements = {
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

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      fingerWidth: Number(saved.fingerWidth ?? DEFAULT_SETTINGS.fingerWidth),
      palmThickness: Number(saved.palmThickness ?? DEFAULT_SETTINGS.palmThickness),
      jointRadius: Number(saved.jointRadius ?? DEFAULT_SETTINGS.jointRadius),
      landmarks: saved.landmarks ?? DEFAULT_LANDMARKS,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, landmarks: DEFAULT_LANDMARKS };
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

function generate() {
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
    saveSettings({ ...settings, landmarks });
    elements.status.textContent = "OBJ generated from manual landmarks.";
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

function initialize() {
  const settings = loadSettings();
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
  elements.resetLandmarks.addEventListener("click", () => {
    elements.landmarks.value = JSON.stringify(DEFAULT_LANDMARKS, null, 2);
    generate();
  });

  generate();
}

initialize();
