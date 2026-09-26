export const toolRegistry = [
  {
    id: "stitch-split-img",
    title: "Stitch Split Img",
    href: "tools/stitch-split-img/",
    description: "Find the order of image slices and stitch them together in your browser.",
    status: "enabled",
  },
  {
    id: "more-tools-placeholder",
    title: "Placeholder — not a tool",
    description: "Reserved for a future tool. This item has no link or functionality.",
    status: "placeholder",
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
