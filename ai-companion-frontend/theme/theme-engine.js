"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionTheme = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const THEME_MODES = Object.freeze(["auto", "day", "night"]);
  const ACCENT_PALETTES = Object.freeze({
    purple: Object.freeze({ primary: "#b899d2", strong: "#8b65ac" }),
    rose: Object.freeze({ primary: "#d5a0b8", strong: "#a96785" }),
    blue: Object.freeze({ primary: "#91b9dd", strong: "#5d89b1" }),
    beige: Object.freeze({ primary: "#c7ad83", strong: "#8c704d" })
  });
  const DEFAULT_FONT_STACK = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
  const BACKGROUND_POSITIONS = Object.freeze([
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "center top",
    "center bottom"
  ]);
  const BACKGROUND_SIZES = Object.freeze(["cover", "contain", "auto"]);
  const COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\)|transparent)$/iu;
  const SAFE_URL_PATTERN = /^(?:(?:https?:|data:image\/|blob:)|(?:\/|\.\.?\/))/iu;

  class ThemeEngineError extends Error {
    constructor(message, code = "THEME_ENGINE_INVALID") {
      super(message);
      this.name = "ThemeEngineError";
      this.code = code;
    }
  }

  const requiredText = (value, field, maxLength) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > maxLength ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw new ThemeEngineError(`${field} 格式无效`);
    }
    return value.trim();
  };

  const safeAssetUrl = value => {
    const url = requiredText(value, "资源 URL", 2048);
    if (!SAFE_URL_PATTERN.test(url)) {
      throw new ThemeEngineError("资源 URL 协议不允许", "THEME_ASSET_URL_FORBIDDEN");
    }
    return url;
  };

  class ThemeEngine {
    #document;
    #root;
    #mediaQuery;
    #fontFaceFactory;
    #mode = "night";
    #onSystemChange;

    constructor({
      documentRef,
      matchMedia,
      fontFaceFactory
    } = {}) {
      if (!documentRef?.documentElement?.style) {
        throw new TypeError("documentRef 必填");
      }
      this.#document = documentRef;
      this.#root = documentRef.documentElement;
      this.#mediaQuery = typeof matchMedia === "function"
        ? matchMedia("(prefers-color-scheme: dark)")
        : null;
      this.#fontFaceFactory = fontFaceFactory ||
        ((family, source, descriptors) => new FontFace(family, source, descriptors));
      this.#onSystemChange = () => {
        if (this.#mode === "auto") this.#applyResolvedMode();
      };
      this.#mediaQuery?.addEventListener?.("change", this.#onSystemChange);
      this.setMode("night");
    }

    #applyResolvedMode() {
      const resolved = this.#mode === "auto"
        ? (this.#mediaQuery?.matches ? "night" : "day")
        : this.#mode;
      this.#root.dataset.companionThemeMode = this.#mode;
      this.#root.dataset.companionTheme = resolved;
      return resolved;
    }

    setMode(mode) {
      if (!THEME_MODES.includes(mode)) {
        throw new ThemeEngineError("主题模式无效", "THEME_MODE_INVALID");
      }
      this.#mode = mode;
      return this.#applyResolvedMode();
    }

    getMode() {
      return Object.freeze({
        selected: this.#mode,
        resolved: this.#root.dataset.companionTheme
      });
    }

    setAccent(name) {
      const palette = ACCENT_PALETTES[name];
      if (!palette) {
        throw new ThemeEngineError("主题主色无效", "THEME_ACCENT_INVALID");
      }
      this.#root.dataset.companionThemeAccent = name;
      this.#root.style.setProperty("--theme-color-primary", palette.primary);
      this.#root.style.setProperty("--theme-color-primary-strong", palette.strong);
      return Object.freeze({ name, ...palette });
    }

    setFontFamily(family = "default") {
      const safeFamily = requiredText(family, "字体名称", 80);
      const value = safeFamily === "default"
        ? DEFAULT_FONT_STACK
        : `${JSON.stringify(safeFamily)}, ${DEFAULT_FONT_STACK}`;
      this.#root.style.setProperty("--theme-font-family", value);
      return Object.freeze({ family: safeFamily });
    }

    async loadFont({
      family,
      url,
      weight = "400",
      style = "normal",
      apply = true
    } = {}) {
      const safeFamily = requiredText(family, "字体名称", 80);
      const safeUrl = safeAssetUrl(url);
      if (!/^(?:normal|italic|oblique)$/u.test(style)) {
        throw new ThemeEngineError("字体 style 无效");
      }
      if (!/^(?:normal|bold|[1-9]00)$/u.test(String(weight))) {
        throw new ThemeEngineError("字体 weight 无效");
      }
      if (typeof this.#fontFaceFactory !== "function" || !this.#document.fonts?.add) {
        throw new ThemeEngineError("当前环境不支持字体加载", "THEME_FONT_UNSUPPORTED");
      }
      const face = this.#fontFaceFactory(
        safeFamily,
        `url(${JSON.stringify(safeUrl)})`,
        { weight: String(weight), style }
      );
      if (!face || typeof face.load !== "function") {
        throw new ThemeEngineError("字体加载接口无效", "THEME_FONT_UNSUPPORTED");
      }
      const loaded = await face.load();
      this.#document.fonts.add(loaded);
      if (apply) {
        this.#root.style.setProperty(
          "--theme-font-family",
          `${JSON.stringify(safeFamily)}, Inter, "PingFang SC", sans-serif`
        );
      }
      return Object.freeze({ family: safeFamily, weight: String(weight), style, applied: apply });
    }

    setBackground({
      imageUrl,
      position = "center",
      size = "cover",
      overlay = "rgba(18, 11, 27, .46)",
      blur = 0
    } = {}) {
      const url = safeAssetUrl(imageUrl);
      if (!BACKGROUND_POSITIONS.includes(position)) {
        throw new ThemeEngineError("背景 position 无效");
      }
      if (!BACKGROUND_SIZES.includes(size)) {
        throw new ThemeEngineError("背景 size 无效");
      }
      if (typeof overlay !== "string" || !COLOR_PATTERN.test(overlay.trim())) {
        throw new ThemeEngineError("背景 overlay 无效");
      }
      const blurValue = Number(blur);
      if (!Number.isFinite(blurValue) || blurValue < 0 || blurValue > 24) {
        throw new ThemeEngineError("背景 blur 必须在 0 到 24 之间");
      }
      this.#root.style.setProperty("--theme-background-image", `url(${JSON.stringify(url)})`);
      this.#root.style.setProperty("--theme-background-position", position);
      this.#root.style.setProperty("--theme-background-size", size);
      this.#root.style.setProperty("--theme-background-overlay", overlay.trim());
      this.#root.style.setProperty("--theme-background-blur", `${blurValue}px`);
      return Object.freeze({
        imageUrl: url,
        position,
        size,
        overlay: overlay.trim(),
        blur: blurValue
      });
    }

    clearBackground() {
      this.#root.style.setProperty("--theme-background-image", "none");
      return Object.freeze({ imageUrl: null });
    }

    dispose() {
      this.#mediaQuery?.removeEventListener?.("change", this.#onSystemChange);
    }
  }

  return {
    ACCENT_PALETTES,
    BACKGROUND_POSITIONS,
    BACKGROUND_SIZES,
    ThemeEngine,
    ThemeEngineError,
    THEME_MODES,
    safeAssetUrl
  };
});
