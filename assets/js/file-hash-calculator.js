import { bindFileInput, formatBytes } from "./file-tools.js";

const get = (id) => document.getElementById(id);
const button = get("hash-button");
const status = get("tool-status");
const error = get("tool-error");
const expected = get("expected-hash");
const comparison = get("comparison");
let file = null;
let hash = "";
let revision = 0;

function compare() {
  const value = expected.value.trim();
  const valid = !value || /^[a-f\d]{64}$/i.test(value);
  expected.setAttribute("aria-invalid", String(!valid));
  comparison.dataset.state = !valid ? "error" : "";
  if (!valid) {
    comparison.textContent = "Expected SHA-256 must contain exactly 64 hexadecimal characters (0–9, a–f).";
  } else if (!hash) {
    comparison.textContent = "Calculate a checksum to compare.";
  } else if (!value) {
    comparison.textContent = "Paste an expected checksum to compare.";
  } else {
    const match = value.toLowerCase() === hash;
    comparison.textContent = match ? "Match — the checksums are identical." : "Mismatch — the checksums are different.";
    comparison.dataset.state = match ? "success" : "error";
  }
}

const supported = Boolean(globalThis.crypto?.subtle);
if (!supported) {
  error.textContent = "SHA-256 requires a browser with Web Crypto on HTTPS or localhost. Open this tool over a secure connection.";
  error.hidden = false;
}

bindFileInput(get("file-input"), get("dropzone"), (files) => {
  revision++;
  file = files.length === 1 ? files[0] : null;
  hash = "";
  get("hash-result").value = "";
  get("result-section").hidden = true;
  status.textContent = "";
  button.disabled = !file || !supported;
  if (supported) {
    error.hidden = Boolean(file);
    error.textContent = "Choose exactly one file at a time.";
  }
  get("file-details").textContent = file ? `${file.name} — ${formatBytes(file.size)}` : "No file selected.";
  compare();
});

button.addEventListener("click", async () => {
  if (!file || !supported) return;
  const current = ++revision;
  button.disabled = true;
  error.hidden = true;
  hash = "";
  get("hash-result").value = "";
  get("result-section").hidden = true;
  compare();
  status.textContent = "Reading file and calculating SHA-256…";
  try {
    const bytes = await file.arrayBuffer();
    if (current !== revision) return;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    if (current !== revision) return;
    hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    get("hash-result").value = hash;
    get("result-section").hidden = false;
    status.textContent = "SHA-256 calculated. Ready to copy or compare.";
    compare();
  } catch (cause) {
    if (current !== revision) return;
    status.textContent = "";
    error.textContent = `Could not hash this file. It may exceed available memory or no longer be readable. ${cause.message}`;
    error.hidden = false;
  } finally {
    if (current === revision) button.disabled = false;
  }
});

expected.addEventListener("input", compare);
get("copy-hash").addEventListener("click", async () => {
  const current = revision;
  try {
    await navigator.clipboard.writeText(hash);
    if (current === revision) status.textContent = "Checksum copied.";
  } catch {
    if (current !== revision) return;
    get("hash-result").focus();
    get("hash-result").select();
    status.textContent = "Clipboard access is unavailable. The checksum is selected; copy it manually.";
  }
});
