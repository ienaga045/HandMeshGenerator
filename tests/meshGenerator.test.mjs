import assert from "node:assert/strict";
import {
  DEFAULT_LANDMARKS,
  DEFAULT_SETTINGS,
  BONE_CONNECTIONS,
  LANDMARK_NAMES,
  buildMeshFromRawLandmarks,
  expectedDefaultCounts,
  generateUvSphere,
  normalizeLandmarksForObj,
} from "../meshGenerator.js";
import { meshToObj } from "../objExporter.js";

const { mesh } = buildMeshFromRawLandmarks(DEFAULT_LANDMARKS, DEFAULT_SETTINGS);
const expected = expectedDefaultCounts();
const normalized = normalizeLandmarksForObj(DEFAULT_LANDMARKS);

assert.equal(BONE_CONNECTIONS.length, 24, "Python version uses 24 bone prism connections");
assert.equal(LANDMARK_NAMES.length, 21, "Python version uses 21 MediaPipe landmarks");
assert.deepEqual(normalized[0], [0, 0, 0], "wrist must be normalized to the OBJ origin");
assert.ok(normalized[5][1] > 0, "index_mcp should be above wrist after Python-compatible y inversion");
assert.equal(mesh.vertices.length, expected.vertices, "default vertex count must match Python topology");
assert.equal(mesh.faces.length, expected.faces, "default face count must match Python topology");
assert.equal(expected.vertices, 1212, "default topology vertex count");
assert.equal(expected.faces, 992, "default topology face count");

const sphere = generateUvSphere([0, 0, 0], 1, 5, 8);
assert.equal(sphere.vertices.length, 48, "Python UV sphere vertex count");
assert.equal(sphere.faces.length, 40, "Python UV sphere face count");

const obj = meshToObj(mesh);
assert.equal((obj.match(/^v /gm) || []).length, 1212, "OBJ vertex lines");
assert.equal((obj.match(/^f /gm) || []).length, 992, "OBJ face lines");
assert.ok(obj.includes("o hand_base_mesh"), "OBJ object name");

console.log("meshGenerator parity tests passed");
