// Run with: playwright-cli run-code --filename=scripts/test-interactive-tools.js
// Serve the repository at http://127.0.0.1:8000 first.
async (page) => {
  const base = "http://127.0.0.1:8000";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const cellText = (row, column) => page.locator("#results-body tr").nth(row).locator("td").nth(column).textContent();
  const setDate = async (date) => {
    await page.locator("#meeting-date").fill(date);
    await page.locator("#meeting-date").dispatchEvent("change");
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.goto(base);
  assert(await page.getByRole("link", { name: "Open tool", exact: true }).count() === 6, "Home should list six tools");
  await page.goto(`${base}/tools/decision-wheel/`);
  assert(await page.locator("#choice-odds li").count() === 4, "Default wheel should have four choices");
  assert(await page.evaluate(async () => {
    const { parseChoices, pickChoice } = await import("/assets/js/decision-wheel.js");
    const options = parseChoices("A | 1\nB | 3\n\n");
    if (pickChoice(options, 0).index !== 0 || pickChoice(options, 0.24999).index !== 0
        || pickChoice(options, 0.25).index !== 1 || pickChoice(options, 0.99999).index !== 1) return false;
    for (const text of ["A", "A | 0\nB", "A | 1.5\nB", " | 2\nB", "A | 2 | 3\nB", "X".repeat(81) + "\nB", Array(51).fill("A").join("\n")]) {
      try { parseChoices(text); return false; } catch { /* Expected validation failure. */ }
    }
    return true;
  }), "Choice parsing and weighted boundaries");
  await page.locator("#choices").fill("Alpha | 1\nBeta | 3");
  assert((await page.locator("#choice-odds").textContent()).includes("25.00%"), "Weighted odds should be shown");
  await page.evaluate(() => { crypto.getRandomValues = (array) => { array[0] = 2 ** 32 - 1; return array; }; });
  await page.locator("#spin-button").click();
  assert(await page.locator("#choices").isDisabled(), "Editing should be disabled during spin");
  await page.waitForFunction(() => document.getElementById("wheel-result").textContent === "Selected: Beta");
  assert(await page.locator("#choices").isEnabled(), "Spin should re-enable editing");
  assert(await page.evaluate(() => {
    const rotation = Number(document.getElementById("wheel").style.transform.match(/rotate\((.*)rad\)/)[1]);
    return Math.abs(rotation - Math.PI * 0.75) < 1e-4;
  }), "Wheel pointer should align with selected slice");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#choices").fill("<img src=bad>\nSafe");
  await page.locator("#spin-button").click();
  await page.waitForFunction(() => document.getElementById("wheel-result").textContent === "Selected: Safe");
  assert(await page.locator("#choice-odds img").count() === 0, "Choice labels must remain text");
  await page.locator("#choices").fill("Only one");
  assert(await page.locator("#spin-button").isDisabled() && await page.locator("#tool-error").isVisible(), "Invalid choices should disable spinning");

  await page.goto(`${base}/tools/probability-simulator/`);
  assert(await page.evaluate(async () => {
    const { trialOutcome } = await import("/assets/js/probability-simulator.js");
    return trialOutcome("coin", 0) === 0 && trialOutcome("coin", 0.5) === 1
      && trialOutcome("dice", 0.9999) === 5 && trialOutcome("monty", 0.1) === 0
      && trialOutcome("monty", 0.5) === 1;
  }), "Experiment outcome boundaries");
  await page.evaluate(() => { let i = 0; Math.random = () => (i++ % 2) / 2; });
  await page.locator("#trials").fill("1000");
  await page.locator("#run-button").click();
  await page.waitForFunction(() => document.getElementById("tool-status").textContent.startsWith("Finished"));
  assert(await cellText(0, 0) === "500" && await cellText(1, 0) === "500", "Coin count conservation and deterministic frequencies");
  await page.locator("#run-button").click();
  await page.waitForFunction(() => document.getElementById("total-trials").textContent === "2,000 trials");
  assert(await cellText(0, 0) === "1,000", "Runs should accumulate");
  await page.locator("#experiment").selectOption("dice");
  assert(await page.locator("#total-trials").textContent() === "0 trials", "Changing experiment should reset");
  await page.evaluate(() => { let i = 0; Math.random = () => ((i++ % 6) + 0.1) / 6; });
  await page.locator("#trials").fill("600");
  await page.locator("#run-button").click();
  await page.waitForFunction(() => document.getElementById("tool-status").textContent.startsWith("Finished"));
  for (let i = 0; i < 6; i++) assert(await cellText(i, 0) === "100", "Dice face counts");
  await page.locator("#experiment").selectOption("monty");
  await page.evaluate(() => { let i = 0; Math.random = () => ((i++ % 3) + 0.1) / 3; });
  await page.locator("#run-button").click();
  await page.waitForFunction(() => document.getElementById("tool-status").textContent.startsWith("Finished"));
  assert(await cellText(0, 0) === "200" && await cellText(1, 0) === "400", "Monty Hall paired strategy outcomes");
  assert(await cellText(0, 2) === "33.33%" && await cellText(1, 2) === "66.67%", "Monty Hall theory");
  await page.locator("#reset-button").click();
  await page.locator("#trials").fill("1000000");
  await page.evaluate(() => {
    document.getElementById("simulation-form").requestSubmit();
    setTimeout(() => document.getElementById("stop-button").click(), 0);
  });
  await page.waitForFunction(() => document.getElementById("tool-status").textContent.startsWith("Stopped"));
  assert(await page.locator("#total-trials").textContent() === "10,000 trials", "Stop should retain only completed batch");
  await page.evaluate(() => {
    document.getElementById("simulation-form").requestSubmit();
    document.getElementById("reset-button").click();
  });
  await page.waitForFunction(() => document.getElementById("run-button").disabled === false);
  assert(await page.locator("#total-trials").textContent() === "0 trials", "Reset should cancel queued work");
  await page.locator("#trials").fill("0");
  assert(await page.locator("#trials").evaluate((input) => !input.checkValidity()), "Native trial-count validation");

  await page.goto(`${base}/tools/timezone-meeting-planner/`);
  await setDate("2026-01-05");
  assert(await page.locator("#slots-body tr").count() === 48, "Planner should cover a UTC day");
  assert((await page.locator("#slot-summary").textContent()).startsWith("5 of 48"), "Winter overlap count");
  await page.locator("#only-overlap").check();
  assert(await page.locator("#slots-body tr").count() === 5, "Overlap filter");
  await page.getByRole("button", { name: "Select 14:00 UTC", exact: true }).click();
  const summary = await page.locator("#meeting-summary").inputValue();
  assert(summary.includes("2026-01-05T14:00:00.000Z") && summary.includes("09:00 GMT-5"), "Meeting summary should contain UTC and local time");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator("#copy-meeting").click();
  assert(await page.evaluate(() => navigator.clipboard.readText()) === summary, "Copy meeting summary");
  await setDate("2026-03-09");
  assert(!await page.locator("#selection-section").isVisible(), "Changing date should invalidate selection");
  assert((await page.locator("#slot-summary").textContent()).startsWith("7 of 48"), "DST mismatch overlap count");
  await setDate("2026-01-03");
  assert(await page.locator("#no-overlap").isVisible() && await page.locator("#slots-body tr").count() === 0, "No overlap feedback on weekend");
  await page.locator("#only-overlap").uncheck();
  await page.locator("#zone-input").fill("Invalid/Zone");
  await page.locator("#add-zone").click();
  assert(await page.locator("#tool-error").isVisible(), "Invalid zone validation");
  await page.locator("#zone-input").fill("America/New_York");
  await page.locator("#add-zone").click();
  assert((await page.locator("#tool-error").textContent()).includes("already"), "Duplicate zone validation");
  await page.locator("#zone-input").fill("Asia/Kathmandu");
  await page.locator("#add-zone").click();
  assert(await page.locator("#participants fieldset").count() === 3, "Adding a non-hour timezone");
  await page.locator("#participant-0-end").fill("08:00");
  await page.locator("#participant-0-end").dispatchEvent("change");
  assert(await page.locator("#tool-error").isVisible() && await page.locator("#slots-body tr").count() === 0, "Invalid working hours must clear stale slots");
  await page.getByRole("button", { name: "Remove America/New_York", exact: true }).click();
  await page.getByRole("button", { name: "Remove Europe/London", exact: true }).click();
  await page.getByRole("button", { name: /Remove Asia\/Kat/ }).click();
  assert((await page.locator("#tool-error").textContent()).includes("between 1 and 6"), "Empty planner validation");
  await page.locator("#zone-input").fill("UTC");
  await page.locator("#add-zone").click();
  await page.locator("#zone-input").fill("Etc/UTC");
  await page.locator("#add-zone").click();
  assert((await page.locator("#tool-error").textContent()).includes("already"), "Timezone aliases should deduplicate");
  for (const zone of ["Asia/Tokyo", "Europe/Paris", "America/Los_Angeles", "Australia/Sydney", "Pacific/Auckland"]) {
    await page.locator("#zone-input").fill(zone);
    await page.locator("#add-zone").click();
  }
  assert(await page.locator("#participants fieldset").count() === 6, "Six timezone support");
  await page.locator("#zone-input").fill("Asia/Taipei");
  await page.locator("#add-zone").click();
  assert((await page.locator("#tool-error").textContent()).includes("At most 6"), "Timezone limit feedback");

  for (const tool of ["decision-wheel", "probability-simulator", "timezone-meeting-planner"]) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${base}/tools/${tool}/`);
    if (tool === "decision-wheel") {
      await page.evaluate(() => { document.getElementById("wheel").style.transform = "rotate(0.785rad)"; });
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tool} mobile overflow`);
  }
  assert(errors.length === 0, `Unexpected browser errors: ${errors.join(", ")}`);
  return "PASS: six-tool registry, weighted wheel and pointer alignment, input validation, reduced motion, simulation counts/theory/accumulation/stop/reset, planner DST/overlap/filter/selection/clipboard/zone validation, and mobile layouts.";
}
