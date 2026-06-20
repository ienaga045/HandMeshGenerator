import { BONE_CONNECTIONS } from "./meshGenerator.js";

function project(points, axes, axisSign, rect) {
  const projected = points.map((point) => [
    point[axes[0]] * axisSign[0],
    point[axes[1]] * axisSign[1],
  ]);
  const minX = Math.min(...projected.map((p) => p[0]));
  const minY = Math.min(...projected.map((p) => p[1]));
  const maxX = Math.max(...projected.map((p) => p[0]));
  const maxY = Math.max(...projected.map((p) => p[1]));
  const spanX = Math.max(maxX - minX, 1e-5);
  const spanY = Math.max(maxY - minY, 1e-5);
  const margin = 28;
  const scale = Math.min((rect.w - margin * 2) / spanX, (rect.h - margin * 2) / spanY);
  const offsetX = rect.x + (rect.w - spanX * scale) * 0.5;
  const offsetY = rect.y + (rect.h - spanY * scale) * 0.5;
  return projected.map((point) => [
    (point[0] - minX) * scale + offsetX,
    (point[1] - minY) * scale + offsetY,
  ]);
}

function drawView(ctx, normalizedLandmarks, label, axes, rect, axisSign) {
  ctx.strokeStyle = "#343a46";
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.fillStyle = "#8b93a3";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(label, rect.x + 10, rect.y + 20);

  const points = project(normalizedLandmarks, axes, axisSign, rect);

  ctx.strokeStyle = "#f5f7fb";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (const [a, b] of BONE_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(points[a][0], points[a][1]);
    ctx.lineTo(points[b][0], points[b][1]);
    ctx.stroke();
  }

  points.forEach((point, index) => {
    ctx.fillStyle = index === 0 ? "#ffd45a" : "#ffffff";
    ctx.beginPath();
    ctx.arc(point[0], point[1], index === 0 ? 4.5 : 3.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function renderBonePreview(canvas, normalizedLandmarks) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, width, height);

  if (!normalizedLandmarks) {
    ctx.fillStyle = "#777";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("NO LANDMARKS", width / 2 - 70, height / 2);
    return;
  }

  const halfW = width / 2;
  const halfH = height / 2;
  const views = [
    ["FRONT", [0, 1], { x: 0, y: 0, w: halfW, h: halfH }, [1, -1]],
    ["UP", [0, 2], { x: halfW, y: 0, w: width - halfW, h: halfH }, [1, -1]],
    ["LEFT", [2, 1], { x: 0, y: halfH, w: halfW, h: height - halfH }, [1, -1]],
    ["RIGHT", [2, 1], { x: halfW, y: halfH, w: width - halfW, h: height - halfH }, [-1, -1]],
  ];

  for (const [label, axes, rect, axisSign] of views) {
    drawView(ctx, normalizedLandmarks, label, axes, rect, axisSign);
  }
}
