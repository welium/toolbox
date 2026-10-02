import { buildSlots, canonicalZone } from "./timezone-planner.js";

const get = (id) => document.getElementById(id);
const error = get("tool-error");
const participants = [];
let nextId = 0;
let slots = [];
let selectedTime = null;
let revision = 0;

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

function addParticipant(zone) {
  const canonical = canonicalZone(zone);
  if (participants.length >= 6) throw new Error("At most 6 timezones can be compared. Remove one before adding another.");
  if (participants.some((person) => person.zone === canonical)) throw new Error("That timezone is already in the planner.");
  participants.push({ id: nextId++, zone: canonical, start: "09:00", end: "17:00", days: "weekdays" });
}

function renderParticipants() {
  get("participants").replaceChildren();
  for (const person of participants) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "participant-card";
    const legend = document.createElement("legend");
    legend.textContent = person.zone.replaceAll("_", " ");
    fieldset.append(legend);
    const grid = document.createElement("div");
    grid.className = "compact-grid";
    for (const [key, labelText] of [["start", "Work starts"], ["end", "Work ends"], ["days", "Working days"]]) {
      const field = document.createElement("div");
      field.className = "field-control";
      const label = document.createElement("label");
      const id = `participant-${person.id}-${key}`;
      label.htmlFor = id;
      label.textContent = labelText;
      const input = document.createElement(key === "days" ? "select" : "input");
      input.id = id;
      if (key === "days") {
        for (const [value, text] of [["weekdays", "Monday–Friday"], ["everyday", "Every day"]]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          input.append(option);
        }
      } else {
        input.type = "time";
        input.step = "60";
        input.required = true;
      }
      input.value = person[key];
      input.addEventListener("change", () => { person[key] = input.value; update(); });
      field.append(label, input);
      grid.append(field);
    }
    fieldset.append(grid);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-file";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${person.zone}`);
    remove.addEventListener("click", () => {
      participants.splice(participants.indexOf(person), 1);
      renderParticipants();
      update();
      get("zone-input").focus();
    });
    fieldset.append(remove);
    get("participants").append(fieldset);
  }
}

function selectSlot(slot) {
  revision++;
  selectedTime = slot.time;
  get("selection-section").hidden = false;
  get("selection-availability").textContent = slot.available ? "Within everyone's working hours" : "Outside at least one timezone's working hours";
  const end = new Date(slot.time + Number(get("duration").value) * 60000).toISOString();
  get("meeting-summary").value = [
    `Meeting (${get("duration").value} minutes)`,
    `UTC: ${new Date(slot.time).toISOString()} – ${end}`,
    ...slot.cells.map((cell) => `${cell.zone}: ${cell.text} – ${cell.endText}${cell.available ? "" : " [outside working hours]"}`),
  ].join("\n");
  get("copy-status").textContent = "";
  for (const row of get("slots-body").children) row.classList.toggle("slot-selected", Number(row.dataset.time) === selectedTime);
}

function renderSlots() {
  const head = document.createElement("tr");
  for (const title of ["Start (UTC)", ...participants.map((person) => person.zone.replaceAll("_", " ")), "Shared hours"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = title;
    head.append(cell);
  }
  get("slots-head").replaceChildren(head);
  get("slots-body").replaceChildren();
  const count = slots.filter((slot) => slot.available).length;
  get("slot-summary").textContent = `${count} of 48 start times fit everyone.`;
  get("no-overlap").hidden = count > 0;
  get("table-caption").textContent = `${get("meeting-date").value} UTC — ${get("duration").value}-minute meetings. Local dates and offsets shown for every city.`;
  for (const slot of slots) {
    if (get("only-overlap").checked && !slot.available) continue;
    const row = document.createElement("tr");
    row.dataset.time = slot.time;
    row.classList.toggle("slot-overlap", slot.available);
    row.classList.toggle("slot-selected", slot.time === selectedTime);
    const start = document.createElement("th");
    start.scope = "row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slot-button";
    button.textContent = slot.utc;
    button.setAttribute("aria-label", `Select ${slot.utc} UTC`);
    button.addEventListener("click", () => selectSlot(slot));
    start.append(button);
    row.append(start);
    for (const value of slot.cells) {
      const cell = document.createElement("td");
      const time = document.createElement("span");
      time.textContent = value.text;
      const availability = document.createElement("span");
      availability.className = `slot-availability${value.available ? " slot-availability--working" : ""}`;
      availability.textContent = value.available ? "Working hours" : "Outside hours";
      cell.append(time, availability);
      row.append(cell);
    }
    const shared = document.createElement("td");
    shared.textContent = slot.available ? "Yes" : "No";
    row.append(shared);
    get("slots-body").append(row);
  }
}

function update() {
  revision++;
  error.hidden = true;
  selectedTime = null;
  get("selection-section").hidden = true;
  get("meeting-summary").value = "";
  try {
    slots = buildSlots(get("meeting-date").value, Number(get("duration").value), participants);
    renderSlots();
  } catch (cause) {
    slots = [];
    get("slots-head").replaceChildren();
    get("slots-body").replaceChildren();
    get("slot-summary").textContent = "";
    get("no-overlap").hidden = true;
    showError(cause.message);
  }
}

get("add-zone-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const input = get("zone-input");
    addParticipant(input.value.trim());
    input.setAttribute("aria-invalid", "false");
    input.value = "";
    renderParticipants();
    update();
  } catch (cause) {
    get("zone-input").setAttribute("aria-invalid", "true");
    showError(cause instanceof RangeError ? "Unknown timezone. Choose an IANA name from the suggestions or enter UTC." : cause.message);
  }
});
get("meeting-date").addEventListener("change", update);
get("duration").addEventListener("change", update);
get("only-overlap").addEventListener("change", () => { if (slots.length) renderSlots(); });
get("copy-meeting").addEventListener("click", async () => {
  const current = revision;
  const value = get("meeting-summary").value;
  try {
    await navigator.clipboard.writeText(value);
    if (revision === current) get("copy-status").textContent = "Meeting times copied.";
  } catch {
    if (revision !== current) return;
    get("meeting-summary").focus();
    get("meeting-summary").select();
    get("copy-status").textContent = "Clipboard unavailable. Copy the selected meeting times manually.";
  }
});

get("meeting-date").value = new Date().toISOString().slice(0, 10);
const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Taipei", "Asia/Tokyo", "Asia/Kolkata", "Asia/Kathmandu", "Australia/Sydney", "Pacific/Auckland"];
for (const zone of ["UTC", ...zones]) {
  const option = document.createElement("option");
  option.value = zone;
  get("zone-options").append(option);
}
addParticipant("America/New_York");
addParticipant("Europe/London");
renderParticipants();
update();
