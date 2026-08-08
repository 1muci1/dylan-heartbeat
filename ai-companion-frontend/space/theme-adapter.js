"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionTheme = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const MODES = new Set(["auto", "day", "night"]);
  const SAFE_URL = /^(?:(?:https?:|data:image\/|blob:)|(?:\/|\.\.?\/))/iu;
  const safeUrl = value => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > 2048 || !SAFE_URL.test(text)) throw new Error("资源 URL 格式无效");
    return text;
  };

  class ThemeEngine {
    constructor({ documentRef, persistenceAdapter = null, fontFaceFactory } = {}) {
      if (!documentRef?.documentElement?.style) throw new TypeError("documentRef 必填");
      this.document = documentRef;
      this.root = documentRef.documentElement;
      this.preferences = persistenceAdapter;
      this.fontFaceFactory = fontFaceFactory;
      this.mode = "auto";
    }
    setMode(mode) {
      if (!MODES.has(mode)) throw new Error("主题模式无效");
      this.mode = mode;
      this.root.dataset.companionThemeMode = mode;
      return mode;
    }
    getMode() { return Object.freeze({ selected: this.mode, resolved: this.mode }); }
    setAccent() {
      const styles = this.document.defaultView?.getComputedStyle?.(this.root);
      return Object.freeze({
        name: "active-theme",
        primary: styles?.getPropertyValue("--xb-color-accent")?.trim() || "currentColor",
        strong: styles?.getPropertyValue("--xb-button-bg")?.trim() || "currentColor"
      });
    }
    setFontFamily(family = "default") {
      const safe = String(family || "default").trim().slice(0, 80) || "default";
      const value = safe === "default" ? 'Inter, "PingFang SC", sans-serif' : `${JSON.stringify(safe)}, Inter, "PingFang SC", sans-serif`;
      this.root.style.setProperty("--theme-font-family", value);
      return Object.freeze({ family: safe });
    }
    async loadFont({ family, url, weight = "400", style = "normal", apply = true } = {}) {
      const safeFamily = String(family || "").trim().slice(0, 80);
      const safeSource = safeUrl(url);
      if (!safeFamily || !this.fontFaceFactory || !this.document.fonts?.add) throw new Error("当前环境不支持字体加载");
      const face = this.fontFaceFactory(safeFamily, `url(${JSON.stringify(safeSource)})`, { weight: String(weight), style });
      const loaded = await face.load();
      this.document.fonts.add(loaded);
      if (apply) this.setFontFamily(safeFamily);
      return Object.freeze({ family: safeFamily, weight: String(weight), style, applied: apply });
    }
    setBackground({ imageUrl, position = "center", size = "cover", overlay = "transparent", blur = 0 } = {}) {
      const source = safeUrl(imageUrl);
      const blurValue = Math.max(0, Math.min(24, Number(blur) || 0));
      this.root.style.setProperty("--theme-background-image", `url(${JSON.stringify(source)})`);
      this.root.style.setProperty("--theme-background-position", position);
      this.root.style.setProperty("--theme-background-size", size);
      this.root.style.setProperty("--theme-background-overlay", overlay);
      this.root.style.setProperty("--theme-background-blur", `${blurValue}px`);
      return Object.freeze({ imageUrl: source, position, size, overlay, blur: blurValue });
    }
    clearBackground() {
      this.root.style.setProperty("--theme-background-image", "none");
      return Object.freeze({ imageUrl: null });
    }
    dispose() {}
  }

  return { ThemeEngine };
});
