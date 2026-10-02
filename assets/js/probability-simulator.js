const get = (id) => document.getElementById(id);
const experiments = {
  coin: { labels: ["Heads", "Tails"], probabilities: [0.5, 0.5], description: "Each trial flips one fair coin. Heads and tails each have a 50% chance." },
  dice: { labels: ["1", "2", "3", "4", "5", "6"], probabilities: Array(6).fill(1 / 6), description: "Each trial rolls one fair six-sided die. Each face has a 1 in 6 chance." },
  monty: { labels: ["Stay wins", "Switch wins"], probabilities: [1 / 3, 2 / 3], description: "Three doors, one prize. After your first choice, a host who knows the prize opens an unchosen goat door and always offers a switch. Each trial compares staying and switching on the same game; exactly one strategy wins." },
};
const experiment = get("experiment");
const error = get("tool-error");
let counts = [];
let total = 0;
let generation = 0;
let running = false;

export function trialOutcome(kind, random) {
  if (kind === "coin") return Math.floor(random * 2);
  if (kind === "dice") return Math.floor(random * 6);
  // The initial door can be fixed by symmetry: staying wins iff it holds the prize.
  if (kind === "monty") return Math.floor(random * 3) === 0 ? 0 : 1;
  throw new Error("Unknown experiment.");
}

function render() {
  const config = experiments[experiment.value];
  get("total-trials").textContent = `${total.toLocaleString("en-US")} trials`;
  get("results-body").replaceChildren();
  get("outcome-chart").replaceChildren();
  config.labels.forEach((label, index) => {
    const observed = total ? counts[index] / total : 0;
    const row = document.createElement("tr");
    const title = document.createElement("th");
    title.scope = "row";
    title.textContent = label;
    row.append(title);
    const values = [counts[index].toLocaleString("en-US"), total ? `${(observed * 100).toFixed(2)}%` : "—", `${(config.probabilities[index] * 100).toFixed(2)}%`, total ? `${((observed - config.probabilities[index]) * 100).toFixed(2)} pp` : "—"];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    get("results-body").append(row);
    const bar = document.createElement("div");
    bar.className = "outcome-row";
    const name = document.createElement("span");
    name.textContent = label;
    const track = document.createElement("div");
    track.className = "outcome-track";
    const fill = document.createElement("div");
    fill.className = "outcome-fill";
    fill.style.width = `${observed * 100}%`;
    track.append(fill);
    const value = document.createElement("span");
    value.textContent = total ? `${(observed * 100).toFixed(2)}%` : "—";
    bar.append(name, track, value);
    get("outcome-chart").append(bar);
  });
}

function setRunning(value) {
  running = value;
  get("run-button").disabled = value;
  get("stop-button").disabled = !value;
  get("trials").disabled = value;
}

function reset() {
  generation++;
  setRunning(false);
  counts = Array(experiments[experiment.value].labels.length).fill(0);
  total = 0;
  error.hidden = true;
  get("simulation-progress").hidden = true;
  get("experiment-description").textContent = experiments[experiment.value].description;
  get("tool-status").textContent = "Ready to simulate.";
  render();
}

experiment.addEventListener("change", reset);
get("reset-button").addEventListener("click", reset);
get("stop-button").addEventListener("click", () => {
  generation++;
  setRunning(false);
  get("tool-status").textContent = `Stopped. Kept ${total.toLocaleString("en-US")} completed trials.`;
});

get("simulation-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (running) return;
  error.hidden = true;
  const trials = get("trials").valueAsNumber;
  if (!Number.isInteger(trials) || trials < 1 || trials > 1_000_000 || total + trials > 10_000_000) {
    error.textContent = "Use 1–1,000,000 whole trials per run, with at most 10,000,000 total. Reset to start over.";
    error.hidden = false;
    return;
  }
  const current = ++generation;
  const kind = experiment.value;
  let done = 0;
  setRunning(true);
  const progress = get("simulation-progress");
  progress.hidden = false;
  progress.max = trials;
  progress.value = 0;
  get("tool-status").textContent = "Simulating…";
  function batch() {
    if (generation !== current) return;
    const limit = Math.min(done + 10000, trials);
    for (; done < limit; done++) {
      counts[trialOutcome(kind, Math.random())]++;
      total++;
    }
    progress.value = done;
    render();
    if (done < trials) {
      setTimeout(batch, 0);
    } else {
      setRunning(false);
      get("tool-status").textContent = `Finished ${trials.toLocaleString("en-US")} new trials. Run again to add more.`;
    }
  }
  setTimeout(batch, 0);
});
reset();
