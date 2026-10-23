import { t, localizedUrl } from "./i18n.js";

export const toolRegistry = [
  {
    id: "stitch-split-img",
    title: t("Stitch Split Img"),
    href: "tools/stitch-split-img/",
    description: t("Find the order of image slices and stitch them together in your browser."),
    status: "enabled",
  },
  {
    id: "image-resizer-converter",
    title: t("Image Resizer & Converter"),
    href: "tools/image-resizer-converter/",
    description: t("Crop, resize, and convert an image to PNG, JPEG, or WebP locally."),
    status: "enabled",
  },
  {
    id: "file-hash-calculator",
    title: t("File Hash Calculator"),
    href: "tools/file-hash-calculator/",
    description: t("Calculate a file’s SHA-256 checksum and compare it with an expected hash."),
    status: "enabled",
  },
  {
    id: "decision-wheel",
    title: t("Decision Wheel"),
    href: "tools/decision-wheel/",
    description: t("Add choices, adjust their odds, and spin a wheel to decide."),
    status: "enabled",
  },
  {
    id: "probability-simulator",
    title: t("Probability Simulator"),
    href: "tools/probability-simulator/",
    description: t("Explore coins, dice, and Monty Hall with live results and theoretical odds."),
    status: "enabled",
  },
  {
    id: "timezone-meeting-planner",
    title: t("Timezone Meeting Planner"),
    href: "tools/timezone-meeting-planner/",
    description: t("Compare local times and find shared working hours across timezones."),
    status: "enabled",
  },
  {
    id: "remove-image-borders",
    title: t("Remove Image Borders"),
    href: "tools/remove-image-borders/",
    description: t("Automatically trim solid-color image borders, one image or a batch at a time."),
    status: "enabled",
  },
];

const toolList = document.querySelector("#tool-list");

if (toolList) {
  for (const tool of toolRegistry) {
    const item = document.createElement("li");
    const card = document.createElement("article");
    const title = document.createElement("h3");
    const description = document.createElement("p");

    card.className = tool.status === "placeholder"
      ? "tool-card tool-card--placeholder"
      : "tool-card";
    title.textContent = tool.title;
    description.textContent = tool.description;
    card.append(title, description);

    if (tool.status === "enabled" && tool.href) {
      const link = document.createElement("a");
      link.className = "pill-link pill-link--secondary";
      link.href = localizedUrl(tool.href);
      link.textContent = t("Open tool");
      card.append(link);
    }

    item.append(card);
    toolList.append(item);
  }
}
