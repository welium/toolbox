import { t } from "./i18n.js";

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
let intakeSequence = 0;
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
  elements.runButton.textContent = busy ? t("Stitching…") : t("Stitch images");
  elements.fileInput.disabled = locked;
  elements.stripWidth.disabled = locked;
  elements.verbose.disabled = locked;
  elements.previewOnly.disabled = locked;
  document.querySelectorAll('input[name="axis"]').forEach((input) => {
    input.disabled = locked;
  });

  let hint = t("At least two valid images are required to stitch.");
  if (busy) hint = t("Stitching is in progress. Please wait.");
  else if (pendingDecodes > 0) hint = t("Waiting for image decoding to finish…");
  else if (available >= 2) hint = t("{p0} valid images ready. The optimizer chooses their final order.", { p0: available });
  else if (files.length > 0 && invalid === files.length) hint = t("No usable images: every selected file failed decoding or has an unsupported format. Choose browser-supported image files and try again.");
  else if (invalid > 0) hint = t("At least two valid images are required; remove or replace files with errors.");
  else if (files.length === 1) hint = t("Add at least one more valid image to enable stitching.");
  else if (files.length > 1) hint = t("At least two valid images are required; check the file errors below.");
  elements.countHint.textContent = hint;
  elements.countHint.classList.toggle("run-explanation--error", !locked && pendingDecodes === 0 && available < 2);

  const warnLarge = available > 10;
  elements.largeWarning.hidden = !warnLarge;
  elements.largeWarning.textContent = warnLarge
    ? `${t("The exact optimizer is practical for 10 or fewer images.")} ${available > 12 ? t("Jobs above 12 images are refused; split this job into smaller groups.") : t("This job is allowed, but may take longer.")}`
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
    empty.textContent = t("No images selected.");
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
        ? t("Reading image · {p0}", { p0: formatBytes(record.file.size) })
        : `${formatBytes(record.file.size)} · ${record.error}`;
    info.append(name, details);

    const remove = document.createElement("button");
    remove.className = "remove-file";
    remove.type = "button";
    remove.textContent = t("Remove");
    remove.setAttribute("aria-label", t("Remove {p0}", { p0: record.file.name }));
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
        image.onerror = () => reject(new Error(t("the browser could not decode this image")));
        image.src = objectUrl;
      });
    }
    return image;
  } catch (error) {
    throw new Error(t("fallback image decoding failed: {p0}", { p0: error.message }));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeFile(file) {
  let source;
  let bitmap = null;
  let usedFallback = false;
  if (typeof file.type === "string" && file.type && !file.type.startsWith("image/")) {
    throw new Error(t("unsupported file type ({p0}); choose an image file", { p0: file.type }));
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
        throw new Error(t("image decode failed ({p0}; {p1})", { p0: bitmapError.message, p1: fallbackError.message }));
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
      throw new Error(t("the decoded image has invalid dimensions"));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error(t("2D canvas is unavailable"));
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
  const batchSequence = ++intakeSequence;
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
  setStatus(t("Reading {p0} images…", { p0: newRecords.length }), "loading");

  // Decode one file at a time to avoid retaining several full-size decoder
  // surfaces concurrently on memory-constrained devices.
  void (async () => {
    for (const record of newRecords) await readRecord(record);
    if (batchSequence !== intakeSequence) return;
    while (pendingDecodes > 0) {
      await yieldToBrowser();
      if (batchSequence !== intakeSequence) return;
    }
    if (!newRecords.some((record) => files.includes(record))) {
      setStatus("");
    } else if (newRecords.some((record) => record.usedFallback)) {
      setStatus(t("An image used the fallback decoder; EXIF rotation may not be applied."), "warning");
    } else if (pendingDecodes === 0) {
      const failed = files.some((record) => record.state === "error");
      setStatus(
        failed
          ? t("Image intake complete. Check file errors below; successfully decoded files remain selected.")
          : t("Image intake complete. Files stay in this browser."),
        failed ? "warning" : "success",
      );
    }
  })();
}

function validateStripWidth(showError) {
  const k = elements.stripWidth.valueAsNumber;
  const valid = Number.isInteger(k) && k > 0;
  if (showError) {
    elements.stripWidthError.textContent = valid ? "" : t("Enter a positive whole number.");
    elements.stripWidthError.hidden = valid;
    elements.stripWidth.setAttribute("aria-invalid", String(!valid));
  }
  return valid ? k : null;
}

function dimensionError(records, axis) {
  const shared = axis === "horizontal" ? records[0].height : records[0].width;
  const matches = records.every((record) => (axis === "horizontal" ? record.height : record.width) === shared);
  if (matches) return null;
  const details = records.map((record) => `  ${record.file.name}: ${record.width}x${record.height}`).join("\n");
  return new StitchValidationError(`${t("Images must have equal heights for horizontal stitching, or equal widths for vertical stitching.")}\n${details}`);
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
    setStatus(t("Comparing {p0} seams ({p1} of {p2})…", { p0: t(axis === "horizontal" ? "Horizontal" : "Vertical"), p1: row + 1, p2: features.length }), "loading");
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
      ? t("Strip width {p0} exceeds the narrowest relevant image dimension ({p1}); clamped to {p2}.", { p0: k, p1: narrowest, p2: narrowest })
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
      `${t("Both stitch directions are invalid.")}\n${failures.horizontal}\n${failures.vertical}`,
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
  caption.textContent = t("Directed {p0} seam costs in canonical filename order; inf marks the diagonal.", { p0: t(candidate.axis === "horizontal" ? "Horizontal" : "Vertical") });
  elements.matrix.append(caption);
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.scope = "col";
  corner.textContent = t("From ↓ / To →");
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
  elements.reportAxis.textContent = t("Selected axis: {p0}", { p0: t(selected.axis === "horizontal" ? "Horizontal" : "Vertical") });
  elements.orderedFiles.replaceChildren();
  ordered.forEach((record) => {
    const item = document.createElement("li");
    item.textContent = `${record.file.name} (${record.width}x${record.height})`;
    elements.orderedFiles.append(item);
  });

  elements.costSummary.replaceChildren();
  addDefinition(elements.costSummary, t("Total cost"), formatCost(selected.totalCost));
  addDefinition(elements.costSummary, t("Normalized per-seam cost"), formatCost(selected.normalizedTotal));
  addDefinition(elements.costSummary, t("Result dimensions"), `${dimensions.width}x${dimensions.height} px`);

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
    if (candidate.warning) addNote(`${t(candidate.axis === "horizontal" ? "Horizontal" : "Vertical")}: ${candidate.warning}`, "report-warning");
  }
  if (requestedAxis === "auto") {
    for (const axis of ["horizontal", "vertical"]) {
      if (solution.candidates[axis]) {
        const candidate = solution.candidates[axis];
        addNote(t("{p0}{p1} candidate: total cost {p2}; normalized per-seam cost {p3}.", { p0: t(axis === "horizontal" ? "Horizontal" : "Vertical"), p1: "", p2: formatCost(candidate.totalCost), p3: formatCost(candidate.normalizedTotal) }));
      } else {
        addNote(t("{p0}{p1} unavailable: {p2}", { p0: t(axis === "horizontal" ? "Horizontal" : "Vertical"), p1: "", p2: solution.failures[axis] }), "report-warning");
      }
    }
    if (Object.keys(solution.failures).length > 0) {
      addNote(t("Auto selected {p0} because the other orientation was dimensionally invalid.", { p0: t(selected.axis === "horizontal" ? "Horizontal" : "Vertical") }), "report-warning");
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
  if (!context) throw new Error(t("2D canvas is unavailable for the preview"));
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

  const description = t("{p0}: {p1}, {p2} × {p3} px.", { p0: previewOnly ? t("Preview-only rendering") : t("Stitched image preview"), p1: t(axis === "horizontal" ? "Horizontal" : "Vertical"), p2: dimensions.width, p3: dimensions.height });
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
    throw new Error(t("the browser cannot allocate a canvas at the requested dimensions"));
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("2D canvas is unavailable for the full-resolution result"));
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
    setError(t("At least two valid images are required."));
    return;
  }
  const requestedAxis = selectedAxis();
  const k = validateStripWidth(true);
  if (k === null) {
    setError(t("Fix the strip width before stitching."));
    elements.stripWidth.focus();
    return;
  }
  if (records.length > 12) {
    setError(t("This job has {p0} valid images. The exact optimizer is limited to 12; split the job into smaller groups.", { p0: records.length }));
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
  setStatus(t("Preparing image features…"), "loading");
  try {
    const features = [];
    for (let index = 0; index < records.length; index += 1) {
      setStatus(t("Preparing image features ({p0} of {p1})…", { p0: index + 1, p1: records.length }), "loading");
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
      setStatus(t("Preview only — no file generated."), "success");
    } else {
      try {
        resultCanvas = composeResult(ordered, solution.selected.axis, dimensions);
        drawPreview(ordered, solution.selected.axis, dimensions, false);
        setStatus(t("Stitch ready: {p0}x{p1} pixels. Choose JPEG or PNG to download.", { p0: dimensions.width, p1: dimensions.height }), "success");
      } catch (error) {
        if (resultCanvas) {
          resultCanvas.width = 0;
          resultCanvas.height = 0;
          resultCanvas = null;
        }
        setStatus(t("The order and costs are ready, but a full-resolution preview could not be created."), "warning");
        setError(t("Could not create the full-resolution stitched image: {p0} Try Preview only or use fewer/smaller images.", { p0: error.message }));
      }
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    setStatus(t("Stitching could not be completed. Your files and options are still selected."), "error");
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
  setStatus(t("Preparing {p0} download…", { p0: extension.toUpperCase() }), "loading");
  try {
    resultCanvas.toBlob((blob) => {
      downloading = false;
      elements.downloadJpeg.disabled = false;
      elements.downloadPng.disabled = false;
      renderFiles();
      updateControls();
      if (!blob) {
        setError(t("The browser could not encode this image as {p0}.", { p0: extension.toUpperCase() }));
        setStatus(t("Download failed; try the other image format."), "error");
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
        setStatus(t("{p0} download started.", { p0: extension.toUpperCase() }), "success");
      } catch (error) {
        anchor?.remove();
        if (url) {
          URL.revokeObjectURL(url);
          downloadUrls.delete(url);
        }
        setError(t("Could not start the {p0} download: {p1}", { p0: extension.toUpperCase(), p1: error.message }));
        setStatus(t("Download failed."), "error");
      }
    }, mimeType, quality);
  } catch (error) {
    downloading = false;
    renderFiles();
    updateControls();
    setError(t("Could not encode the {p0} download: {p1}", { p0: extension.toUpperCase(), p1: error.message }));
    setStatus(t("Download failed."), "error");
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
