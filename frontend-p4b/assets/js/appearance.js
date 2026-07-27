(() => {
  const KEY = "xinban-appearance";
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
  };
  const resolve = mode => mode === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day")
    : (mode || "night");
  const apply = value => {
    const settings = { mode: "night", style: "purple", font: "default", ...value };
    document.documentElement.dataset.appTheme = resolve(settings.mode);
    document.documentElement.dataset.appStyle = settings.style;
    document.documentElement.dataset.appFont = settings.font;
    return settings;
  };
  apply(read());
  window.CompanionAppearance = Object.freeze({
    read,
    save(value) {
      const settings = apply({ ...read(), ...value });
      localStorage.setItem(KEY, JSON.stringify(settings));
      return settings;
    },
    clearBackground() {
      document.documentElement.style.removeProperty("--app-background-image");
      localStorage.removeItem(`${KEY}-background`);
    }
  });
})();
