import { bindFileInput, formatBytes } from "./file-tools.js";
import { detectImageBorder, borderColorLabel } from "./image-borders.js";

const get = (id) => document.getElementById(id);
const form = get("border-form");
const status = get("tool-status");
const error = get("tool-error");
const button = get("remove-borders");
const format = get("output-format");
const quality = get("quality");
let source = null;
let file = null;
let revision = 0;
let resultUrl = null;

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

function drawSource(region = null) {
  const canvas = get("source-preview");
  const scale = Math.min(1, 1000 / source.width, 700 / source.height);
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is not available in this browser.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (!region) return;
  const sx = canvas.width / source.width;
  const sy = canvas.height / source.height;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(region.x * sx, region.y * sy, region.w * sx, region.h * sy);
  ctx.fill("evenodd");
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.strokeRect(region.x * sx, region.y * sy, region.w * sx, region.h * sy);
}

function clearResult() {
  revision++;
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  get("result-preview").removeAttribute("src");
  get("download-image").removeAttribute("href");
  get("result-section").hidden = true;
  get("border-report").textContent = "";
  error.hidden = true;
  status.textContent = "";
  status.dataset.state = "";
  button.disabled = !source;
}

async function loadFiles(files) {
  clearResult();
  const current = revision;
  if (source) source.close();
  source = null;
  file = null;
  button.disabled = true;
  form.hidden = true;
  get("source-section").hidden = true;
  get("source-preview").width = get("source-preview").height = 0;
  get("file-details").textContent = "No image selected.";
  if (files.length !== 1) {
    showError("Choose exactly one image at a time.");
    return;
  }
  status.textContent = "Decoding image…";
  status.dataset.state = "loading";
  try {
    const decoded = await createImageBitmap(files[0], { imageOrientation: "from-image" });
    if (current !== revision) { decoded.close(); return; }
    source = decoded;
    file = files[0];
    drawSource();
    get("file-details").textContent = `${file.name} — ${source.width} × ${source.height} px — ${formatBytes(file.size)}`;
    get("source-dimensions").textContent = `${source.width} × ${source.height} px`;
    get("source-section").hidden = false;
    form.hidden = false;
    button.disabled = false;
    status.textContent = "Image ready. Detect its border color to create a trimmed preview.";
    status.dataset.state = "";
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
form.addEventListener("input", () => {
  clearResult();
  quality.disabled = format.value === "image/png";
  if (source) drawSource();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!source || button.disabled) return;
  clearResult();
  const current = revision;
  let analysisCanvas;
  let outputCanvas;
  try {
    drawSource();
    const tolerance = get("border-tolerance").valueAsNumber;
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 64) {
      throw new Error("Color tolerance must be a whole number from 0 to 64.");
    }
    if (source.width > 16384 || source.height > 16384 || source.width * source.height > 32_000_000) {
      throw new Error("Border detection supports at most 16,384 pixels per side and 32 million pixels total.");
    }
    const mime = format.value;
    const q = quality.valueAsNumber;
    if (mime !== "image/png" && (!Number.isInteger(q) || q < 1 || q > 100)) {
      throw new Error("Quality must be a whole percentage from 1 to 100.");
    }
    button.disabled = true;
    status.textContent = "Detecting border color and content bounds…";
    status.dataset.state = "loading";
    analysisCanvas = document.createElement("canvas");
    analysisCanvas.width = source.width;
    analysisCanvas.height = source.height;
    const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not allocate a canvas for border detection. Try a smaller image.");
    ctx.drawImage(source, 0, 0);
    const detected = await detectImageBorder(ctx, source.width, source.height, tolerance, () => current === revision);
    if (!detected || current !== revision) return;
    // Release the full-source analysis surface before allocating cropped output.
    analysisCanvas.width = analysisCanvas.height = 0;
    if (detected.kind !== "trim") {
      status.dataset.state = "warning";
      status.textContent = detected.kind === "uniform"
        ? `The entire image matches ${borderColorLabel(detected.color)} at this tolerance. Nothing trimmed. Try a lower tolerance.`
        : detected.kind === "ambiguous"
          ? "Outer edges have different solid colors. Nothing trimmed; use Image Resizer & Converter for a manual crop."
          : "No removable solid-color border found. Nothing trimmed. Try a different tolerance or use a manual crop.";
      return;
    }
    const { x, y, w, h } = detected.crop;
    status.textContent = "Border detected. Encoding trimmed image…";
    outputCanvas = document.createElement("canvas");
    outputCanvas.width = w;
    outputCanvas.height = h;
    const output = outputCanvas.getContext("2d");
    if (!output) throw new Error("Could not allocate the trimmed image canvas. Try a smaller image.");
    if (mime === "image/jpeg") {
      output.fillStyle = "#FFFFFF";
      output.fillRect(0, 0, w, h);
    }
    output.drawImage(source, x, y, w, h, 0, 0, w, h);
    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, mime, q / 100));
    if (current !== revision) return;
    if (!blob) throw new Error("Image encoding failed. Try a smaller image.");
    if (blob.type !== mime) throw new Error("This browser cannot export the selected format. Choose PNG or JPEG instead.");
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mime];
    resultUrl = URL.createObjectURL(blob);
    get("result-preview").src = resultUrl;
    get("download-image").href = resultUrl;
    get("download-image").download = `${file.name.replace(/\.[^.]+$/, "") || "image"}-trimmed-${w}x${h}.${extension}`;
    const removed = detected.removed;
    get("border-report").textContent = `Border color: ${borderColorLabel(detected.color)}. Removed ${removed.left} px left, ${removed.top} px top, ${removed.right} px right, ${removed.bottom} px bottom.`;
    get("result-dimensions").textContent = `${w} × ${h} px`;
    get("result-details").textContent = `${extension.toUpperCase()} — ${formatBytes(blob.size)}. Source: ${formatBytes(file.size)}. Pixels are cropped, not resized; re-encoding does not preserve source metadata.`;
    drawSource(detected.crop);
    get("result-section").hidden = false;
    status.dataset.state = "success";
    status.textContent = "Borders removed. Review the original and trimmed previews before downloading.";
  } catch (cause) {
    if (current === revision) {
      status.textContent = "";
      showError(`Could not remove borders. ${cause.message}`);
    }
  } finally {
    if (analysisCanvas) analysisCanvas.width = analysisCanvas.height = 0;
    if (outputCanvas) outputCanvas.width = outputCanvas.height = 0;
    if (current === revision) button.disabled = false;
  }
});
