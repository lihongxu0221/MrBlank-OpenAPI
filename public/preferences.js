try {
  const theme =
    localStorage.getItem("welfare.theme") === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const accent = localStorage.getItem("welfare.accent");
  document.documentElement.dataset.accent = [
    "cobalt",
    "gold",
    "rose",
    "slate",
  ].includes(accent)
    ? accent
    : "cobalt";
  document.documentElement.lang =
    localStorage.getItem("welfare.language") === "en" ? "en" : "zh-CN";
} catch {
  document.documentElement.dataset.theme = "light";
  document.documentElement.dataset.accent = "cobalt";
  document.documentElement.style.colorScheme = "light";
}
