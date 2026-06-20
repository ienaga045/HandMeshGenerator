export const LANDMARK_NAMES = [
  "wrist",
  "thumb_cmc",
  "thumb_mcp",
  "thumb_ip",
  "thumb_tip",
  "index_mcp",
  "index_pip",
  "index_dip",
  "index_tip",
  "middle_mcp",
  "middle_pip",
  "middle_dip",
  "middle_tip",
  "ring_mcp",
  "ring_pip",
  "ring_dip",
  "ring_tip",
  "pinky_mcp",
  "pinky_pip",
  "pinky_dip",
  "pinky_tip",
];

export const BONE_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
  [1, 5],
];

const FINGER_LANDMARKS = {
  thumb: new Set([1, 2, 3, 4]),
  index: new Set([5, 6, 7, 8]),
  middle: new Set([9, 10, 11, 12]),
  ring: new Set([13, 14, 15, 16]),
  pinky: new Set([17, 18, 19, 20]),
};

export const DEFAULT_SETTINGS = {
  fingerWidth: 80,
  palmThickness: 100,
  jointRadius: 100,
};

// Manual mode uses a fixed MediaPipe-like 21-point pose. Future webcam mode can
// replace this array with actual Hand Landmarker output without changing the mesh code.
export const DEFAULT_LANDMARKS = [
  [0.500, 0.860, 0.000],
  [0.390, 0.725, -0.030],
  [0.315, 0.620, -0.055],
  [0.265, 0.535, -0.075],
  [0.215, 0.465, -0.095],
  [0.420, 0.600, -0.020],
  [0.392, 0.455, -0.045],
  [0.382, 0.350, -0.065],
  [0.374, 0.250, -0.082],
  [0.505, 0.575, -0.012],
  [0.505, 0.415, -0.035],
  [0.505, 0.295, -0.052],
  [0.505, 0.185, -0.070],
  [0.590, 0.600, -0.020],
  [0.622, 0.460, -0.045],
  [0.640, 0.358, -0.064],
  [0.655, 0.265, -0.080],
  [0.665, 0.650, -0.035],
  [0.720, 0.545, -0.060],
  [0.755, 0.465, -0.078],
  [0.785, 0.390, -0.095],
];

export function cloneLandmarks(landmarks) {
  return landmarks.map((p) => [Number(p[0]), Number(p[1]), Number(p[2])]);
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a, fallback = [0, 0, 1]) {
  const length = norm(a);
  if (length < 1e-8) return [...fallback];
  return mul(a, 1 / length);
}

export function normalizeLandmarksForObj(landmarks) {
  const coords = cloneLandmarks(landmarks);
  for (const point of coords) {
    point[1] *= -1;
  }
  const origin = [...coords[0]];
  for (const point of coords) {
    point[0] -= origin[0];
    point[1] -= origin[1];
    point[2] -= origin[2];
  }

  const scaleSegments = [
    [0, 9],
    [9, 10],
    [10, 11],
    [11, 12],
  ];
  let handLength = 0;
  for (const [a, b] of scaleSegments) {
    handLength += norm(sub(coords[b], coords[a]));
  }
  if (handLength < 1e-5) handLength = 1;

  return coords.map((point) => mul(point, 1 / handLength));
}

function landmarkFinger(index) {
  for (const [finger, indexes] of Object.entries(FINGER_LANDMARKS)) {
    if (indexes.has(index)) return finger;
  }
  return "palm";
}

export function radiusForLandmark(index, jointRadiusScale = 1) {
  if (index === 0) return 0.13 * jointRadiusScale;
  if ([5, 9, 13, 17, 1].includes(index)) return 0.098 * jointRadiusScale;
  if ([4, 8, 12, 16, 20].includes(index)) return 0.058 * jointRadiusScale;
  const finger = landmarkFinger(index);
  if (finger === "thumb") return 0.085 * jointRadiusScale;
  if (finger === "pinky") return 0.066 * jointRadiusScale;
  return 0.078 * jointRadiusScale;
}

export function widthForBone(a, b, fingerWidthScale = 1, palmThicknessScale = 1) {
  const palmIndexes = new Set([0, 1, 5, 9, 13, 17]);
  if (palmIndexes.has(a) && palmIndexes.has(b)) {
    return 0.26 * palmThicknessScale;
  }

  const segmentKey = `${a},${b}`;
  const thumbWidths = {
    "1,2": 0.15,
    "2,3": 0.135,
    "3,4": 0.12,
  };
  if (segmentKey in thumbWidths) return thumbWidths[segmentKey] * fingerWidthScale;

  const fingerWidths = {
    "5,6": 0.16,
    "9,10": 0.165,
    "13,14": 0.155,
    "6,7": 0.14,
    "10,11": 0.145,
    "14,15": 0.135,
    "7,8": 0.12,
    "11,12": 0.125,
    "15,16": 0.115,
  };
  if (segmentKey in fingerWidths) return fingerWidths[segmentKey] * fingerWidthScale;

  const pinkyWidths = {
    "17,18": 0.13,
    "18,19": 0.115,
    "19,20": 0.1,
  };
  if (segmentKey in pinkyWidths) return pinkyWidths[segmentKey] * fingerWidthScale;

  const finger = landmarkFinger(a !== 0 ? a : b);
  if (finger === "thumb") return 0.125 * fingerWidthScale;
  if (finger === "pinky") return 0.095 * fingerWidthScale;
  return 0.11 * fingerWidthScale;
}

export function orthonormalBasis(direction) {
  const dir = normalize(direction, [1, 0, 0]);
  let helper = [0, 0, 1];
  if (Math.abs(dot(dir, helper)) > 0.9) {
    helper = [0, 1, 0];
  }
  const u = normalize(cross(dir, helper), [1, 0, 0]);
  const v = normalize(cross(dir, u), [0, 1, 0]);
  return [u, v];
}

export function generateBoxPrism(p0, p1, width) {
  const direction = sub(p1, p0);
  if (norm(direction) < 1e-6) return { vertices: [], faces: [] };
  const [u, v] = orthonormalBasis(direction);
  const half = width * 0.5;
  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const corners0 = signs.map(([sx, sy]) => add(p0, mul(add(mul(u, sx), mul(v, sy)), half)));
  const corners1 = signs.map(([sx, sy]) => add(p1, mul(add(mul(u, sx), mul(v, sy)), half)));
  return {
    vertices: [...corners0, ...corners1],
    faces: [
      [1, 2, 3, 4],
      [5, 8, 7, 6],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 8, 4],
      [4, 8, 5, 1],
    ],
  };
}

export function generateUvSphere(center, radius, latSegments = 5, lonSegments = 8) {
  const vertices = [];
  const faces = [];

  for (let lat = 0; lat <= latSegments; lat += 1) {
    const theta = Math.PI * lat / latSegments;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let lon = 0; lon < lonSegments; lon += 1) {
      const phi = 2.0 * Math.PI * lon / lonSegments;
      vertices.push(add(center, mul([
        sinTheta * Math.cos(phi),
        cosTheta,
        sinTheta * Math.sin(phi),
      ], radius)));
    }
  }

  for (let lat = 0; lat < latSegments; lat += 1) {
    for (let lon = 0; lon < lonSegments; lon += 1) {
      const a = lat * lonSegments + lon + 1;
      const b = lat * lonSegments + ((lon + 1) % lonSegments) + 1;
      const c = (lat + 1) * lonSegments + ((lon + 1) % lonSegments) + 1;
      const d = (lat + 1) * lonSegments + lon + 1;
      faces.push([a, b, c, d]);
    }
  }
  return { vertices, faces };
}

export function generatePalmSlab(landmarks, thickness = 0.1536, widthScale = 1) {
  const palmIndices = [0, 1, 5, 9, 13, 17];
  const palmPoints = palmIndices.map((index) => [...landmarks[index]]);
  const center = palmPoints.reduce((acc, point) => add(acc, point), [0, 0, 0]).map((v) => v / palmPoints.length);
  const expanded = palmPoints.map((point) => add(center, mul(sub(point, center), 1.0 + 0.16 * widthScale)));

  const across = sub(landmarks[5], landmarks[17]);
  const length = sub(landmarks[9], landmarks[0]);
  let normal = cross(across, length);
  if (norm(normal) < 1e-6) normal = [0, 0, 1];
  normal = normalize(normal, [0, 0, 1]);
  const offset = mul(normal, thickness * 0.5);

  const front = expanded.map((point) => add(point, offset));
  const back = expanded.map((point) => sub(point, offset));
  const vertices = [...front, ...back];
  const pointCount = expanded.length;

  const faces = [
    Array.from({ length: pointCount }, (_, i) => i + 1),
    Array.from({ length: pointCount }, (_, i) => pointCount * 2 - i),
  ];
  for (let i = 0; i < pointCount; i += 1) {
    const j = (i + 1) % pointCount;
    faces.push([i + 1, j + 1, pointCount + j + 1, pointCount + i + 1]);
  }
  return { vertices, faces };
}

export function appendMesh(target, part) {
  const vertexOffset = target.vertices.length;
  target.vertices.push(...part.vertices);
  for (const face of part.faces) {
    target.faces.push(face.map((index) => vertexOffset + index));
  }
}

export function buildHandMesh(normalizedLandmarks, fingerWidthScale = 1, palmThicknessScale = 1, jointRadiusScale = 1) {
  const mesh = { vertices: [], faces: [] };
  appendMesh(
    mesh,
    generatePalmSlab(normalizedLandmarks, 0.1536 * palmThicknessScale, palmThicknessScale),
  );
  for (const [a, b] of BONE_CONNECTIONS) {
    appendMesh(
      mesh,
      generateBoxPrism(
        normalizedLandmarks[a],
        normalizedLandmarks[b],
        widthForBone(a, b, fingerWidthScale, palmThicknessScale),
      ),
    );
  }
  normalizedLandmarks.forEach((point, index) => {
    appendMesh(mesh, generateUvSphere(point, radiusForLandmark(index, jointRadiusScale)));
  });
  return mesh;
}

export function buildMeshFromRawLandmarks(rawLandmarks, settings = DEFAULT_SETTINGS) {
  const normalized = normalizeLandmarksForObj(rawLandmarks);
  const mesh = buildHandMesh(
    normalized,
    Number(settings.fingerWidth) / 100,
    Number(settings.palmThickness) / 100,
    Number(settings.jointRadius) / 100,
  );
  return { mesh, normalizedLandmarks: normalized };
}

export function expectedDefaultCounts() {
  return {
    vertices: 12 + BONE_CONNECTIONS.length * 8 + LANDMARK_NAMES.length * 48,
    faces: 8 + BONE_CONNECTIONS.length * 6 + LANDMARK_NAMES.length * 40,
  };
}
