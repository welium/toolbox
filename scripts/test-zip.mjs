import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip } from "../assets/js/zip.js";

test("stored ZIP contains UTF-8 names, valid CRCs, sizes, offsets, and original data", async () => {
  const files = [
    { name: "1-image.jpg", blob: new Blob(["123456789"]) },
    { name: "2-圖片.png", blob: new Blob([new Uint8Array([0, 255, 42])]) },
    { name: "3-empty.webp", blob: new Blob([]) },
  ];
  const zip = await createZip(files);
  assert.equal(zip.type, "application/zip");
  const buffer = await zip.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 8, true), files.length);
  assert.equal(view.getUint16(end + 10, true), files.length);
  let central = view.getUint32(end + 16, true);
  const directoryStart = central;
  let offset = 0;
  for (const [index, file] of files.entries()) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 6, true), 0x0800);
    assert.equal(view.getUint16(offset + 8, true), 0);
    assert.equal(view.getUint32(offset + 18, true), file.blob.size);
    assert.equal(view.getUint32(offset + 22, true), file.blob.size);
    const nameLength = view.getUint16(offset + 26, true);
    assert.equal(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength)), file.name);
    const dataStart = offset + 30 + nameLength;
    assert.deepEqual(bytes.slice(dataStart, dataStart + file.blob.size), new Uint8Array(await file.blob.arrayBuffer()));
    assert.equal(view.getUint32(central, true), 0x02014b50);
    assert.equal(view.getUint32(central + 42, true), offset);
    assert.equal(view.getUint32(central + 16, true), view.getUint32(offset + 14, true));
    if (index === 0) assert.equal(view.getUint32(offset + 14, true), 0xcbf43926);
    if (index === 2) assert.equal(view.getUint32(offset + 14, true), 0);
    central += 46 + nameLength;
    offset = dataStart + file.blob.size;
  }
  assert.equal(offset, directoryStart);
  assert.equal(central, end);
  assert.equal(view.getUint32(end + 12, true), end - directoryStart);
});

test("ZIP sanitizes path separators and rejects unsupported archive sizes", async () => {
  const zip = await createZip([{ name: "../folder\\image.jpg", blob: new Blob([]) }]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 49)), ".._folder_image.jpg");
  await assert.rejects(() => createZip([]), /require/);
  await assert.rejects(() => createZip(Array(65536)), /require/);
  await assert.rejects(() => createZip([{ name: "x", blob: { size: 0xffffffff } }]), /4 GiB/);
  await assert.rejects(() => createZip([{ name: "x".repeat(65536), blob: new Blob([]) }]), /filename/);
});
