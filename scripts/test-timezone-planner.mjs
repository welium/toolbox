import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlots, canonicalZone, minutesOfDay, utcDay } from "../assets/js/timezone-planner.js";

const person = (zone, overrides = {}) => ({ zone, start: "09:00", end: "17:00", days: "weekdays", ...overrides });
const at = (slots, utc) => slots.find((slot) => slot.utc === utc);

test("winter, summer, and mismatched daylight-saving dates", () => {
  const people = [person("America/New_York"), person("Europe/London")];
  const winter = buildSlots("2026-01-05", 60, people);
  assert.equal(winter.length, 48);
  assert.equal(winter.filter((slot) => slot.available).length, 5);
  assert.equal(at(winter, "14:00").available, true);
  assert.match(at(winter, "14:00").cells[0].text, /09:00 GMT-5/);
  assert.equal(at(winter, "16:30").available, false);
  const summer = buildSlots("2026-07-06", 60, people);
  assert.equal(summer.filter((slot) => slot.available).length, 5);
  assert.match(at(summer, "13:00").cells[0].text, /09:00 GMT-4/);
  assert.match(at(summer, "13:00").cells[1].text, /14:00 GMT\+1/);
  const mismatch = buildSlots("2026-03-09", 60, people);
  assert.equal(mismatch.filter((slot) => slot.available).length, 7);
});

test("full duration, non-hour offsets, and local-day rollover", () => {
  const nepal = buildSlots("2026-01-05", 60, [person("Asia/Kathmandu")]);
  assert.equal(at(nepal, "03:00").available, false);
  assert.equal(at(nepal, "03:30").available, true);
  assert.match(at(nepal, "03:30").cells[0].text, /09:15 GMT\+5:45/);
  assert.equal(at(nepal, "10:00").available, true);
  assert.equal(at(nepal, "10:30").available, false);
  const rollover = buildSlots("2026-01-04", 120, [person("Pacific/Auckland")]);
  assert.equal(at(rollover, "20:00").available, true);
  assert.match(at(rollover, "20:00").cells[0].text, /Mon, 05 Jan 2026/);
});

test("local weekdays, every day, and minute-level boundaries", () => {
  const weekend = buildSlots("2026-01-03", 30, [person("Europe/London")]);
  assert.equal(weekend.some((slot) => slot.available), false);
  const everyday = buildSlots("2026-01-03", 30, [person("Europe/London", { days: "everyday" })]);
  assert.equal(everyday.filter((slot) => slot.available).length, 16);
  const precise = buildSlots("2026-01-05", 60, [person("UTC", { start: "09:01", end: "10:31" })]);
  assert.equal(at(precise, "09:00").available, false);
  assert.equal(at(precise, "09:30").available, true);
  assert.equal(at(precise, "10:00").available, false);
});

test("spring gap and repeated fall hour", () => {
  const springPerson = person("America/New_York", { start: "01:00", end: "03:00", days: "everyday" });
  assert.equal(at(buildSlots("2026-03-08", 30, [springPerson]), "06:30").available, true);
  assert.equal(at(buildSlots("2026-03-08", 60, [springPerson]), "06:30").available, false);
  const fallPerson = person("America/New_York", { start: "01:00", end: "02:00", days: "everyday" });
  assert.equal(at(buildSlots("2026-11-01", 90, [fallPerson]), "05:30").available, true);
  assert.equal(at(buildSlots("2026-11-01", 120, [fallPerson]), "05:30").available, false);
});

test("input validation and leap dates", () => {
  assert.equal(canonicalZone("Etc/UTC"), "UTC");
  assert.equal(minutesOfDay("09:15"), 555);
  for (const date of ["", "2026-02-30", "2026-02-29", "1999-12-31", "2101-01-01"]) assert.throws(() => utcDay(date));
  assert.equal(new Date(utcDay("2028-02-29")).toISOString().slice(0, 10), "2028-02-29");
  assert.throws(() => canonicalZone("Not/A_Zone"));
  assert.throws(() => minutesOfDay("24:00"));
  assert.throws(() => buildSlots("2026-01-05", 60, []));
  assert.throws(() => buildSlots("2026-01-05", 15, [person("UTC")]));
  assert.throws(() => buildSlots("2026-01-05", 60, [person("UTC", { start: "17:00", end: "09:00" })]));
});
