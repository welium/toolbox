/*
 * Ported copy of ../stitich-vertical-split/src/stitich_vertical_split/stitch.py;
 * do not import sibling repo. Weights: boundary 0.60, strip 0.25, gradient
 * continuity 0.15. RGB, luminance, and gradients are stored as float32 to
 * mirror NumPy; local float32 means round their running sums to float32,
 * while scalar cost means and Held-Karp totals accumulate as JS float64, so
 * tiny rounding differences from NumPy's mixed float32/float64 operations are
 * expected. Alpha compositing follows the canvas byte values and may likewise
 * differ by less than one channel value from Pillow rounding.
 */

export const DEFAULT_STRIP_WIDTH = 3;
export const BOUNDARY_WEIGHT = 0.60;
export const STRIP_WEIGHT = 0.25;
export const GRADIENT_WEIGHT = 0.15;
export const REC709_LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722]);
export const GRADIENT_EPSILON = 1.0;

const AXES = new Set(["horizontal", "vertical"]);

export class StitchValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StitchValidationError";
  }
}

function validateAxis(axis) {
  if (!AXES.has(axis)) {
    throw new StitchValidationError(
      `unsupported stitch axis ${JSON.stringify(axis)}; expected 'horizontal' or 'vertical'`,
    );
  }
  return axis;
}

function validateStripWidth(k) {
  if (!Number.isInteger(k) || k <= 0) {
    throw new StitchValidationError(`strip width must be a positive integer; got ${String(k)}`);
  }
  return k;
}

function validateImageData(imageData) {
  const { width, height, data } = imageData ?? {};
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new StitchValidationError("image data width and height must be positive integers");
  }
  if (!ArrayBuffer.isView(data) || data instanceof DataView) {
    throw new StitchValidationError("image data must contain a typed-array data buffer");
  }

  const pixelCount = width * height;
  const channels = data.length === pixelCount * 4
    ? 4
    : data.length === pixelCount * 3
      ? 3
      : 0;
  if (!channels) {
    throw new StitchValidationError(
      `image data buffer length must be width × height × 3 or × 4; got ${data.length}`,
    );
  }
  return { width, height, data, channels };
}

function validateFeatures(features) {
  const { width, height, rgb, luminance, gradientX, gradientY } = features ?? {};
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new StitchValidationError("feature width and height must be positive integers");
  }
  const lengths = [
    ["rgb", rgb, width * height * 3],
    ["luminance", luminance, width * height],
    ["gradientX", gradientX, height * Math.max(width - 1, 0)],
    ["gradientY", gradientY, Math.max(height - 1, 0) * width],
  ];
  for (const [name, values, expectedLength] of lengths) {
    if (!(values instanceof Float32Array) || values.length !== expectedLength) {
      throw new StitchValidationError(
        `feature ${name} must be a Float32Array of length ${expectedLength}`,
      );
    }
  }
  return features;
}

function validateFeatureDimensions(features, axis) {
  if (features.length === 0) {
    throw new StitchValidationError("at least one image is required");
  }
  const sharedDimension = axis === "horizontal" ? features[0].height : features[0].width;
  if (features.every((feature) => (axis === "horizontal" ? feature.height : feature.width) === sharedDimension)) {
    return;
  }

  const description = axis === "horizontal" ? "equal heights" : "equal widths";
  const details = features
    .map((feature, index) => `  image ${index + 1}: ${feature.width}x${feature.height}`)
    .join("\n");
  throw new StitchValidationError(`images must have ${description} for ${axis} stitching:\n${details}`);
}

/**
 * Convert an ImageData-shaped RGB/RGBA buffer to reusable float32 features.
 * Canvas ImageData is RGBA; transparent pixels are composited over white.
 */
export function precomputeFeatures(imageData) {
  const { width, height, data, channels } = validateImageData(imageData);
  const pixelCount = width * height;
  const rgb = new Float32Array(pixelCount * 3);
  const luminance = new Float32Array(pixelCount);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sourceOffset = pixel * channels;
    const outputOffset = pixel * 3;
    const alpha = channels === 4 ? data[sourceOffset + 3] / 255 : 1;
    const inverseAlpha = 1 - alpha;
    for (let channel = 0; channel < 3; channel += 1) {
      const foreground = data[sourceOffset + channel];
      rgb[outputOffset + channel] = foreground * alpha + 255 * inverseAlpha;
    }

    const red = Math.fround(rgb[outputOffset] * REC709_LUMINANCE_WEIGHTS[0]);
    const green = Math.fround(rgb[outputOffset + 1] * REC709_LUMINANCE_WEIGHTS[1]);
    const blue = Math.fround(rgb[outputOffset + 2] * REC709_LUMINANCE_WEIGHTS[2]);
    luminance[pixel] = Math.fround(Math.fround(red + green) + blue);
  }

  const gradientX = new Float32Array(height * Math.max(width - 1, 0));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      gradientX[y * (width - 1) + x] = Math.fround(luminance[index + 1] - luminance[index]);
    }
  }

  const gradientY = new Float32Array(Math.max(height - 1, 0) * width);
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      gradientY[y * width + x] = Math.fround(luminance[index + width] - luminance[index]);
    }
  }

  return { width, height, rgb, luminance, gradientX, gradientY };
}

function relevantDimension(feature, axis) {
  return axis === "horizontal" ? feature.width : feature.height;
}

function localGradientMagnitudes(feature, axis, side, k) {
  const length = axis === "horizontal" ? feature.width - 1 : feature.height - 1;
  const seamLength = axis === "horizontal" ? feature.height : feature.width;
  const magnitudes = new Float32Array(seamLength);
  if (length === 0) return magnitudes;

  const count = Math.min(Math.max(k - 1, 1), length);
  if (axis === "horizontal") {
    const gradientWidth = feature.width - 1;
    const first = side === "first" ? 0 : gradientWidth - count;
    for (let y = 0; y < seamLength; y += 1) {
      let sum = 0;
      for (let offset = 0; offset < count; offset += 1) {
        sum = Math.fround(sum + Math.abs(feature.gradientX[y * gradientWidth + first + offset]));
      }
      magnitudes[y] = Math.fround(sum / count);
    }
  } else {
    const first = side === "first" ? 0 : length - count;
    for (let x = 0; x < seamLength; x += 1) {
      let sum = 0;
      for (let offset = 0; offset < count; offset += 1) {
        sum = Math.fround(sum + Math.abs(feature.gradientY[(first + offset) * feature.width + x]));
      }
      magnitudes[x] = Math.fround(sum / count);
    }
  }
  return magnitudes;
}

function seamCostWithWidth(a, b, k, axis) {
  const seamLength = axis === "horizontal" ? a.height : a.width;
  const aLocal = localGradientMagnitudes(a, axis, "last", k);
  const bLocal = localGradientMagnitudes(b, axis, "first", k);
  let boundaryRgbTotal = 0;
  let boundaryLuminanceTotal = 0;
  let stripRgbTotal = 0;
  let stripLuminanceTotal = 0;
  let gradientTotal = 0;
  const stripPixelCount = seamLength * k;

  for (let position = 0; position < seamLength; position += 1) {
    const aEdgePixel = axis === "horizontal"
      ? position * a.width + a.width - 1
      : (a.height - 1) * a.width + position;
    const bEdgePixel = axis === "horizontal" ? position * b.width : position;
    const aEdgeRgb = aEdgePixel * 3;
    const bEdgeRgb = bEdgePixel * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      boundaryRgbTotal += Math.abs(a.rgb[aEdgeRgb + channel] - b.rgb[bEdgeRgb + channel]);
    }
    boundaryLuminanceTotal += Math.abs(
      Math.fround(b.luminance[bEdgePixel] - a.luminance[aEdgePixel]),
    );

    const crossBoundaryStep = Math.abs(
      Math.fround(b.luminance[bEdgePixel] - a.luminance[aEdgePixel]),
    );
    const localScale = Math.fround(Math.fround(aLocal[position] + bLocal[position]) / 2);
    const denominator = Math.fround(localScale + GRADIENT_EPSILON);
    gradientTotal += Math.fround(crossBoundaryStep / denominator);

    for (let offset = 0; offset < k; offset += 1) {
      const aStripPixel = axis === "horizontal"
        ? position * a.width + a.width - k + offset
        : (a.height - k + offset) * a.width + position;
      const bStripPixel = axis === "horizontal"
        ? position * b.width + offset
        : offset * b.width + position;
      const aStripRgb = aStripPixel * 3;
      const bStripRgb = bStripPixel * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        stripRgbTotal += Math.abs(a.rgb[aStripRgb + channel] - b.rgb[bStripRgb + channel]);
      }
      stripLuminanceTotal += Math.abs(
        Math.fround(b.luminance[bStripPixel] - a.luminance[aStripPixel]),
      );
    }
  }

  const boundaryRgbMae = boundaryRgbTotal / (seamLength * 3);
  const boundaryLuminanceMae = boundaryLuminanceTotal / seamLength;
  const stripRgbMae = stripRgbTotal / (stripPixelCount * 3);
  const stripLuminanceMae = stripLuminanceTotal / stripPixelCount;
  const boundaryMae = (boundaryRgbMae + boundaryLuminanceMae) / 2;
  const stripMae = (stripRgbMae + stripLuminanceMae) / 2;
  const gradientContinuity = gradientTotal / seamLength;

  return BOUNDARY_WEIGHT * boundaryMae
    + STRIP_WEIGHT * stripMae
    + GRADIENT_WEIGHT * gradientContinuity;
}

/** Cost of placing b after a. Oversized k is clamped to the narrower image. */
export function seamCost(a, b, k = DEFAULT_STRIP_WIDTH, axis = "horizontal") {
  validateAxis(axis);
  validateStripWidth(k);
  validateFeatures(a);
  validateFeatures(b);
  validateFeatureDimensions([a, b], axis);
  const effectiveK = Math.min(k, relevantDimension(a, axis), relevantDimension(b, axis));
  return seamCostWithWidth(a, b, effectiveK, axis);
}

/**
 * Build directed pairwise costs. A clamp is reported as data so the caller
 * can render a warning; this module intentionally has no console or DOM I/O.
 */
export function pairwiseCostMatrix(features, axis = "horizontal", k = DEFAULT_STRIP_WIDTH) {
  validateAxis(axis);
  validateStripWidth(k);
  if (!Array.isArray(features) || features.length === 0) {
    throw new StitchValidationError("at least one image is required");
  }
  const checked = features.map(validateFeatures);
  validateFeatureDimensions(checked, axis);

  const minDimension = Math.min(...checked.map((feature) => relevantDimension(feature, axis)));
  const clampedK = Math.min(k, minDimension);
  const clamped = clampedK !== k;
  const warning = clamped
    ? `strip width ${k} exceeds the narrowest relevant image dimension (${minDimension}); clamping to ${minDimension}`
    : null;
  const matrix = Array.from(
    { length: checked.length },
    (_, row) => Array.from({ length: checked.length }, (_, column) => (
      row === column ? Infinity : seamCostWithWidth(checked[row], checked[column], clampedK, axis)
    )),
  );

  return { matrix, clampedK, clamped, warning };
}

function isMatrixRow(row) {
  return Array.isArray(row) || (ArrayBuffer.isView(row) && !(row instanceof DataView));
}

function comparePaths(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function reconstructPath(mask, last, parent, nodeCount) {
  const reversed = [];
  let currentMask = mask;
  let current = last;
  while (currentMask !== 0) {
    reversed.push(current);
    const previous = parent[currentMask * nodeCount + current];
    currentMask ^= 2 ** current;
    if (currentMask !== 0) {
      if (previous < 0) {
        throw new StitchValidationError("cost matrix path reconstruction failed");
      }
      current = previous;
    }
  }
  return reversed.reverse();
}

/** Find the minimum directed Hamiltonian path, with free start and end. */
export function bestOrder(cost) {
  if (!Array.isArray(cost) || !cost.every(isMatrixRow)) {
    throw new StitchValidationError("cost matrix must be a numeric square matrix");
  }
  const nodeCount = cost.length;
  if (cost.some((row) => row.length !== nodeCount)) {
    const shape = `[${nodeCount}, ${cost.find((row) => row.length !== nodeCount)?.length ?? 0}]`;
    throw new StitchValidationError(`cost matrix must be square; got shape ${shape}`);
  }
  if (nodeCount < 2) {
    throw new StitchValidationError(`cost matrix must contain at least two nodes; got ${nodeCount}`);
  }
  if (nodeCount > 30) {
    throw new StitchValidationError("cost matrix has too many nodes for JavaScript subset masks (maximum 30)");
  }

  const matrix = cost.map((row) => Array.from(row, Number));
  for (let row = 0; row < nodeCount; row += 1) {
    for (let column = 0; column < nodeCount; column += 1) {
      const value = matrix[row][column];
      if (Number.isNaN(value)) {
        throw new StitchValidationError("cost matrix must not contain NaN values");
      }
      if (row !== column && !Number.isFinite(value)) {
        throw new StitchValidationError("cost matrix must contain finite costs off the diagonal");
      }
      if (row !== column && value < 0) {
        throw new StitchValidationError("cost matrix must contain non-negative costs off the diagonal");
      }
    }
  }

  const stateCount = 2 ** nodeCount;
  const cellCount = stateCount * nodeCount;
  let dynamicCost;
  let parent;
  try {
    dynamicCost = new Float64Array(cellCount);
    dynamicCost.fill(Infinity);
    parent = new Int32Array(cellCount);
    parent.fill(-1);
  } catch (error) {
    throw new StitchValidationError(`cost matrix is too large for exact Held-Karp optimization: ${error.message}`);
  }

  for (let start = 0; start < nodeCount; start += 1) {
    dynamicCost[(2 ** start) * nodeCount + start] = 0;
  }

  for (let mask = 1; mask < stateCount; mask += 1) {
    for (let last = 0; last < nodeCount; last += 1) {
      const lastBit = 2 ** last;
      if (!(mask & lastBit) || mask === lastBit) continue;
      const previousMask = mask ^ lastBit;
      const targetCell = mask * nodeCount + last;
      let bestPrevious = -1;
      let bestValue = Infinity;
      let bestPrefix = null;

      for (let previous = 0; previous < nodeCount; previous += 1) {
        const previousBit = 2 ** previous;
        if (!(previousMask & previousBit)) continue;
        const previousCell = previousMask * nodeCount + previous;
        const prefixCost = dynamicCost[previousCell];
        if (!Number.isFinite(prefixCost)) continue;
        const candidate = prefixCost + matrix[previous][last];
        if (candidate < bestValue) {
          bestValue = candidate;
          bestPrevious = previous;
          bestPrefix = null;
        } else if (candidate === bestValue) {
          const candidatePrefix = reconstructPath(previousMask, previous, parent, nodeCount);
          if (bestPrefix === null) {
            bestPrefix = reconstructPath(previousMask, bestPrevious, parent, nodeCount);
          }
          if (comparePaths(candidatePrefix, bestPrefix) < 0) {
            bestPrevious = previous;
            bestPrefix = candidatePrefix;
          }
        }
      }

      if (bestPrevious >= 0) {
        dynamicCost[targetCell] = bestValue;
        parent[targetCell] = bestPrevious;
      }
    }
  }

  const fullMask = stateCount - 1;
  let bestLast = -1;
  let bestTotal = Infinity;
  let bestPath = null;
  for (let last = 0; last < nodeCount; last += 1) {
    const total = dynamicCost[fullMask * nodeCount + last];
    if (!Number.isFinite(total)) continue;
    if (total < bestTotal) {
      bestTotal = total;
      bestLast = last;
      bestPath = null;
    } else if (total === bestTotal) {
      const candidatePath = reconstructPath(fullMask, last, parent, nodeCount);
      if (bestPath === null) {
        bestPath = reconstructPath(fullMask, bestLast, parent, nodeCount);
      }
      if (comparePaths(candidatePath, bestPath) < 0) {
        bestLast = last;
        bestPath = candidatePath;
      }
    }
  }

  if (bestLast < 0 || !Number.isFinite(bestTotal)) {
    throw new StitchValidationError("cost matrix does not contain a finite path");
  }
  const order = reconstructPath(fullMask, bestLast, parent, nodeCount);
  const seamCosts = order.slice(0, -1).map((source, index) => matrix[source][order[index + 1]]);
  const note = nodeCount > 12
    ? "More than 12 nodes: exact Held-Karp DP may use substantial time and memory."
    : null;
  return { order, totalCost: bestTotal, seamCosts, note };
}

function solveAxis(features, axis, k) {
  const costs = pairwiseCostMatrix(features, axis, k);
  const ordering = bestOrder(costs.matrix);
  return {
    axis,
    matrix: costs.matrix,
    clampedK: costs.clampedK,
    clamped: costs.clamped,
    warning: costs.warning,
    ...ordering,
    normalizedTotal: ordering.totalCost / ordering.seamCosts.length,
  };
}

/**
 * Solve one requested axis or compare both valid axes by mean cost per seam.
 * Returns candidates, per-axis validation failures, and the selected candidate.
 */
export function selectAxisSolution(features, requestedAxis = "auto", k = DEFAULT_STRIP_WIDTH) {
  validateStripWidth(k);
  if (requestedAxis !== "auto") {
    validateAxis(requestedAxis);
    const selected = solveAxis(features, requestedAxis, k);
    return { candidates: { [requestedAxis]: selected }, failures: {}, selected };
  }

  const candidates = {};
  const failures = {};
  for (const axis of ["horizontal", "vertical"]) {
    try {
      candidates[axis] = solveAxis(features, axis, k);
    } catch (error) {
      if (!(error instanceof StitchValidationError)) throw error;
      failures[axis] = error.message;
    }
  }

  const validAxes = Object.keys(candidates);
  if (validAxes.length === 0) {
    const details = ["horizontal", "vertical"]
      .map((axis) => `  ${axis}: ${failures[axis]}`)
      .join("\n");
    throw new StitchValidationError(`auto axis selection failed; both orientations are invalid:\n${details}`);
  }
  let selected = candidates.horizontal ?? candidates[validAxes[0]];
  if (candidates.vertical && candidates.vertical.normalizedTotal < selected.normalizedTotal) {
    selected = candidates.vertical;
  }
  return { candidates, failures, selected };
}

function validateConcatenationInput(imageData) {
  return validateImageData(imageData);
}

/**
 * Concatenate ImageData-shaped buffers without touching DOM/canvas APIs.
 * Input data may be RGB or RGBA. The result is an opaque RGBA buffer (the
 * standard canvas ImageData layout) representing RGB pixels composited white.
 */
export function concatenateImages(images, axis = "horizontal") {
  validateAxis(axis);
  if (!Array.isArray(images) || images.length < 2) {
    throw new StitchValidationError("at least two images are required to stitch");
  }
  const inputs = images.map(validateConcatenationInput);
  const sharedDimension = axis === "horizontal" ? inputs[0].height : inputs[0].width;
  if (!inputs.every((image) => (axis === "horizontal" ? image.height : image.width) === sharedDimension)) {
    const description = axis === "horizontal" ? "equal heights" : "equal widths";
    const details = inputs
      .map((image, index) => `  image ${index + 1}: ${image.width}x${image.height}`)
      .join("\n");
    throw new StitchValidationError(`images must have ${description} for ${axis} stitching:\n${details}`);
  }

  const width = axis === "horizontal"
    ? inputs.reduce((total, image) => total + image.width, 0)
    : inputs[0].width;
  const height = axis === "vertical"
    ? inputs.reduce((total, image) => total + image.height, 0)
    : inputs[0].height;
  const data = new Uint8ClampedArray(width * height * 4);
  let offset = 0;

  for (const image of inputs) {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const sourcePixel = (y * image.width + x) * image.channels;
        const destinationPixel = axis === "horizontal"
          ? (y * width + offset + x) * 4
          : ((offset + y) * width + x) * 4;
        const alpha = image.channels === 4 ? image.data[sourcePixel + 3] / 255 : 1;
        const inverseAlpha = 1 - alpha;
        for (let channel = 0; channel < 3; channel += 1) {
          data[destinationPixel + channel] = image.data[sourcePixel + channel] * alpha
            + 255 * inverseAlpha;
        }
        data[destinationPixel + 3] = 255;
      }
    }
    offset += axis === "horizontal" ? image.width : image.height;
  }
  return { width, height, data };
}
