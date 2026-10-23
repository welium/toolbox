import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { languages, matchLocale, t } from "../assets/js/i18n.js";

test("language matching handles regional and Chinese script preferences", () => {
  for (const [tag, expected] of [["ja-JP", "ja"], ["ko-KR", "ko"], ["fr-CA", "fr"], ["es-MX", "es"], ["zh-CN", "zh-Hans"], ["zh-SG", "zh-Hans"], ["zh-TW", "zh-Hant"], ["zh-HK", "zh-Hant"], ["zh-Hant", "zh-Hant"], [null, null], ["de", null]]) {
    assert.equal(matchLocale(tag), expected);
  }
  assert.equal(t("Selected: {p0}", { p0: "<script>$&{p1}" }), "Selected: <script>$&{p1}");
});

test("every locale covers HTML and JavaScript messages and preserves placeholders", async () => {
  const root = new URL("../", import.meta.url);
  const sources = ["index.html"];
  for (const directory of await readdir(new URL("tools/", root))) sources.push(`tools/${directory}/index.html`);
  for (const name of await readdir(new URL("assets/js/", root))) if (name.endsWith(".js")) sources.push(`assets/js/${name}`);
  const keys = new Set();
  for (const path of sources) {
    const text = await readFile(new URL(path, root), "utf8");
    for (const match of text.matchAll(/\bt\(("(?:[^"\\]|\\.)*")/g)) keys.add(JSON.parse(match[1]));
    for (const match of text.matchAll(/data-i18n(?:-aria-label|-alt|-placeholder)?="([^"]+)"/g)) keys.add(match[1].replaceAll("&amp;", "&").replaceAll("&quot;", '"'));
  }
  const baseline = (await import("../assets/js/locales/ja.js")).default;
  const tokens = (value) => [...value.matchAll(/\{\w+\}/g)].map(([token]) => token).sort();
  for (const code of Object.keys(languages).filter((code) => code !== "en")) {
    const catalog = (await import(`../assets/js/locales/${code}.js`)).default;
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(baseline).sort(), `${code}: catalog keys`);
    for (const key of keys) assert.ok(catalog[key], `${code}: missing ${key}`);
    for (const [key, value] of Object.entries(catalog)) assert.deepEqual(tokens(value), tokens(key), `${code}: placeholders in ${key}`);
  }
});
