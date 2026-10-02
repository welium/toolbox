// Run with: playwright-cli run-code --filename=scripts/test-remove-image-borders.js
// Serve the repository at http://127.0.0.1:8000 first.
async (page) => {
  const base = "http://127.0.0.1:8000";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const upload = async (kind, name = `${kind}.png`) => {
    await page.evaluate(({ kind, name }) => {
      const canvas = document.createElement("canvas");
      canvas.width = kind === "large" ? 16385 : 12;
      canvas.height = kind === "large" ? 1 : 10;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = { black: "black", white: "white", custom: "#2947be", uniform: "white", large: "black", noise: "white", rim: "white", lowContrast: "white", none: "white", transparent: "rgba(0,0,0,0)" }[kind];
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (kind !== "uniform" && kind !== "large") {
        if (kind === "none") {
          for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) {
            ctx.fillStyle = (x + y) % 2 ? "red" : "lime";
            ctx.fillRect(x, y, 1, 1);
          }
        } else {
          if (kind === "noise") {
            for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) {
              const gray = 250 + (x + y) % 6;
              ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
              ctx.fillRect(x, y, 1, 1);
            }
          }
          if (kind === "rim") {
            ctx.fillStyle = "#e6e6e6";
            ctx.fillRect(1, 2, 9, 7);
          }
          ctx.fillStyle = kind === "lowContrast" ? "#f0f0f0" : "lime";
          ctx.fillRect(2, 3, 7, 5);
          if (kind === "transparent") ctx.clearRect(4, 4, 1, 1);
        }
      }
      const input = document.getElementById("image-input");
      const transfer = new DataTransfer();
      const encoded = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), (char) => char.charCodeAt(0));
      transfer.items.add(new File([encoded], name, { type: "image/png" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, { kind, name });
    await page.locator("#border-form").waitFor({ state: "visible" });
  };
  const run = async () => {
    await page.locator("#remove-borders").click();
    await page.waitForFunction(() => !document.getElementById("remove-borders").disabled);
  };
  const pixels = () => page.evaluate(async () => {
    const image = document.getElementById("result-preview");
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base);
  assert(await page.locator('a[href="tools/remove-image-borders/"]').count() === 1, "Standalone border tool should be registered");
  await page.goto(`${base}/tools/remove-image-borders/`);
  assert(!await page.locator("#border-form").isVisible(), "Processing should require a selected image");
  assert(await page.locator("#output-format").inputValue() === "image/jpeg", "Default format should be JPG");
  assert(await page.locator("#quality").inputValue() === "100", "Default quality should be 100");
  assert(await page.locator("#border-tolerance").inputValue() === "32", "Default tolerance should accept near-matching border colors");
  await page.evaluate(() => {
    window.defaultToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, mime, quality) {
      window.exportOptions = { mime, quality };
      window.defaultToBlob.call(this, callback, mime, quality);
    };
  });
  await upload("rim");
  await run();
  assert((await page.locator("#download-image").getAttribute("download")).endsWith("7x5.jpg"), "Default should remove the near-matching rim and export JPG");
  assert(await page.evaluate(() => window.exportOptions.mime === "image/jpeg" && window.exportOptions.quality === 1), "Encoder must receive JPEG quality 1");
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.defaultToBlob; });
  await page.locator("#output-format").selectOption("image/png");
  for (const [kind, color] of [["black", "#000000"], ["white", "#ffffff"], ["custom", "#2947be"]]) {
    await upload(kind);
    await run();
    assert(await page.locator("#result-section").isVisible(), `${kind} result preview`);
    assert((await page.locator("#border-report").textContent()).includes(color), `${kind} detected color`);
    assert((await page.locator("#border-report").textContent()).includes("2 px left, 3 px top, 3 px right, 2 px bottom"), "Asymmetric trim report");
    const output = await pixels();
    assert(output.width === 7 && output.height === 5, "Trimmed dimensions must preserve pixel scale");
    assert(output.data.every((n, i) => n === [0, 255, 0, 255][i % 4]), "Border removed without altering content pixels");
  }
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-image").click();
  const download = await downloadEvent;
  assert(download.suggestedFilename() === "custom-trimmed-7x5.png", "Download filename");
  assert(await download.failure() === null, "Download should succeed");

  await upload("transparent");
  await run();
  assert((await page.locator("#border-report").textContent()).includes("transparent"), "Transparent border detection");
  let output = await pixels();
  assert(output.data.filter((n, i) => i % 4 === 3 && n === 0).length === 1, "Keep interior transparency");
  await page.locator("#output-format").selectOption("image/jpeg");
  assert(!await page.locator("#result-section").isVisible(), "Changing options should remove old download");
  assert(await page.locator("#quality").isEnabled(), "JPEG quality controls");
  await run();
  assert((await page.locator("#download-image").getAttribute("download")).endsWith(".jpg"), "JPEG export");
  output = await pixels();
  assert(output.data.filter((n, i) => i % 4 === 3 && n !== 255).length === 0, "JPEG must be opaque");
  await page.locator("#output-format").selectOption("image/webp");
  await run();
  assert((await page.locator("#download-image").getAttribute("download")).endsWith(".webp"), "WebP export");
  await page.locator("#output-format").selectOption("image/png");

  for (const kind of ["none", "uniform"]) {
    await upload(kind);
    await run();
    assert(!await page.locator("#result-section").isVisible(), `${kind} must not produce an incorrect crop`);
    assert((await page.locator("#tool-status").textContent()).includes("Nothing trimmed"), `${kind} explanation`);
  }
  await upload("noise");
  await page.locator("#border-tolerance").fill("0");
  await run();
  assert(!await page.locator("#result-section").isVisible(), "Strict tolerance rejects noisy edges");
  await page.locator("#border-tolerance").fill("16");
  await run();
  assert(await page.locator("#result-section").isVisible(), "Tolerance should accept compression-like noise");
  await upload("lowContrast");
  await run();
  assert(!await page.locator("#result-section").isVisible(), "Uniform-at-tolerance image must not be emptied");
  await page.locator("#border-tolerance").fill("0");
  await run();
  assert(await page.locator("#result-section").isVisible(), "Lower tolerance should retain faint content");
  await page.locator("#border-tolerance").fill("65");
  assert(await page.locator("#border-tolerance").evaluate((input) => !input.checkValidity()), "Tolerance bound validation");
  await page.locator("#border-tolerance").fill("16");
  await upload("large");
  await run();
  assert((await page.locator("#tool-error").textContent()).includes("16,384"), "Allocation guard");

  await upload("black");
  await page.evaluate(() => {
    window.originalTimeout = window.setTimeout;
    window.setTimeout = (callback) => { window.releaseScan = callback; return 1; };
  });
  await page.locator("#remove-borders").click();
  await page.waitForFunction(() => Boolean(window.releaseScan));
  await page.locator("#border-tolerance").fill("0");
  await page.evaluate(() => {
    window.setTimeout = window.originalTimeout;
    window.releaseScan();
  });
  assert(!await page.locator("#result-section").isVisible(), "Option changes must cancel pending detection");
  assert(await page.locator("#remove-borders").isEnabled(), "Cancelled scan should leave controls usable");
  await page.locator("#border-tolerance").fill("16");

  await page.evaluate(() => {
    window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null);
  });
  await run();
  assert((await page.locator("#tool-error").textContent()).includes("encoding failed"), "Encoding failures should be reported");
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(new Blob(["fallback"], { type: "image/png" }));
  });
  await page.locator("#output-format").selectOption("image/webp");
  await run();
  assert((await page.locator("#tool-error").textContent()).includes("cannot export"), "Unsupported formats must not silently use PNG");
  await page.locator("#output-format").selectOption("image/png");
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      window.releaseEncode = () => window.originalToBlob.call(this, callback, ...args);
    };
  });
  await page.locator("#remove-borders").click();
  await page.waitForFunction(() => Boolean(window.releaseEncode));
  await upload("white", "new.png");
  await page.evaluate(() => window.releaseEncode());
  assert(!await page.locator("#result-section").isVisible(), "Stale encoding must not replace a new selection");
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob; });

  await page.setViewportSize({ width: 375, height: 812 });
  await run();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile results must not overflow");

  const uploadBatch = async (allSkipped = false) => {
    await page.evaluate((allSkipped) => {
      const canvas = document.createElement("canvas");
      canvas.width = 12;
      canvas.height = 10;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 12, 10);
      const uniform = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (char) => char.charCodeAt(0));
      ctx.fillStyle = "lime";
      ctx.fillRect(2, 3, 7, 5);
      const bordered = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      const inputs = allSkipped
        ? [["one.png", uniform], ["two.png", uniform], ["three.png", uniform], ["four.png", uniform]]
        : [["same.png", bordered], ["uniform.png", uniform], ["broken.png", "invalid"], ["same.png", bordered]];
      for (const [name, data] of inputs) {
        transfer.items.add(new File([data], name, { type: "image/png" }));
      }
      // Exercise multi-file drops, not just the file picker.
      document.getElementById("dropzone").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, allSkipped);
    await page.waitForFunction(() => document.getElementById("file-details").textContent.startsWith("4 images"));
  };
  await page.locator("#output-format").selectOption("image/jpeg");
  await uploadBatch();
  assert(!await page.locator("#source-section").isVisible(), "Batch should clear single-image preview");
  await run();
  assert((await page.locator("#tool-status").textContent()).includes("2 trimmed, 1 skipped, 1 failed"), "Batch must skip no-border images and continue after corrupt files");
  assert(await page.locator("#batch-results article").count() === 4, "Every batch image should have a report");
  assert(await page.locator("#batch-results img").count() === 2, "Successful batch images should have previews");
  const names = await page.locator("#batch-results a").evaluateAll((links) => links.map((link) => link.download));
  assert(names[0] === "1-same-trimmed-7x5.jpg" && names[1] === "4-same-trimmed-7x5.jpg", "Batch filenames must not collide");
  const individualEvent = page.waitForEvent("download");
  await page.locator("#batch-results a").first().click();
  assert(await (await individualEvent).failure() === null, "Individual batch download");
  const zipEvent = page.waitForEvent("download");
  await page.locator("#download-batch").click();
  const zip = await zipEvent;
  assert(zip.suggestedFilename() === "trimmed-images.zip" && await zip.failure() === null, "Batch ZIP download");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile batch results must not overflow");
  await page.locator("#border-tolerance").fill("32");
  assert(!await page.locator("#batch-section").isVisible() && await page.locator("#download-batch").isDisabled(), "Changing batch options must clear old downloads");

  await page.evaluate(() => {
    window.originalBatchTimeout = window.setTimeout;
    window.setTimeout = (callback) => { window.releaseBatchScan = callback; return 1; };
  });
  await page.locator("#remove-borders").click();
  await page.waitForFunction(() => Boolean(window.releaseBatchScan));
  await upload("white", "after-batch.png");
  await page.evaluate(() => {
    window.setTimeout = window.originalBatchTimeout;
    window.releaseBatchScan();
  });
  assert(!await page.locator("#batch-section").isVisible(), "New selection must cancel batch and clear its output");
  await run();
  assert((await page.locator("#download-image").getAttribute("download")).startsWith("after-batch-"), "Single-image mode should work after cancelling a batch");
  await uploadBatch(true);
  await run();
  assert((await page.locator("#tool-status").textContent()).includes("0 trimmed, 4 skipped, 0 failed"), "Batch with no removable borders must not generate incorrect outputs");
  assert(await page.locator("#download-batch").isDisabled() && await page.locator("#batch-results a").count() === 0, "Empty batch must not offer a download");
  await page.evaluate(() => {
    const input = document.getElementById("image-input");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["invalid"], "broken.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await page.locator("#tool-error").waitFor({ state: "visible" });
  assert(!await page.locator("#border-form").isVisible() && !await page.locator("#result-section").isVisible(), "Bad input must clear previous results");
  assert(errors.length === 0, `Unexpected browser errors: ${errors.join(", ")}`);
  return "PASS: JPG/quality-100 defaults, near-matching rims, border detection/pixels, formats/downloads, validation/failures, batch drops/previews/ZIP/duplicate names/partial failure/cancellation, stale scan/encoding protection, and mobile layout.";
}
