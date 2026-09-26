import {
  DEFAULT_STRIP_WIDTH,
  StitchValidationError,
  bestOrder,
  precomputeFeatures,
  seamCost,
} from "./stitch.js";

const elements = {
  fileInput: document.querySelector("#image-input"),
  dropzone: document.querySelector("#dropzone"),
  fileList: document.querySelector("#file-list"),
  countHint: document.querySelector("#file-count-hint"),
  runButton: document.querySelector("#stitch-button"),
  status: document.querySelector("#tool-status"),
  runError: document.querySelector("#run-error"),
  largeWarning: document.querySelector("#large-job-warning"),
  stripWidth: document.querySelector("#strip-width"),
  stripWidthError: document.querySelector("#strip-width-error"),
  verbose: document.querySelector("#verbose-matrix"),
  previewOnly: document.querySelector("#preview-only"),
  report: document.querySelector("#report-section"),
  reportAxis: document.querySelector("#report-axis"),
  reportNotes: document.querySelector("#report-notes"),
  orderedFiles: document.querySelector("#ordered-files"),
  costSummary: document.querySelector("#cost-summary"),
  seamCosts: document.querySelector("#seam-costs"),
  matrixSection: document.querySelector("#matrix-section"),
  matrix: document.querySelector("#cost-matrix"),
  previewSection: document.querySelector("#preview-section"),
  previewCanvas: document.querySelector("#result-preview"),
  previewDescription: document.querySelector("#preview-description"),
  previewDimensions: document.querySelector("#preview-dimensions"),
  previewOnlyNote: document.querySelector("#preview-only-note"),
  downloadActions: document.querySelector("#download-actions"),
  downloadJpeg: document.querySelector("#download-jpeg"),
  downloadPng: document.querySelector("#download-png"),
};

const files = [];
const downloadUrls = new Set();
let pendingDecodes = 0;
let busy = false;
let downloading = false;
let resultCanvas = null;
let currentReport = null;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalFiles() {
  return [...files].sort((left, right) => (
    compareText(left.file.name.toLowerCase(), right.file.name.toLowerCase())
    || compareText(left.file.name, right.file.name)
    || compareText(left.path, right.path)
  ));
}

function validFiles() {
  return canonicalFiles().filter((record) => record.state === "ready");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatCost(value) {
  return Number.isFinite(value) ? value.toFixed(4) : "inf";
}

function selectedAxis() {
  return document.querySelector('input[name="axis"]:checked').value;
}

function setError(message) {
  elements.runError.textContent = message;
  elements.runError.hidden = !message;
}

function setStatus(message, state = "neutral") {
  elements.status.textContent = message;
  if (message) elements.status.dataset.state = state;
  else delete elements.status.dataset.state;
}

function updateControls() {
  const available = validFiles().length;
  const invalid = files.filter((record) => record.state === "error").length;
  const locked = busy || downloading;
  elements.runButton.disabled = locked || pendingDecodes > 0 || available < 2;
  elements.runButton.textContent = busy ? "Stitching…" : "Stitch images";
  elements.fileInput.disabled = locked;
  elements.stripWidth.disabled = locked;
  elements.verbose.disabled = locked;
  elements.previewOnly.disabled = locked;
  document.querySelectorAll('input[name="axis"]').forEach((input) => {
    input.disabled = locked;
  });

  let hint = "At least two valid images are required to stitch.";
  if (busy) hint = "Stitching is in progress. Please wait.";
  else if (pendingDecodes > 0) hint = "Waiting for image decoding to finish…";
  else if (available >= 2) hint = `${available} valid image${available === 1 ? "" : "s"} ready. The optimizer chooses their final order.`;
  else if (files.length > 0 && invalid === files.length) hint = "No usable images: every selected file failed decoding or has an unsupported format. Choose browser-supported image files and try again.";
  else if (invalid > 0) hint = "At least two valid images are required; remove or replace files with errors.";
  else if (files.length === 1) hint = "Add at least one more valid image to enable stitching.";
  else if (files.length > 1) hint = "At least two valid images are required; check the file errors below.";
  elements.countHint.textContent = hint;
  elements.countHint.classList.toggle("run-explanation--error", !locked && pendingDecodes === 0 && available < 2);

  const warnLarge = available > 10;
  elements.largeWarning.hidden = !warnLarge;
  elements.largeWarning.textContent = warnLarge
    ? `The exact optimizer is practical for 10 or fewer images. ${available > 12 ? "Jobs above 12 images are refused; split this job into smaller groups." : "This job is allowed, but may take longer."}`
    : "";
}

function clearResult() {
  currentReport = null;
  if (resultCanvas) {
    resultCanvas.width = 0;
    resultCanvas.height = 0;
    resultCanvas = null;
  }
  elements.report.hidden = true;
  elements.previewSection.hidden = true;
  elements.orderedFiles.replaceChildren();
  elements.costSummary.replaceChildren();
  elements.seamCosts.replaceChildren();
  elements.reportNotes.replaceChildren();
  elements.matrix.replaceChildren();
  elements.matrixSection.hidden = true;
  elements.previewCanvas.width = 0;
  elements.previewCanvas.height = 0;
  elements.downloadActions.hidden = true;
  elements.previewOnlyNote.hidden = true;
  elements.previewDescription.textContent = "";
  elements.previewDimensions.textContent = "";
  setError("");
}

function renderFiles() {
  elements.fileList.replaceChildren();
  const sorted = canonicalFiles();
  if (sorted.length === 0) {
    const empty = document.createElement("li");
    empty.className = "file-list-empty";
    empty.textContent = "No images selected.";
    elements.fileList.append(empty);
    return;
  }

  for (const record of sorted) {
    const item = document.createElement("li");
    item.className = `file-row file-row--${record.state}`;

    const info = document.createElement("div");
    info.className = "file-row-info";
    const name = document.createElement("strong");
    name.className = "file-name";
    name.textContent = record.file.name;
    const details = document.createElement("span");
    details.className = "file-details";
    details.textContent = record.state === "ready"
      ? `${record.width} × ${record.height} px · ${formatBytes(record.file.size)}`
      : record.state === "pending"
        ? `Reading image · ${formatBytes(record.file.size)}`
        : `${formatBytes(record.file.size)} · ${record.error}`;
    info.append(name, details);

    const remove = document.createElement("button");
    remove.className = "remove-file";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${record.file.name}`);
    remove.disabled = busy || downloading;
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeFile(record);
    });

    item.append(info, remove);
    elements.fileList.append(item);
  }
}

function removeFile(record) {
  if (busy || downloading) return;
  const index = files.indexOf(record);
  if (index < 0) return;
  files.splice(index, 1);
  record.removed = true;
  releaseRecord(record);
  clearResult();
  renderFiles();
  updateControls();
}

function releaseRecord(record) {
  if (record.canvas) {
    record.canvas.width = 0;
    record.canvas.height = 0;
    record.canvas = null;
  }
  record.file = null;
}

async function decodeImageElement(file) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    if (typeof image.decode === "function") {
      image.src = objectUrl;
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("the browser could not decode this image"));
        image.src = objectUrl;
      });
    }
    return image;
  } catch (error) {
    throw new Error(`fallback image decoding failed: ${error.message}`);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeFile(file) {
  let source;
  let bitmap = null;
  let usedFallback = false;
  if (typeof file.type === "string" && file.type && !file.type.startsWith("image/")) {
    throw new Error(`unsupported file type (${file.type}); choose an image file`);
  }

  if (typeof createImageBitmap === "function") {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      source = bitmap;
    } catch (bitmapError) {
      usedFallback = true;
      try {
        source = await decodeImageElement(file);
      } catch (fallbackError) {
        throw new Error(`image decode failed (${bitmapError.message}; ${fallbackError.message})`);
      }
    }
  } else {
    usedFallback = true;
    source = await decodeImageElement(file);
  }

  try {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
      throw new Error("the decoded image has invalid dimensions");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D canvas is unavailable");
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0);
    // Keep feature extraction and the eventual joined image on the same
    // alpha-over-white pixel values, including transparent source pixels.
    return { canvas, width, height, usedFallback };
  } finally {
    if (bitmap) bitmap.close();
  }
}

async function readRecord(record) {
  try {
    const decoded = await decodeFile(record.file);
    if (record.removed || !files.includes(record)) {
      decoded.canvas.width = 0;
      decoded.canvas.height = 0;
      return;
    }
    record.canvas = decoded.canvas;
    record.width = decoded.width;
    record.height = decoded.height;
    record.usedFallback = decoded.usedFallback;
    record.state = "ready";
  } catch (error) {
    if (record.removed || !files.includes(record)) return;
    record.state = "error";
    record.error = error.message;
  } finally {
    pendingDecodes -= 1;
    if (files.includes(record)) {
      renderFiles();
      updateControls();
    }
  }
}

function addFiles(fileCollection) {
  if (busy || downloading || !fileCollection) return;
  const selected = Array.from(fileCollection);
  if (selected.length === 0) return;
  clearResult();
  setError("");
  const newRecords = selected.map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
    state: "pending",
    width: 0,
    height: 0,
    canvas: null,
    removed: false,
    error: "",
  }));
  files.push(...newRecords);
  pendingDecodes += newRecords.length;
  renderFiles();
  updateControls();
  setStatus(`Reading ${newRecords.length} image${newRecords.length === 1 ? "" : "s"}…`, "loading");

  // Decode one file at a time to avoid retaining several full-size decoder
  // surfaces concurrently on memory-constrained devices.
  void (async () => {
    for (const record of newRecords) await readRecord(record);
    if (newRecords.some((record) => record.usedFallback)) {
      setStatus("An image used the fallback decoder; EXIF rotation may not be applied.", "warning");
    } else if (pendingDecodes === 0) {
      const failed = files.some((record) => record.state === "error");
      setStatus(
        failed
          ? "Image intake complete. Check file errors below; successfully decoded files remain selected."
          : "Image intake complete. Files stay in this browser.",
        failed ? "warning" : "success",
      );
    }
  })();
}

function validateStripWidth(showError) {
  const k = elements.stripWidth.valueAsNumber;
  const valid = Number.isInteger(k) && k > 0;
  if (showError) {
    elements.stripWidthError.textContent = valid ? "" : "Enter a positive whole number.";
    elements.stripWidthError.hidden = valid;
    elements.stripWidth.setAttribute("aria-invalid", String(!valid));
  }
  return valid ? k : null;
}

function dimensionError(records, axis) {
  const shared = axis === "horizontal" ? records[0].height : records[0].width;
  const matches = records.every((record) => (axis === "horizontal" ? record.height : record.width) === shared);
  if (matches) return null;
  const dimension = axis === "horizontal" ? "heights" : "widths";
  const details = records.map((record) => `  ${record.file.name}: ${record.width}x${record.height}`).join("\n");
  return new StitchValidationError(`images must have equal ${dimension} for ${axis} stitching:\n${details}`);
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function solveAxisAsync(features, records, axis, k) {
  const mismatch = dimensionError(records, axis);
  if (mismatch) throw mismatch;
  const narrowest = Math.min(...features.map((feature) => axis === "horizontal" ? feature.width : feature.height));
  const clampedK = Math.min(k, narrowest);
  const clamped = clampedK !== k;
  const matrix = Array.from({ length: features.length }, (_, row) => (
    Array.from({ length: features.length }, (_, column) => row === column ? Infinity : 0)
  ));

  for (let row = 0; row < features.length; row += 1) {
    setStatus(`Comparing ${axis} seams (${row + 1} of ${features.length})…`, "loading");
    for (let column = 0; column < features.length; column += 1) {
      if (row !== column) matrix[row][column] = seamCost(features[row], features[column], clampedK, axis);
    }
    // seamCost walks each seam at full image resolution. Yield between rows
    // so progress remains visible and the event loop can process input.
    await yieldToBrowser();
  }

  const ordering = bestOrder(matrix);
  return {
    axis,
    matrix,
    clampedK,
    clamped,
    warning: clamped
      ? `Strip width ${k} exceeds the narrowest relevant image dimension (${narrowest}); clamped to ${narrowest}.`
      : null,
    ...ordering,
    normalizedTotal: ordering.totalCost / ordering.seamCosts.length,
  };
}

async function selectAxisAsync(features, records, requestedAxis, k) {
  if (requestedAxis !== "auto") {
    const selected = await solveAxisAsync(features, records, requestedAxis, k);
    return { candidates: { [requestedAxis]: selected }, failures: {}, selected };
  }

  const candidates = {};
  const failures = {};
  for (const axis of ["horizontal", "vertical"]) {
    try {
      candidates[axis] = await solveAxisAsync(features, records, axis, k);
    } catch (error) {
      if (!(error instanceof StitchValidationError)) throw error;
      failures[axis] = error.message;
    }
  }
  const validAxes = Object.keys(candidates);
  if (validAxes.length === 0) {
    throw new StitchValidationError(
      `auto axis selection failed; both orientations are invalid:\n  horizontal: ${failures.horizontal}\n  vertical: ${failures.vertical}`,
    );
  }
  let selected = candidates.horizontal ?? candidates[validAxes[0]];
  if (candidates.vertical && candidates.vertical.normalizedTotal < selected.normalizedTotal) {
    selected = candidates.vertical;
  }
  return { candidates, failures, selected };
}

function addDefinition(list, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}

function renderMatrix(candidate, records) {
  elements.matrix.replaceChildren();
  const caption = document.createElement("caption");
  caption.textContent = `Directed ${candidate.axis} seam costs in canonical filename order; inf marks the diagonal.`;
  elements.matrix.append(caption);
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.scope = "col";
  corner.textContent = "From ↓ / To →";
  headerRow.append(corner);
  for (const record of records) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = record.file.name;
    cell.title = record.file.name;
    headerRow.append(cell);
  }
  head.append(headerRow);
  elements.matrix.append(head);

  const body = document.createElement("tbody");
  candidate.matrix.forEach((row, rowIndex) => {
    const tableRow = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = records[rowIndex].file.name;
    label.title = records[rowIndex].file.name;
    tableRow.append(label);
    row.forEach((cost) => {
      const cell = document.createElement("td");
      cell.textContent = formatCost(cost);
      tableRow.append(cell);
    });
    body.append(tableRow);
  });
  elements.matrix.append(body);
  elements.matrixSection.hidden = !elements.verbose.checked;
}

function renderReport(solution, records, requestedAxis, dimensions) {
  const selected = solution.selected;
  const ordered = selected.order.map((index) => records[index]);
  currentReport = { selected, ordered, records, dimensions };
  elements.reportAxis.textContent = `Selected axis: ${selected.axis}`;
  elements.orderedFiles.replaceChildren();
  ordered.forEach((record) => {
    const item = document.createElement("li");
    item.textContent = `${record.file.name} (${record.width}x${record.height})`;
    elements.orderedFiles.append(item);
  });

  elements.costSummary.replaceChildren();
  addDefinition(elements.costSummary, "Total cost", formatCost(selected.totalCost));
  addDefinition(elements.costSummary, "Normalized per-seam cost", formatCost(selected.normalizedTotal));
  addDefinition(elements.costSummary, "Result dimensions", `${dimensions.width}x${dimensions.height} px`);

  elements.seamCosts.replaceChildren();
  selected.order.slice(0, -1).forEach((recordIndex, seamIndex) => {
    const item = document.createElement("li");
    const from = records[recordIndex].file.name;
    const to = records[selected.order[seamIndex + 1]].file.name;
    item.textContent = `${from} → ${to}: ${formatCost(selected.seamCosts[seamIndex])}`;
    elements.seamCosts.append(item);
  });

  elements.reportNotes.replaceChildren();
  const addNote = (text, className = "") => {
    const note = document.createElement("p");
    if (className) note.className = className;
    note.textContent = text;
    elements.reportNotes.append(note);
  };
  for (const candidate of Object.values(solution.candidates)) {
    if (candidate.warning) addNote(`${candidate.axis}: ${candidate.warning}`, "report-warning");
  }
  if (requestedAxis === "auto") {
    for (const axis of ["horizontal", "vertical"]) {
      if (solution.candidates[axis]) {
        const candidate = solution.candidates[axis];
        addNote(`${axis[0].toUpperCase()}${axis.slice(1)} candidate: total cost ${formatCost(candidate.totalCost)}; normalized per-seam cost ${formatCost(candidate.normalizedTotal)}.`);
      } else {
        addNote(`${axis[0].toUpperCase()}${axis.slice(1)} unavailable: ${solution.failures[axis]}`, "report-warning");
      }
    }
    if (Object.keys(solution.failures).length > 0) {
      addNote(`Auto selected ${selected.axis} because the other orientation was dimensionally invalid.`, "report-warning");
    }
  }

  renderMatrix(selected, records);
  elements.report.hidden = false;
}

function resultDimensions(records, axis) {
  return {
    width: axis === "horizontal" ? records.reduce((sum, record) => sum + record.width, 0) : records[0].width,
    height: axis === "vertical" ? records.reduce((sum, record) => sum + record.height, 0) : records[0].height,
  };
}

function previewSize(dimensions) {
  const scale = Math.min(1, 1120 / dimensions.width, 560 / dimensions.height);
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
    scale,
  };
}

function drawPreview(ordered, axis, dimensions, previewOnly) {
  const size = previewSize(dimensions);
  const canvas = elements.previewCanvas;
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable for the preview");
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, size.width, size.height);

  let offset = 0;
  for (const record of ordered) {
    const sourceStart = offset;
    const sourceEnd = offset + (axis === "horizontal" ? record.width : record.height);
    const start = Math.round(sourceStart * size.scale);
    const end = Math.round(sourceEnd * size.scale);
    const crossSize = axis === "horizontal" ? size.height : size.width;
    if (axis === "horizontal") {
      context.drawImage(record.canvas, start, 0, Math.max(1, end - start), crossSize);
    } else {
      context.drawImage(record.canvas, 0, start, crossSize, Math.max(1, end - start));
    }
    offset = sourceEnd;
  }

  const description = `${previewOnly ? "Preview-only rendering" : "Stitched image preview"}: ${axis} stitch, ${dimensions.width} by ${dimensions.height} pixels.`;
  canvas.setAttribute("aria-label", description);
  elements.previewDescription.textContent = description;
  elements.previewDimensions.textContent = `${dimensions.width}x${dimensions.height} px`;
  elements.previewOnlyNote.hidden = !previewOnly;
  elements.downloadActions.hidden = previewOnly;
  elements.previewSection.hidden = false;
}

function composeResult(ordered, axis, dimensions) {
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) {
    throw new Error("the browser cannot allocate a canvas at the requested dimensions");
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable for the full-resolution result");
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, dimensions.width, dimensions.height);
  let offset = 0;
  for (const record of ordered) {
    if (axis === "horizontal") {
      context.drawImage(record.canvas, offset, 0);
      offset += record.width;
    } else {
      context.drawImage(record.canvas, 0, offset);
      offset += record.height;
    }
  }
  return canvas;
}

async function runStitch() {
  if (busy || pendingDecodes > 0) return;
  const records = validFiles();
  if (records.length < 2) {
    setError("At least two valid images are required.");
    return;
  }
  const requestedAxis = selectedAxis();
  const k = validateStripWidth(true);
  if (k === null) {
    setError("Fix the strip width before stitching.");
    elements.stripWidth.focus();
    return;
  }
  if (records.length > 12) {
    setError(`This job has ${records.length} valid images. The exact optimizer is limited to 12; split the job into smaller groups.`);
    return;
  }
  if (requestedAxis !== "auto") {
    const mismatch = dimensionError(records, requestedAxis);
    if (mismatch) {
      setError(mismatch.message);
      return;
    }
  }

  clearResult();
  busy = true;
  renderFiles();
  updateControls();
  setStatus("Preparing image features…", "loading");
  try {
    const features = [];
    for (let index = 0; index < records.length; index += 1) {
      setStatus(`Preparing image features (${index + 1} of ${records.length})…`, "loading");
      await yieldToBrowser();
      const context = records[index].canvas.getContext("2d", { willReadFrequently: true });
      const imageData = context.getImageData(0, 0, records[index].width, records[index].height);
      features.push(precomputeFeatures(imageData));
    }

    const solution = await selectAxisAsync(features, records, requestedAxis, k);
    const dimensions = resultDimensions(records, solution.selected.axis);
    renderReport(solution, records, requestedAxis, dimensions);

    // Feature buffers can be large. They are needed only for this solution,
    // not for preview composition or download.
    features.length = 0;
    const ordered = currentReport.ordered;
    const previewOnly = elements.previewOnly.checked;
    if (previewOnly) {
      drawPreview(ordered, solution.selected.axis, dimensions, true);
      setStatus("Preview only — no file generated.", "success");
    } else {
      try {
        resultCanvas = composeResult(ordered, solution.selected.axis, dimensions);
        drawPreview(ordered, solution.selected.axis, dimensions, false);
        setStatus(`Stitch ready: ${dimensions.width}x${dimensions.height} pixels. Choose JPEG or PNG to download.`, "success");
      } catch (error) {
        if (resultCanvas) {
          resultCanvas.width = 0;
          resultCanvas.height = 0;
          resultCanvas = null;
        }
        setStatus("The order and costs are ready, but a full-resolution preview could not be created.", "warning");
        setError(`Could not create the full-resolution stitched image: ${error.message} Try Preview only or use fewer/smaller images.`);
      }
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    setStatus("Stitching could not be completed. Your files and options are still selected.", "error");
  } finally {
    busy = false;
    renderFiles();
    updateControls();
  }
}

function downloadBlob(mimeType, extension, quality) {
  if (downloading || !resultCanvas || !currentReport) return;
  downloading = true;
  elements.downloadJpeg.disabled = true;
  elements.downloadPng.disabled = true;
  renderFiles();
  updateControls();
  setStatus(`Preparing ${extension.toUpperCase()} download…`, "loading");
  try {
    resultCanvas.toBlob((blob) => {
      downloading = false;
      elements.downloadJpeg.disabled = false;
      elements.downloadPng.disabled = false;
      renderFiles();
      updateControls();
      if (!blob) {
        setError(`The browser could not encode this image as ${extension.toUpperCase()}.`);
        setStatus("Download failed; try the other image format.", "error");
        return;
      }
      let url;
      let anchor;
      try {
        url = URL.createObjectURL(blob);
        downloadUrls.add(url);
        anchor = document.createElement("a");
        const { selected, dimensions } = currentReport;
        anchor.href = url;
        anchor.download = `stitched-${selected.axis}-${dimensions.width}x${dimensions.height}.${extension}`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          downloadUrls.delete(url);
        }, 60_000);
        setError("");
        setStatus(`${extension.toUpperCase()} download started.`, "success");
      } catch (error) {
        anchor?.remove();
        if (url) {
          URL.revokeObjectURL(url);
          downloadUrls.delete(url);
        }
        setError(`Could not start the ${extension.toUpperCase()} download: ${error.message}`);
        setStatus("Download failed.", "error");
      }
    }, mimeType, quality);
  } catch (error) {
    downloading = false;
    renderFiles();
    updateControls();
    setError(`Could not encode the ${extension.toUpperCase()} download: ${error.message}`);
    setStatus("Download failed.", "error");
  }
}

elements.fileInput.addEventListener("change", () => {
  addFiles(elements.fileInput.files);
  // Permit choosing the same file again after removing or correcting it.
  elements.fileInput.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("dropzone--active");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("dropzone--active");
  });
}
elements.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer?.files));

elements.runButton.addEventListener("click", runStitch);
elements.stripWidth.addEventListener("input", () => {
  validateStripWidth(true);
  clearResult();
  setError("");
});
document.querySelectorAll('input[name="axis"]').forEach((input) => {
  input.addEventListener("change", () => {
    clearResult();
    setError("");
  });
});
elements.verbose.addEventListener("change", () => {
  elements.matrixSection.hidden = !elements.verbose.checked || !currentReport;
});
elements.previewOnly.addEventListener("change", () => {
  clearResult();
  setError("");
});
elements.downloadJpeg.addEventListener("click", () => downloadBlob("image/jpeg", "jpeg", 0.92));
elements.downloadPng.addEventListener("click", () => downloadBlob("image/png", "png"));

window.addEventListener("pagehide", () => {
  for (const record of files) releaseRecord(record);
  if (resultCanvas) {
    resultCanvas.width = 0;
    resultCanvas.height = 0;
    resultCanvas = null;
  }
  for (const url of downloadUrls) URL.revokeObjectURL(url);
});

// The shared constant is imported to keep the UI default tied to the core.
elements.stripWidth.value = String(DEFAULT_STRIP_WIDTH);
renderFiles();
updateControls();
