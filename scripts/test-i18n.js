// Run with: playwright-cli run-code --filename=scripts/test-i18n.js
async (page) => {
  const base = "http://127.0.0.1:8000";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const tools = ["decision-wheel", "file-hash-calculator", "image-resizer-converter", "probability-simulator", "remove-image-borders", "stitch-split-img", "timezone-meeting-planner"];
  for (const locale of ["en", "ja", "zh-Hans", "zh-Hant", "ko", "fr", "es"]) {
    for (const path of ["/", ...tools.map((tool) => `/tools/${tool}/`)]) {
      await page.goto(`${base}${path}?lang=${locale}`);
      await page.waitForFunction((code) => document.querySelector("#language-select")?.value === code, locale);
      assert(await page.locator("html").getAttribute("lang") === locale, `${locale} ${path}: document language`);
      assert(await page.evaluate(async () => {
        const { t } = await import("/assets/js/i18n.js");
        const dynamic = new Set(["file-count-hint", "tool-status", "total-trials", "table-caption"]);
        return [...document.querySelectorAll("[data-i18n]")].every((element) => element.textContent === t(element.dataset.i18n) || dynamic.has(element.id));
      }), `${locale} ${path}: static translations`);
      if (path === "/") assert(await page.locator("#tool-list li").count() === 7, `${locale}: directory`);
      if (path.includes("probability-simulator")) {
        await page.locator("#trials").fill("100");
        await page.locator("#run-button").click();
        await page.waitForFunction(() => !document.querySelector("#run-button").disabled);
        assert(!(await page.locator("#tool-status").textContent()).includes("{p0}"), `${locale}: interpolated status`);
      }
      if (path.includes("timezone-meeting-planner")) {
        assert(await page.locator("#slots-body tr").count() === 48, `${locale}: planner slots`);
        await page.locator(".slot-button").first().click();
        assert((await page.locator("#meeting-summary").inputValue()).includes("UTC"), `${locale}: meeting summary`);
      }
      await page.setViewportSize({ width: 375, height: 812 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale} ${path}: mobile overflow`);
      await page.setViewportSize({ width: 1280, height: 900 });
    }
  }
  await page.goto(`${base}/?lang=ja`);
  await page.locator('#tool-list a').first().click();
  assert(new URL(page.url()).searchParams.get("lang") === "ja", "Navigation preserves language");
  await page.locator("#language-select").selectOption("fr");
  await page.waitForURL("**?lang=fr");
  await page.waitForFunction(() => document.documentElement.lang === "fr");
  assert((await page.locator("h1").textContent()) === "Assemblage d’images", "Language selector translates page");
  assert(errors.length === 0, errors.join("\n"));
  return "PASS: all 56 language/page combinations, dynamic results, navigation, selector, and mobile layouts.";
}
