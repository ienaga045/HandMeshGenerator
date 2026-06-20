export function formatObjNumber(value) {
  return Number(value).toFixed(6);
}

export function meshToObjObjects(objects) {
  let vertexOffset = 0;
  const lines = ["# Hand base mesh generated from Manual mode landmarks"];

  for (const [objectName, mesh] of objects) {
    lines.push(`o ${objectName}`);
    for (const vertex of mesh.vertices) {
      lines.push(`v ${formatObjNumber(vertex[0])} ${formatObjNumber(vertex[1])} ${formatObjNumber(vertex[2])}`);
    }
    for (const face of mesh.faces) {
      lines.push(`f ${face.map((index) => vertexOffset + index).join(" ")}`);
    }
    vertexOffset += mesh.vertices.length;
  }

  return `${lines.join("\n")}\n`;
}

export function meshToObj(mesh) {
  return meshToObjObjects([["hand_base_mesh", mesh]]);
}

export function downloadText(filename, text, mimeType = "text/plain") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function timestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
