export const languages = {
  en: "English",
  ja: "日本語",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ko: "한국어",
  fr: "Français",
  es: "Español",
};

export function matchLocale(value = "") {
  const tag = (value ?? "").toLowerCase().replaceAll("_", "-");
  if (tag === "zh" || tag.startsWith("zh-")) {
    return /(?:^|-)(hant|tw|hk|mo)(?:-|$)/.test(tag) ? "zh-Hant" : "zh-Hans";
  }
  const base = tag.split("-")[0];
  return Object.hasOwn(languages, base) ? base : null;
}

const browser = typeof document !== "undefined";
const requested = browser ? new URL(location.href).searchParams.get("lang") : null;
export const locale = matchLocale(requested) ?? (browser
  ? (navigator.languages ?? [navigator.language]).map(matchLocale).find(Boolean)
  : null) ?? "en";
const messages = locale === "en" ? {} : (await import(`./locales/${locale}.js`)).default;

export function t(message, values = {}) {
  const translated = messages[message] ?? message;
  return translated.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token);
}

export function localizedUrl(value) {
  const url = new URL(value, location.href);
  if (url.origin === location.origin && /\/$|\.html$/.test(url.pathname)) url.searchParams.set("lang", locale);
  return url.href;
}

if (browser) {
  document.documentElement.lang = locale;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const attribute of ["aria-label", "alt", "placeholder"]) {
    for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
  for (const link of document.querySelectorAll("a[href]")) {
    if (!link.hasAttribute("download") && !link.getAttribute("href").startsWith("#")) {
      link.href = localizedUrl(link.href);
    }
  }
  const label = document.createElement("label");
  label.className = "language-control";
  const caption = document.createElement("span");
  caption.textContent = t("Language");
  const select = document.createElement("select");
  select.id = "language-select";
  for (const [code, name] of Object.entries(languages)) {
    const option = document.createElement("option");
    option.value = code;
    option.lang = code;
    option.textContent = name;
    select.append(option);
  }
  select.value = locale;
  select.addEventListener("change", () => {
    const url = new URL(location.href);
    url.searchParams.set("lang", select.value);
    location.assign(url.href);
  });
  label.append(caption, select);
  document.querySelector(".site-header")?.append(label);
  // Resolve links on activation so dynamically created directory cards work too.
  for (const eventName of ["click", "auxclick"]) {
    document.addEventListener(eventName, (event) => {
      const link = event.target.closest?.("a[href]");
      if (link && !link.hasAttribute("download") && !link.getAttribute("href").startsWith("#")) {
        link.href = localizedUrl(link.href);
      }
    });
  }
}
