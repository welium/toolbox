import { bindFileInput, formatBytes } from "./file-tools.js";

const get = (id) => document.getElementById(id);
const form = get("image-form");
const status = get("tool-status");
const error = get("tool-error");
const cropFields = ["crop-x", "crop-y", "crop-width", "crop-height"].map(get);
const width = get("output-width");
const height = get("output-height");
const format = get("output-format");
const quality = get("quality");
const lock = get("lock-ratio");
let source = null;
let file = null;
let revision = 0;
let resultUrl = null;

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

function clearResult() {
  revision++;
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  get("result-preview").removeAttribute("src");
  get("download-image").removeAttribute("href");
  get("result-section").hidden = true;
  error.hidden = true;
  status.textContent = "";
  get("convert-button").disabled = false;
}

function crop() {
  const values = cropFields.map((field) => field.valueAsNumber);
  const [x, y, w, h] = values;
  if (!values.every(Number.isSafeInteger) || x < 0 || y < 0 || w < 1 || h < 1
      || x + w > source.width || y + h > source.height) {
    throw new Error("Crop must use whole pixels and stay inside the original image.");
  }
  return { x, y, w, h };
}

function drawCrop() {
  const canvas = get("source-preview");
  const scale = Math.min(1, 1000 / source.width, 700 / source.height);
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is not available in this browser.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const { x, y, w, h } = crop();
  const sx = canvas.width / source.width;
  const sy = canvas.height / source.height;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(x * sx, y * sy, w * sx, h * sy);
  ctx.fill("evenodd");
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.strokeRect(x * sx, y * sy, w * sx, h * sy);
}

function resetCrop() {
  cropFields.forEach((field, index) => {
    field.value = [0, 0, source.width, source.height][index];
    field.max = index % 2 === 0 ? source.width : source.height;
  });
  width.value = source.width;
  height.value = source.height;
  drawCrop();
}

async function loadFiles(files) {
  clearResult();
  const current = revision;
  if (source) source.close();
  source = null;
  file = null;
  form.hidden = true;
  get("file-details").textContent = "No image selected.";
  if (files.length !== 1) {
    showError("Choose exactly one image at a time.");
    return;
  }
  status.textContent = "Decoding image…";
  try {
    const decoded = await createImageBitmap(files[0], { imageOrientation: "from-image" });
    if (current !== revision) {
      decoded.close();
      return;
    }
    source = decoded;
    file = files[0];
    resetCrop();
    get("file-details").textContent = `${file.name} — ${source.width} × ${source.height} px — ${formatBytes(file.size)}`;
    form.hidden = false;
    status.textContent = "Image ready. Set the crop and output options.";
  } catch (cause) {
    if (current !== revision) return;
    if (source) source.close();
    source = null;
    file = null;
    status.textContent = "";
    showError(`Could not decode this image. Use a valid browser-supported image. ${cause.message}`);
  }
}

bindFileInput(get("image-input"), get("dropzone"), loadFiles);

get("reset-crop").addEventListener("click", () => {
  clearResult();
  resetCrop();
});

form.addEventListener("input", (event) => {
  clearResult();
  quality.disabled = format.value === "image/png";
  try {
    const region = crop();
    if (cropFields.includes(event.target)) {
      width.value = region.w;
      height.value = region.h;
      drawCrop();
    } else if (lock.checked) {
      if (event.target === width || event.target === lock) {
        height.value = Math.max(1, Math.round(width.valueAsNumber * region.h / region.w)) || "";
      } else if (event.target === height) {
        width.value = Math.max(1, Math.round(height.valueAsNumber * region.w / region.h)) || "";
      }
    }
  } catch (cause) {
    showError(cause.message);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearResult();
  const current = revision;
  let canvas;
  try {
    const { x, y, w, h } = crop();
    const outW = width.valueAsNumber;
    const outH = height.valueAsNumber;
    if (![outW, outH].every((n) => Number.isSafeInteger(n) && n > 0)) {
      throw new Error("Output dimensions must be positive whole pixels.");
    }
    // Bound allocation before handing dimensions to the browser's canvas implementation.
    if (outW > 16384 || outH > 16384 || outW * outH > 32_000_000) {
      throw new Error("Output is too large. Use at most 16,384 pixels per side and 32 million pixels total.");
    }
    const mime = format.value;
    const q = quality.valueAsNumber;
    if (mime !== "image/png" && (!Number.isInteger(q) || q < 1 || q > 100)) {
      throw new Error("Quality must be a whole percentage from 1 to 100.");
    }
    get("convert-button").disabled = true;
    status.textContent = "Creating image…";
    canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not allocate the output canvas. Try smaller dimensions.");
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, x, y, w, h, 0, 0, outW, outH);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, q / 100));
    if (current !== revision) return;
    if (!blob) throw new Error("Image encoding failed. Try smaller dimensions.");
    if (blob.type !== mime) throw new Error("This browser cannot export the selected format. Choose PNG or JPEG instead.");
    resultUrl = URL.createObjectURL(blob);
    get("result-preview").src = resultUrl;
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mime];
    const name = file.name.replace(/\.[^.]+$/, "") || "image";
    get("download-image").href = resultUrl;
    get("download-image").download = `${name}-${outW}x${outH}.${extension}`;
    get("result-details").textContent = `${outW} × ${outH} px — ${extension.toUpperCase()} — ${formatBytes(blob.size)}`;
    const change = file.size ? `${Math.abs((blob.size / file.size - 1) * 100).toFixed(1)}% ${blob.size <= file.size ? "smaller" : "larger"} than the original` : "Original file is empty";
    get("size-comparison").textContent = `Original: ${formatBytes(file.size)}. Output: ${formatBytes(blob.size)} (${change}).`;
    get("result-section").hidden = false;
    status.textContent = "Image created. Ready to download.";
  } catch (cause) {
    if (current === revision) {
      status.textContent = "";
      showError(cause.message);
    }
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (current === revision) get("convert-button").disabled = false;
  }
});
