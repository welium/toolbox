// Run with: playwright-cli run-code --filename=scripts/test-file-tools.js
// Serve the repository at http://127.0.0.1:8000 first.
async (page) => {
  const base = "http://127.0.0.1:8000";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const upload = (id, name, mimeType, content, base64 = false) => page.evaluate(({ id, name, mimeType, content, base64 }) => {
    const bytes = base64 ? Uint8Array.from(atob(content), (char) => char.charCodeAt(0)) : content;
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: mimeType }));
    const input = document.getElementById(id);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { id, name, mimeType, content, base64 });
  const drop = (id, files) => page.evaluate(({ id, files }) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([file.content], file.name));
    document.getElementById(id).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { id, files });
  const resultPixels = () => page.evaluate(async () => {
    const img = document.getElementById("result-preview");
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { width: canvas.width, height: canvas.height, pixels: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
  });

  await page.goto(base);
  assert(await page.getByRole("link", { name: "Open tool" }).count() === 3, "Home should register three tools");
  await page.goto(`${base}/tools/image-resizer-converter/`);
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 6;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillStyle = "lime";
    ctx.fillRect(4, 0, 4, 4);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await upload("image-input", "sample.png", "image/png", fixture, true);
  await page.locator("#image-form").waitFor({ state: "visible" });
  assert(await page.locator("#output-width").inputValue() === "8", "Initial output dimensions");
  await page.locator("#crop-width").fill("4");
  await page.locator("#crop-x").fill("4");
  await page.locator("#crop-height").fill("4");
  await page.locator("#output-width").fill("2");
  assert(await page.locator("#output-height").inputValue() === "2", "Aspect ratio should follow crop");
  await page.locator("#convert-button").click();
  await page.locator("#result-section").waitFor({ state: "visible" });
  let output = await resultPixels();
  assert(output.width === 2 && output.height === 2, "Resized dimensions");
  assert(output.pixels.every((value, i) => value === [0, 255, 0, 255][i % 4]), "Crop should retain only green region");
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-image").click();
  const download = await downloadEvent;
  assert(download.suggestedFilename() === "sample-2x2.png", "PNG download filename");
  assert(await download.failure() === null, "Download should succeed");

  await page.locator("#reset-crop").click();
  assert(!await page.locator("#result-section").isVisible(), "Changing options should invalidate output");
  await page.locator("#convert-button").click();
  await page.locator("#result-section").waitFor({ state: "visible" });
  output = await resultPixels();
  assert(output.pixels.at(-1) === 0, "PNG should retain transparency");
  await page.locator("#output-format").selectOption("image/jpeg");
  assert(await page.locator("#quality").isEnabled(), "JPEG should enable quality");
  await page.locator("#convert-button").click();
  await page.locator("#result-section").waitFor({ state: "visible" });
  output = await resultPixels();
  assert(output.pixels.slice(-4).every((n) => n >= 250), "JPEG transparent area should be white");
  assert((await page.locator("#download-image").getAttribute("download")).endsWith(".jpg"), "JPEG extension");
  await page.locator("#output-format").selectOption("image/webp");
  await page.locator("#convert-button").click();
  await page.locator("#result-section").waitFor({ state: "visible" });
  output = await resultPixels();
  assert(output.pixels.at(-1) === 0, "WebP should retain transparency");
  assert((await page.locator("#download-image").getAttribute("download")).endsWith(".webp"), "WebP extension");

  await page.locator("#lock-ratio").uncheck();
  await page.locator("#output-width").fill("3");
  await page.locator("#output-height").fill("5");
  await page.locator("#convert-button").click();
  await page.locator("#result-section").waitFor({ state: "visible" });
  output = await resultPixels();
  assert(output.width === 3 && output.height === 5, "Unlocked ratio should allow stretching");
  await page.locator("#crop-x").fill("7");
  assert(await page.locator("#tool-error").isVisible(), "Out-of-bounds crop should be rejected");
  await page.locator("#reset-crop").click();
  await page.locator("#output-width").fill("16385");
  await page.locator("#convert-button").click();
  assert((await page.locator("#tool-error").textContent()).includes("too large"), "Allocation limit should be enforced");
  await upload("image-input", "broken.png", "image/png", "not an image");
  await page.locator("#tool-error").waitFor({ state: "visible" });
  assert(!await page.locator("#image-form").isVisible(), "Bad input must clear previous image");

  await upload("image-input", "sample.png", "image/png", fixture, true);
  await page.locator("#image-form").waitFor({ state: "visible" });
  await page.evaluate(() => {
    window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null);
  });
  await page.locator("#convert-button").click();
  assert((await page.locator("#tool-error").textContent()).includes("encoding failed"), "Null blob encoding failure");
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(new Blob(["fallback"], { type: "image/png" }));
  });
  await page.locator("#output-format").selectOption("image/webp");
  await page.locator("#convert-button").click();
  assert((await page.locator("#tool-error").textContent()).includes("cannot export"), "Unsupported output must not silently use PNG");
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      window.releaseEncode = () => window.originalToBlob.call(this, callback, ...args);
    };
  });
  await page.locator("#output-format").selectOption("image/png");
  await page.locator("#convert-button").click();
  await page.locator("#output-width").fill("4");
  await page.evaluate(() => window.releaseEncode());
  assert(!await page.locator("#result-section").isVisible(), "Stale encoding must not restore a download");
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob; });

  // Hold the first decode; a later selection must win even if the first finishes last.
  await page.evaluate(() => {
    const decode = createImageBitmap;
    let first = true;
    window.createImageBitmap = (...args) => {
      if (!first) return decode(...args);
      first = false;
      return new Promise((resolve) => { window.releaseDecode = async () => resolve(await decode(...args)); });
    };
  });
  await upload("image-input", "old.png", "image/png", fixture, true);
  await upload("image-input", "new.png", "image/png", fixture, true);
  await page.locator("#image-form").waitFor({ state: "visible" });
  await page.evaluate(() => window.releaseDecode());
  assert((await page.locator("#file-details").textContent()).startsWith("new.png"), "Stale decode must not replace new image");

  await page.goto(`${base}/tools/file-hash-calculator/`);
  assert(await page.locator("#hash-button").isDisabled(), "Hash action should require a file");
  await upload("file-input", "abc.txt", "text/plain", "abc");
  await page.locator("#hash-button").click();
  await page.locator("#result-section").waitFor({ state: "visible" });
  const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert(await page.locator("#hash-result").inputValue() === abc, "SHA-256 abc known vector");
  await page.locator("#expected-hash").fill(`  ${abc.toUpperCase()}\n`);
  assert((await page.locator("#comparison").textContent()).startsWith("Match"), "Comparison should accept case and surrounding whitespace");
  await page.locator("#expected-hash").fill("0".repeat(64));
  assert((await page.locator("#comparison").textContent()).startsWith("Mismatch"), "Mismatch feedback");
  await page.locator("#expected-hash").fill("invalid");
  assert(await page.locator("#expected-hash").getAttribute("aria-invalid") === "true", "Malformed expected hash validation");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator("#copy-hash").click();
  assert(await page.evaluate(() => navigator.clipboard.readText()) === abc, "Copy checksum");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error("Permission denied"); };
  });
  await page.locator("#copy-hash").click();
  await page.waitForFunction(() => document.getElementById("tool-status").textContent.includes("copy it manually"));
  assert(await page.evaluate(() => {
    const field = document.getElementById("hash-result");
    return document.activeElement === field && field.selectionEnd - field.selectionStart === 64;
  }), "Clipboard fallback should select full checksum");

  await upload("file-input", "empty.bin", "application/octet-stream", "");
  assert(!await page.locator("#result-section").isVisible(), "New file should clear hash");
  await page.locator("#hash-button").click();
  await page.locator("#result-section").waitFor({ state: "visible" });
  assert(await page.locator("#hash-result").inputValue() === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "Empty file known vector");
  await drop("dropzone", [{ name: "a", content: "a" }, { name: "b", content: "b" }]);
  assert(await page.locator("#hash-button").isDisabled(), "Multiple dropped files should be rejected");
  assert(await page.locator("#tool-error").isVisible(), "Multiple file error feedback");
  await drop("dropzone", [{ name: "abc.txt", content: "abc" }]);
  await page.locator("#hash-button").click();
  await page.locator("#result-section").waitFor({ state: "visible" });
  assert(await page.locator("#hash-result").inputValue() === abc, "Single dropped file should hash");

  // Hold an old digest pending, select a new file, then release the old result.
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = (...args) => new Promise((resolve) => {
      window.releaseDigest = async () => resolve(await digest(...args));
    });
  });
  await page.locator("#hash-button").click();
  await page.waitForFunction(() => Boolean(window.releaseDigest));
  await upload("file-input", "new.txt", "text/plain", "new");
  await page.evaluate(() => window.releaseDigest());
  assert(!await page.locator("#result-section").isVisible(), "Stale digest should not replace new selection");

  await page.reload();
  await page.evaluate(() => { crypto.subtle.digest = async () => { throw new Error("Simulated failure"); }; });
  await upload("file-input", "abc.txt", "text/plain", "abc");
  await page.locator("#hash-button").click();
  await page.locator("#tool-error").waitFor({ state: "visible" });
  assert(!await page.locator("#hash-button").isDisabled(), "Hash failure should permit retry");
  assert(!await page.locator("#result-section").isVisible(), "Failed hash must not show a result");

  for (const tool of ["image-resizer-converter", "file-hash-calculator"]) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${base}/tools/${tool}/`);
    if (tool === "image-resizer-converter") {
      await upload("image-input", "sample.png", "image/png", fixture, true);
      await page.locator("#image-form").waitFor({ state: "visible" });
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tool} mobile overflow`);
  }
  assert(errors.length === 0, `Unexpected browser errors: ${errors.join(", ")}`);
  return "PASS: registry, crop pixels, aspect ratio, PNG/JPEG/WebP, downloads, validation, encoding failures, stale decode/encode protection, SHA-256 vectors, comparison, clipboard and fallback, drops, hash failure and stale hash protection, mobile layout.";
}
