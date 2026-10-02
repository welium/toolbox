const choices = document.getElementById("choices");
const button = document.getElementById("spin-button");
const error = document.getElementById("tool-error");
const result = document.getElementById("wheel-result");
const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const tau = Math.PI * 2;
const colors = ["#006FBA", "#067647", "#7A3EB1", "#B54708", "#B42318", "#006B72"];
let items = [];
let rotation = 0;

export function parseChoices(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 50) throw new Error("Enter between 2 and 50 choices.");
  return lines.map((line, index) => {
    const parts = line.split("|");
    const label = parts[0].trim();
    const weight = parts.length === 1 ? 1 : Number(parts[1].trim());
    if (!label || label.length > 80 || parts.length > 2) {
      throw new Error(`Line ${index + 1}: use a label of 1–80 characters, optionally followed by | weight.`);
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > 1_000_000) {
      throw new Error(`Line ${index + 1}: weight must be a whole number from 1 to 1,000,000.`);
    }
    return { label, weight };
  });
}

export function pickChoice(options, random) {
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error("Random value must be in [0, 1).");
  const total = options.reduce((sum, item) => sum + item.weight, 0);
  const target = random * total;
  let before = 0;
  for (let i = 0; i < options.length; i++) {
    if (target < before + options[i].weight) return { index: i, center: tau * (before + options[i].weight / 2) / total };
    before += options[i].weight;
  }
  throw new Error("Random value must be in [0, 1).");
}

function refresh() {
  error.hidden = true;
  result.textContent = "Ready when you are.";
  canvas.style.transform = "rotate(0rad)";
  rotation = 0;
  const odds = document.getElementById("choice-odds");
  odds.replaceChildren();
  ctx?.clearRect(0, 0, 600, 600);
  try {
    if (!ctx || !globalThis.crypto?.getRandomValues) throw new Error("This tool requires Canvas 2D and browser randomness support.");
    items = parseChoices(choices.value);
    choices.setAttribute("aria-invalid", "false");
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let angle = -Math.PI / 2;
    items.forEach((item, index) => {
      const size = tau * item.weight / total;
      ctx.beginPath();
      ctx.moveTo(300, 300);
      ctx.arc(300, 300, 290, angle, angle + size);
      ctx.closePath();
      ctx.fillStyle = colors[index % colors.length];
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.stroke();
      if (size > 0.13) {
        ctx.save();
        ctx.translate(300, 300);
        ctx.rotate(angle + size / 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.textAlign = "right";
        ctx.font = "bold 20px sans-serif";
        ctx.fillText(item.label.length > 16 ? `${item.label.slice(0, 15)}…` : item.label, 265, 7, 205);
        ctx.restore();
      }
      const li = document.createElement("li");
      const label = document.createElement("span");
      const chance = document.createElement("span");
      label.textContent = item.label;
      const percentage = item.weight / total * 100;
      chance.textContent = percentage < 0.01 ? "<0.01%" : `${percentage.toFixed(2)}%`;
      li.append(label, chance);
      odds.append(li);
      angle += size;
    });
    button.disabled = false;
  } catch (cause) {
    items = [];
    choices.setAttribute("aria-invalid", "true");
    error.textContent = cause.message;
    error.hidden = false;
    button.disabled = true;
  }
}

choices.addEventListener("input", refresh);
button.addEventListener("click", async () => {
  if (!items.length || button.disabled) return;
  button.disabled = true;
  choices.disabled = true;
  result.textContent = "Spinning…";
  try {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    const selected = pickChoice(items, random);
    const next = rotation + 5 * tau + ((tau - selected.center - rotation % tau + tau) % tau);
    const animation = canvas.animate([
      { transform: `rotate(${rotation}rad)` },
      { transform: `rotate(${next}rad)` },
    ], { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 3200, easing: "cubic-bezier(.12,.75,.18,1)", fill: "forwards" });
    await animation.finished;
    rotation = next % tau;
    canvas.style.transform = `rotate(${rotation}rad)`;
    animation.cancel();
    result.textContent = `Selected: ${items[selected.index].label}`;
  } catch (cause) {
    error.textContent = `Could not spin the wheel. ${cause.message}`;
    error.hidden = false;
    result.textContent = "Try spinning again.";
  } finally {
    button.disabled = false;
    choices.disabled = false;
  }
});
refresh();
