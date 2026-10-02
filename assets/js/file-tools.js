export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${(bytes / 1024 ** unit).toFixed(2)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

export function bindFileInput(input, dropzone, onFiles) {
  input.addEventListener("change", () => {
    if (input.files.length) onFiles(Array.from(input.files));
    input.value = "";
  });
  for (const event of ["dragenter", "dragover"]) {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault();
      dropzone.classList.add("dropzone--active");
    });
  }
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dropzone--active"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dropzone--active");
    if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
  });
  // Prevent accidental navigation when a file misses the drop target.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}
