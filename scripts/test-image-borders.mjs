import { test } from "node:test";
import assert from "node:assert/strict";
import { detectImageBorder, borderColorLabel } from "../assets/js/image-borders.js";

function fixture(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return {
    width, height, data,
    getImageData(x, y, w, h) {
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) {
        const start = ((y + row) * width + x) * 4;
        pixels.set(data.subarray(start, start + w * 4), row * w * 4);
      }
      return { data: pixels };
    },
  };
}

function bordered(color, crop = { x: 2, y: 3, w: 7, h: 5 }) {
  return fixture(12, 11, (x, y) => x >= crop.x && y >= crop.y && x < crop.x + crop.w && y < crop.y + crop.h
    ? [(x % 2) * 200, 100 + y, 140, 255] : color);
}

const detect = (image, tolerance = 16, current) => detectImageBorder(image, image.width, image.height, tolerance, current);

test("black, white, arbitrary colors and asymmetric borders", async () => {
  for (const color of [[0, 0, 0, 255], [255, 255, 255, 255], [42, 71, 190, 255]]) {
    const result = await detect(bordered(color), 0);
    assert.equal(result.kind, "trim");
    assert.deepEqual(result.crop, { x: 2, y: 3, w: 7, h: 5 });
    assert.deepEqual(result.removed, { left: 2, top: 3, right: 3, bottom: 3 });
    assert.equal(borderColorLabel(result.color), `#${color.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("")}`);
  }
});

test("letterboxing, pillarboxing, and a single bordered side", async () => {
  for (const crop of [{ x: 0, y: 2, w: 12, h: 7 }, { x: 2, y: 0, w: 8, h: 11 }, { x: 0, y: 2, w: 12, h: 9 }]) {
    const result = await detect(bordered([0, 0, 0, 255], crop), 0);
    assert.equal(result.kind, "trim");
    assert.deepEqual(result.crop, crop);
  }
});

test("noise tolerance and strict matching", async () => {
  const image = fixture(12, 11, (x, y) => {
    if (x >= 2 && x < 9 && y >= 3 && y < 8) return [180, 70 + x, 30 + y, 255];
    const noise = (x + y) % 7;
    return [250 + noise, 250 + noise, 250 + noise, 255];
  });
  assert.equal((await detect(image, 0)).kind, "none");
  assert.deepEqual((await detect(image, 16)).crop, { x: 2, y: 3, w: 7, h: 5 });
});

test("higher tolerance removes near-matching inner border pixels without a leftover rim", async () => {
  for (const base of [0, 255]) {
    const image = fixture(14, 12, (x, y) => {
      if (x >= 3 && x < 11 && y >= 3 && y < 9) return [180, 70, 130, 255];
      const innerBorder = x >= 2 && x < 12 && y >= 2 && y < 10;
      const gray = innerBorder ? (base === 0 ? 25 : 230) : base;
      return [gray, gray, gray, 255];
    });
    assert.deepEqual((await detect(image, 16)).crop, { x: 2, y: 2, w: 10, h: 8 });
    assert.deepEqual((await detect(image, 32)).crop, { x: 3, y: 3, w: 8, h: 6 });
  }
});

test("transparent and partially transparent borders", async () => {
  const transparent = fixture(8, 8, (x, y) => x >= 2 && x < 6 && y >= 2 && y < 6 ? [0, 0, 0, 255] : [x * 20, y * 20, 240, 0]);
  const result = await detect(transparent, 0);
  assert.deepEqual(result.crop, { x: 2, y: 2, w: 4, h: 4 });
  assert.equal(borderColorLabel(result.color), "transparent");
  const partial = await detect(bordered([80, 120, 160, 128]), 0);
  assert.equal(partial.kind, "trim");
  assert.equal(borderColorLabel(partial.color), "#5078a0 (50% opacity)");
});

test("no border, uniform images, and conflicting edge colors", async () => {
  const textured = fixture(12, 11, (x, y) => [(x % 2) * 255, (y % 2) * 255, 70, 255]);
  assert.equal((await detect(textured)).kind, "none");
  for (const color of [[255, 255, 255, 255], [0, 0, 0, 0]]) {
    assert.equal((await detect(fixture(8, 8, () => color), 0)).kind, "uniform");
  }
  const conflict = fixture(12, 11, (x, y) => y === 0 ? [0, 0, 0, 255] : y === 10 ? [255, 255, 255, 255] : [(x % 2) * 255, 120, y * 10, 255]);
  assert.equal((await detect(conflict)).kind, "ambiguous");
});

test("retains thin content and content touching an edge", async () => {
  const thin = fixture(7, 7, (x, y) => x === 3 && y === 3 ? [255, 0, 0, 255] : [0, 0, 0, 255]);
  assert.deepEqual((await detect(thin, 0)).crop, { x: 3, y: 3, w: 1, h: 1 });
  const touching = fixture(7, 7, (x, y) => (x >= 2 && x < 5 && y >= 2 && y < 5) || (x === 3 && y === 0)
    ? [255, 0, 0, 255] : [0, 0, 0, 255]);
  assert.deepEqual((await detect(touching, 0)).crop, { x: 2, y: 0, w: 3, h: 5 });
});

test("verification catches isolated pixels between color samples", async () => {
  const image = fixture(600, 3, (x, y) => (y === 0 && x === 301) || (y === 2 && x === 302) || (x === 0 && y === 1) || (x === 599 && y === 1)
    ? [255, 0, 0, 255] : [0, 0, 0, 255]);
  assert.equal((await detect(image, 0)).kind, "none");
});

test("low-contrast content is preserved at lower tolerance", async () => {
  const image = fixture(8, 8, (x, y) => x >= 2 && x < 6 && y >= 2 && y < 6 ? [240, 240, 240, 255] : [255, 255, 255, 255]);
  assert.equal((await detect(image, 16)).kind, "uniform");
  assert.deepEqual((await detect(image, 0)).crop, { x: 2, y: 2, w: 4, h: 4 });
});

test("input validation and cancellation", async () => {
  const image = bordered([0, 0, 0, 255]);
  for (const tolerance of [-1, 65, 1.5, NaN]) await assert.rejects(() => detect(image, tolerance));
  await assert.rejects(() => detectImageBorder(image, 0, 8, 16));
  assert.equal(await detect(image, 16, () => false), null);
});
