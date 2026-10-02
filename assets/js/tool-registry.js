export const toolRegistry = [
  {
    id: "stitch-split-img",
    title: "Stitch Split Img",
    href: "tools/stitch-split-img/",
    description: "Find the order of image slices and stitch them together in your browser.",
    status: "enabled",
  },
  {
    id: "image-resizer-converter",
    title: "Image Resizer & Converter",
    href: "tools/image-resizer-converter/",
    description: "Crop, resize, and convert an image to PNG, JPEG, or WebP locally.",
    status: "enabled",
  },
  {
    id: "file-hash-calculator",
    title: "File Hash Calculator",
    href: "tools/file-hash-calculator/",
    description: "Calculate a file’s SHA-256 checksum and compare it with an expected hash.",
    status: "enabled",
  },
  {
    id: "decision-wheel",
    title: "Decision Wheel",
    href: "tools/decision-wheel/",
    description: "Add choices, adjust their odds, and spin a wheel to decide.",
    status: "enabled",
  },
  {
    id: "probability-simulator",
    title: "Probability Simulator",
    href: "tools/probability-simulator/",
    description: "Explore coins, dice, and Monty Hall with live results and theoretical odds.",
    status: "enabled",
  },
  {
    id: "timezone-meeting-planner",
    title: "Timezone Meeting Planner",
    href: "tools/timezone-meeting-planner/",
    description: "Compare local times and find shared working hours across timezones.",
    status: "enabled",
  },
  {
    id: "remove-image-borders",
    title: "Remove Image Borders",
    href: "tools/remove-image-borders/",
    description: "Detect and trim black, white, or other solid-color image borders automatically.",
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
      link.href = tool.href;
      link.textContent = "Open tool";
      card.append(link);
    }

    item.append(card);
    toolList.append(item);
  }
}
