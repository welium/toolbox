function visibleColor(data, offset) {
  const alpha = data[offset + 3];
  // Ignore hidden RGB in transparent pixels and compare partially transparent
  // pixels in premultiplied space, without assuming a white or black background.
  return [data[offset] * alpha / 255, data[offset + 1] * alpha / 255, data[offset + 2] * alpha / 255, alpha];
}

function closeColors(a, b, tolerance) {
  return a.every((value, channel) => Math.abs(value - b[channel]) <= tolerance);
}

function matches(data, offset, color, tolerance) {
  const alpha = data[offset + 3];
  return Math.abs(alpha - color[3]) <= tolerance
    && Math.abs(data[offset] * alpha / 255 - color[0]) <= tolerance
    && Math.abs(data[offset + 1] * alpha / 255 - color[1]) <= tolerance
    && Math.abs(data[offset + 2] * alpha / 255 - color[2]) <= tolerance;
}

function edgeColor(data, tolerance) {
  const pixels = data.length / 4;
  const samples = Math.min(pixels, 257);
  const channels = [[], [], [], []];
  for (let sample = 0; sample < samples; sample++) {
    const pixel = samples === 1 ? 0 : Math.round(sample * (pixels - 1) / (samples - 1));
    visibleColor(data, pixel * 4).forEach((value, channel) => channels[channel].push(value));
  }
  const color = channels.map((values) => values.sort((a, b) => a - b)[Math.floor(samples / 2)]);
  // Sampling estimates color only. Verify every edge pixel before accepting it,
  // so a small object touching an edge cannot be missed by sparse sampling.
  for (let offset = 0; offset < data.length; offset += 4) {
    if (!matches(data, offset, color, tolerance)) return null;
  }
  return color;
}

export function borderColorLabel(color) {
  const alpha = Math.round(color[3]);
  if (alpha === 0) return "transparent";
  const rgb = color.slice(0, 3).map((value) => Math.min(255, Math.round(value * 255 / color[3])));
  const hex = `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  return alpha === 255 ? hex : `${hex} (${Math.round(alpha / 255 * 100)}% opacity)`;
}

export async function detectImageBorder(ctx, width, height, tolerance, isCurrent = () => true) {
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 64) {
    throw new Error("Border tolerance must be a whole number from 0 to 64.");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Border detection requires positive whole image dimensions.");
  }
  const edges = [
    ctx.getImageData(0, 0, width, 1).data,
    ctx.getImageData(0, height - 1, width, 1).data,
    ctx.getImageData(0, 0, 1, height).data,
    ctx.getImageData(width - 1, 0, 1, height).data,
  ];
  const colors = edges.map((edge) => edgeColor(edge, tolerance)).filter(Boolean);
  if (!colors.length) return { kind: "none" };
  const color = colors[0];
  if (colors.some((other) => !closeColors(color, other, tolerance))) return { kind: "ambiguous" };

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  // Read at most ~4 MiB of pixels at once rather than retaining a full-resolution
  // ImageData buffer. Yield between strips so edits and new uploads can cancel.
  const rows = Math.max(1, Math.floor(1_048_576 / width));
  for (let startY = 0; startY < height; startY += rows) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!isCurrent()) return null;
    const stripHeight = Math.min(rows, height - startY);
    const data = ctx.getImageData(0, startY, width, stripHeight).data;
    for (let y = 0; y < stripHeight; y++) {
      for (let x = 0; x < width; x++) {
        if (matches(data, (y * width + x) * 4, color, tolerance)) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, startY + y);
        bottom = Math.max(bottom, startY + y);
      }
    }
  }
  if (right < 0) return { kind: "uniform", color };
  if (left === 0 && top === 0 && right === width - 1 && bottom === height - 1) return { kind: "none", color };
  return {
    kind: "trim", color,
    crop: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 },
    removed: { left, top, right: width - right - 1, bottom: height - bottom - 1 },
  };
}
