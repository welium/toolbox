import { bindFileInput, formatBytes } from "./file-tools.js";
import { detectImageBorder, borderColorLabel } from "./image-borders.js";
import { createZip } from "./zip.js";

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
let batchFiles = [];
let batchResults = [];
let batchUrls = [];
let zipUrl = null;

function resetBatch() {
  for (const url of batchUrls) URL.revokeObjectURL(url);
  batchUrls = [];
  batchResults = [];
  if (zipUrl) URL.revokeObjectURL(zipUrl);
  zipUrl = null;
  get("download-batch").disabled = true;
  get("batch-results").replaceChildren();
  get("batch-section").hidden = true;
}

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
  resetBatch();
  button.disabled = !source && !batchFiles.length;
}

async function loadFiles(files) {
  clearResult();
  const current = revision;
  if (source) source.close();
  source = null;
  file = null;
  batchFiles = [];
  button.disabled = true;
  form.hidden = true;
  get("source-section").hidden = true;
  get("source-preview").width = get("source-preview").height = 0;
  get("file-details").textContent = "No image selected.";
  get("batch-section").hidden = true;
  button.textContent = "Detect & remove borders";
  if (files.length > 1) {
    batchFiles = files;
    form.hidden = false;
    button.disabled = false;
    button.textContent = `Detect & remove borders (${files.length} images)`;
    get("file-details").textContent = `${files.length} images — ${formatBytes(files.reduce((sum, item) => sum + item.size, 0))}`;
    status.textContent = "Batch ready. Each image will be trimmed separately using the options below.";
    return;
  }
  if (!files.length) return;
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

function readOptions() {
  const tolerance = get("border-tolerance").valueAsNumber;
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 64) {
    throw new Error("Color tolerance must be a whole number from 0 to 64.");
  }
  const mime = format.value;
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    throw new Error("Choose JPG, PNG, or WebP.");
  }
  const q = quality.valueAsNumber;
  if (mime !== "image/png" && (!Number.isInteger(q) || q < 1 || q > 100)) {
    throw new Error("Quality must be a whole percentage from 1 to 100.");
  }
  return { tolerance, mime, q };
}

function noTrimMessage(detected) {
  return detected.kind === "uniform"
    ? `The entire image matches ${borderColorLabel(detected.color)} at this tolerance. Nothing trimmed. Try a lower tolerance.`
    : detected.kind === "ambiguous"
      ? "Outer edges have different solid colors. Nothing trimmed; use Image Resizer & Converter for a manual crop."
      : "No removable solid-color border found. Nothing trimmed. Try a different tolerance or use a manual crop.";
}

function trimReport(detected) {
  const removed = detected.removed;
  return `Border color: ${borderColorLabel(detected.color)}. Removed ${removed.left} px left, ${removed.top} px top, ${removed.right} px right, ${removed.bottom} px bottom.`;
}

function outputName(input, detected, extension) {
  const { w, h } = detected.crop;
  return `${input.name.replace(/\.[^.]+$/, "") || "image"}-trimmed-${w}x${h}.${extension}`;
}

async function trimImage(image, { tolerance, mime, q }, current) {
  let analysisCanvas;
  let outputCanvas;
  try {
    if (image.width > 16384 || image.height > 16384 || image.width * image.height > 32_000_000) {
      throw new Error("Border detection supports at most 16,384 pixels per side and 32 million pixels total.");
    }
    analysisCanvas = document.createElement("canvas");
    analysisCanvas.width = image.width;
    analysisCanvas.height = image.height;
    const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not allocate a canvas for border detection. Try a smaller image.");
    ctx.drawImage(image, 0, 0);
    const detected = await detectImageBorder(ctx, image.width, image.height, tolerance, () => current === revision);
    if (!detected || current !== revision) return;
    // Release the full-source analysis surface before allocating cropped output.
    analysisCanvas.width = analysisCanvas.height = 0;
    if (detected.kind !== "trim") return { detected };
    const { x, y, w, h } = detected.crop;
    outputCanvas = document.createElement("canvas");
    outputCanvas.width = w;
    outputCanvas.height = h;
    const output = outputCanvas.getContext("2d");
    if (!output) throw new Error("Could not allocate the trimmed image canvas. Try a smaller image.");
    if (mime === "image/jpeg") {
      output.fillStyle = "#FFFFFF";
      output.fillRect(0, 0, w, h);
    }
    output.drawImage(image, x, y, w, h, 0, 0, w, h);
    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, mime, q / 100));
    if (current !== revision) return;
    if (!blob) throw new Error("Image encoding failed. Try a smaller image.");
    if (blob.type !== mime) throw new Error("This browser cannot export the selected format. Choose PNG or JPEG instead.");
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mime];
    return { detected, blob, extension };
  } finally {
    if (analysisCanvas) analysisCanvas.width = analysisCanvas.height = 0;
    if (outputCanvas) outputCanvas.width = outputCanvas.height = 0;
  }
}

async function processBatch(options, current) {
  const files = batchFiles.slice();
  get("batch-section").hidden = false;
  let skipped = 0;
  let failed = 0;
  for (const [index, input] of files.entries()) {
    if (current !== revision) return;
    const card = document.createElement("article");
    card.className = "tool-section";
    const heading = document.createElement("h3");
    heading.className = "file-name";
    heading.textContent = input.name;
    const details = document.createElement("p");
    details.className = "field-hint";
    details.textContent = "Processing…";
    card.append(heading, details);
    get("batch-results").append(card);
    status.textContent = `Processing image ${index + 1} of ${files.length}: ${input.name}`;
    let image;
    try {
      image = await createImageBitmap(input, { imageOrientation: "from-image" });
      if (current !== revision) return;
      const result = await trimImage(image, options, current);
      if (!result || current !== revision) return;
      if (!result.blob) {
        skipped++;
        details.textContent = noTrimMessage(result.detected);
        continue;
      }
      const { detected, blob, extension } = result;
      const url = URL.createObjectURL(blob);
      batchUrls.push(url);
      // Prefix the selection index so duplicate source names remain distinct in ZIP.
      const name = `${index + 1}-${outputName(input, detected, extension)}`;
      batchResults.push({ name, blob });
      details.textContent = `${detected.crop.w} × ${detected.crop.h} px — ${extension.toUpperCase()} — ${formatBytes(blob.size)}. ${trimReport(detected)}`;
      const frame = document.createElement("div");
      frame.className = "preview-frame";
      const preview = document.createElement("img");
      preview.src = url;
      preview.alt = `Trimmed preview of ${input.name}`;
      preview.loading = "lazy";
      frame.append(preview);
      const actions = document.createElement("div");
      actions.className = "download-actions";
      const download = document.createElement("a");
      download.className = "pill-link pill-link--secondary";
      download.href = url;
      download.download = name;
      download.textContent = "Download trimmed image";
      actions.append(download);
      card.append(frame, actions);
    } catch (cause) {
      if (current !== revision) return;
      failed++;
      details.className = "tool-error";
      details.textContent = `Could not process this image. ${cause.message}`;
    } finally {
      if (image) image.close();
    }
  }
  if (current !== revision) return;
  get("download-batch").disabled = batchResults.length === 0;
  status.dataset.state = skipped || failed ? "warning" : "success";
  status.textContent = `Batch complete: ${batchResults.length} trimmed, ${skipped} skipped, ${failed} failed. Review the previews before downloading.`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if ((!source && !batchFiles.length) || button.disabled) return;
  clearResult();
  const current = revision;
  try {
    const options = readOptions();
    button.disabled = true;
    status.textContent = "Detecting border color and content bounds…";
    status.dataset.state = "loading";
    if (batchFiles.length) {
      await processBatch(options, current);
      return;
    }
    drawSource();
    const result = await trimImage(source, options, current);
    if (!result || current !== revision) return;
    const { detected, blob, extension } = result;
    if (!blob) {
      status.dataset.state = "warning";
      status.textContent = noTrimMessage(detected);
      return;
    }
    const { w, h } = detected.crop;
    resultUrl = URL.createObjectURL(blob);
    get("result-preview").src = resultUrl;
    get("download-image").href = resultUrl;
    get("download-image").download = outputName(file, detected, extension);
    get("border-report").textContent = trimReport(detected);
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
    if (current === revision) button.disabled = false;
  }
});

get("download-batch").addEventListener("click", async () => {
  if (!batchResults.length) return;
  const current = revision;
  const downloadButton = get("download-batch");
  downloadButton.disabled = true;
  try {
    if (!zipUrl) {
      const blob = await createZip(batchResults);
      if (current !== revision) return;
      zipUrl = URL.createObjectURL(blob);
    }
    const link = document.createElement("a");
    link.href = zipUrl;
    link.download = "trimmed-images.zip";
    link.click();
  } catch (cause) {
    if (current === revision) showError(`Could not create batch download. ${cause.message} Individual downloads are still available.`);
  } finally {
    if (current === revision) downloadButton.disabled = false;
  }
});
