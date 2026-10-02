export function canonicalZone(zone) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone }).resolvedOptions().timeZone;
}

export function minutesOfDay(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error("Enter valid working-hour times.");
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("Enter valid working-hour times.");
  return hour * 60 + minute;
}

export function utcDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2000-01-01" || date > "2100-12-31") {
    throw new Error("Choose a valid date between 2000 and 2100.");
  }
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new Error("Choose a valid calendar date.");
  }
  return time;
}

export function buildSlots(date, duration, participants) {
  const start = utcDay(date);
  if (![30, 60, 90, 120].includes(duration)) throw new Error("Choose a supported meeting duration.");
  if (participants.length < 1 || participants.length > 6) throw new Error("Add between 1 and 6 timezones.");
  const zones = participants.map((person) => {
    const zone = canonicalZone(person.zone);
    const from = minutesOfDay(person.start);
    const until = minutesOfDay(person.end);
    if (from >= until) throw new Error(`${zone}: working hours must end after they start on the same local day.`);
    if (!["weekdays", "everyday"].includes(person.days)) throw new Error("Choose weekdays or every day.");
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    const display = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, weekday: "short", year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset",
    });
    // Prefix counts of unavailable minutes make full-duration checks exact,
    // including meetings spanning midnight or daylight-saving transitions.
    const blocked = new Uint16Array(1440 + duration + 1);
    for (let minute = 0; minute < blocked.length - 1; minute++) {
      const parts = Object.fromEntries(clock.formatToParts(start + minute * 60000).map((part) => [part.type, part.value]));
      const local = Number(parts.hour) * 60 + Number(parts.minute);
      const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
      const available = local >= from && local < until && (person.days === "everyday" || !weekend);
      blocked[minute + 1] = blocked[minute] + (available ? 0 : 1);
    }
    return { zone, display, blocked };
  });
  return Array.from({ length: 48 }, (_, index) => {
    const minute = index * 30;
    const time = start + minute * 60000;
    const cells = zones.map(({ zone, display, blocked }) => ({
      zone, text: display.format(time), endText: display.format(time + duration * 60000),
      available: blocked[minute + duration] === blocked[minute],
    }));
    return { time, utc: new Date(time).toISOString().slice(11, 16), cells, available: cells.every((cell) => cell.available) };
  });
}
