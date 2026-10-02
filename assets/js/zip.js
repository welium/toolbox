const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

// Store already-compressed images without recompression. ZIP32 keeps the writer
// small; reject larger archives instead of silently wrapping lengths or offsets.
export async function createZip(files) {
  if (!files.length || files.length > 65535) throw new Error("ZIP downloads require 1–65,535 files.");
  const parts = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  for (const { name, blob } of files) {
    const filename = new TextEncoder().encode(name.replace(/[\\/\x00-\x1f]/g, "_"));
    if (!filename.length || filename.length > 65535) throw new Error("A ZIP filename is too short or too long.");
    const localSize = 30 + filename.length + blob.size;
    directorySize += 46 + filename.length;
    if (offset + localSize + directorySize + 22 > 0xffffffff) throw new Error("ZIP downloads must be smaller than 4 GiB. Download images individually instead.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes);
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true); // UTF-8 filenames.
    local.view.setUint16(12, 0x0021, true); // January 1, 1980; source metadata is not preserved.
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, blob.size, true);
    local.view.setUint32(22, blob.size, true);
    local.view.setUint16(26, filename.length, true);
    parts.push(local.bytes, filename, blob);

    const central = header(46);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(14, 0x0021, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, blob.size, true);
    central.view.setUint32(24, blob.size, true);
    central.view.setUint16(28, filename.length, true);
    central.view.setUint32(42, offset, true);
    directory.push(central.bytes, filename);
    offset += localSize;
  }
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, directorySize, true);
  end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end.bytes], { type: "application/zip" });
}
