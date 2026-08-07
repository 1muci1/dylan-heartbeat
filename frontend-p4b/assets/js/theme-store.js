"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.XinbanThemes = Object.freeze(api);
    root.XinbanThemeStore = new api.ThemeStore();
    root.XinbanThemeStore.applyActive();
  }
})(typeof window !== "undefined" ? window : null, () => {
  const ACTIVE_KEY = "xinban-theme-active-v1";
  const LIBRARY_KEY = "xinban-theme-library-v1";
  const THEME_VERSION = 1;
  const MAX_CUSTOM_CSS = 8000;
  const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\)|transparent)$/iu;
  const SAFE_ASSET = /^(?:$|(?:\.?\.?\/|\/)[^\u0000-\u001f]*|data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+)$/iu;
  const DANGEROUS_CSS = /(?:\bscript\b|javascript\s*:|@import|url\s*\(\s*["']?https?:|expression\s*\(|position\s*:\s*fixed|(?:^|[},])\s*(?:\*|html|body|:root)\s*\{[^}]*pointer-events\s*:\s*none)/iu;
  const TOKEN_FIELDS = Object.freeze([
    "colorPrimary", "colorAccent", "colorBg", "colorText", "colorMuted",
    "chatUserBubbleBg", "chatAssistantBubbleBg", "chatBubbleText", "bottomNavBg",
    "cardBg", "borderColor", "shadowSoft", "blur", "radiusBubble", "radiusCard",
    "fontFamily", "fontSizeBase"
  ]);
  const COLOR_FIELDS = new Set([
    "colorPrimary", "colorAccent", "colorBg", "colorText", "colorMuted",
    "chatUserBubbleBg", "chatAssistantBubbleBg", "chatBubbleText", "bottomNavBg",
    "cardBg", "borderColor"
  ]);
  const ASSET_FIELDS = Object.freeze([
    "backgroundImage", "chatBackgroundImage", "homeBackgroundImage", "bubbleTexture",
    "bottomNavTexture", "fontUrl"
  ]);
  const LAYOUT_FIELDS = Object.freeze([
    "chatWidth", "bubbleMaxWidth", "messageGap", "bottomNavHeight", "glassIntensity",
    "backgroundDim", "bubbleOpacity", "navOpacity", "radiusNav", "blurNav", "blurBubble"
  ]);
  const FONT_MAP = Object.freeze({
    system: 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    rounded: '"M PLUS Rounded 1c", "Arial Rounded MT Bold", "PingFang SC", sans-serif',
    serif: '"Songti SC", "STSong", Georgia, serif',
    sans: '"PingFang SC", "Microsoft YaHei", Arial, sans-serif'
  });
  const DEFAULT_THEME = Object.freeze({
    id: "theme_default_purple_mist", name: "默认紫雾", version: 1, author: "心伴",
    createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z",
    tokens: Object.freeze({
      colorPrimary: "#8b6bb8", colorAccent: "#c7b2ff", colorBg: "#09090d",
      colorText: "#f5f3ff", colorMuted: "rgba(245,243,255,.72)",
      chatUserBubbleBg: "rgba(131,107,153,.96)", chatAssistantBubbleBg: "rgba(25,24,32,.88)",
      chatBubbleText: "#f5f3ff", bottomNavBg: "rgba(16,15,21,.90)",
      cardBg: "rgba(20,20,27,.92)", borderColor: "rgba(196,181,253,.12)",
      shadowSoft: "0 18px 45px rgba(0,0,0,.28)", blur: "18px",
      radiusBubble: "24px", radiusCard: "28px", fontFamily: "system", fontSizeBase: "15px"
    }),
    assets: Object.freeze({ backgroundImage: "", chatBackgroundImage: "", homeBackgroundImage: "", bubbleTexture: "", bottomNavTexture: "", fontUrl: "" }),
    layout: Object.freeze({ chatWidth: "auto", bubbleMaxWidth: "78%", messageGap: "14px", bottomNavHeight: "86px", glassIntensity: .72, backgroundDim: .18, bubbleOpacity: .94, navOpacity: .9, radiusNav: "24px", blurNav: "20px", blurBubble: "10px" }),
    customCss: ""
  });
  const preset = (id, name, values) => Object.freeze({ ...DEFAULT_THEME, id, name, ...values,
    tokens: Object.freeze({ ...DEFAULT_THEME.tokens, ...(values.tokens || {}) }),
    assets: DEFAULT_THEME.assets, layout: Object.freeze({ ...DEFAULT_THEME.layout, ...(values.layout || {}) }) });
  const PRESET_THEMES = Object.freeze([
    DEFAULT_THEME,
    preset("theme_milk_glass", "奶白玻璃", { tokens: { colorPrimary: "#8f789e", colorAccent: "#d9cbe2", colorBg: "#f6f1ec", colorText: "#403943", colorMuted: "#817781", chatUserBubbleBg: "rgba(232,218,236,.92)", chatAssistantBubbleBg: "rgba(255,255,255,.82)", chatBubbleText: "#403943", bottomNavBg: "rgba(255,255,255,.78)", cardBg: "rgba(255,255,255,.72)", borderColor: "rgba(98,77,108,.14)", shadowSoft: "0 18px 45px rgba(78,58,82,.12)" } }),
    preset("theme_midnight_blue", "深夜蓝紫", { tokens: { colorPrimary: "#7777dd", colorAccent: "#b2a7ff", colorBg: "#090b18", colorText: "#f0f1ff", colorMuted: "#9ca1c8", chatUserBubbleBg: "rgba(82,76,160,.94)", chatAssistantBubbleBg: "rgba(20,23,48,.90)", bottomNavBg: "rgba(10,12,30,.88)", cardBg: "rgba(18,21,44,.82)", borderColor: "rgba(166,160,255,.17)" } }),
    preset("theme_sakura", "樱花浅粉", { tokens: { colorPrimary: "#c87995", colorAccent: "#f1b6c9", colorBg: "#fff3f6", colorText: "#533d47", colorMuted: "#967984", chatUserBubbleBg: "rgba(244,190,209,.88)", chatAssistantBubbleBg: "rgba(255,255,255,.86)", chatBubbleText: "#533d47", bottomNavBg: "rgba(255,245,248,.84)", cardBg: "rgba(255,255,255,.76)", borderColor: "rgba(172,91,119,.14)" } }),
    preset("theme_obsidian", "黑曜极简", { tokens: { colorPrimary: "#d7d7da", colorAccent: "#ffffff", colorBg: "#070707", colorText: "#f4f4f4", colorMuted: "#99999f", chatUserBubbleBg: "rgba(62,62,66,.96)", chatAssistantBubbleBg: "rgba(22,22,24,.96)", bottomNavBg: "rgba(10,10,11,.94)", cardBg: "rgba(18,18,20,.94)", borderColor: "rgba(255,255,255,.10)", shadowSoft: "0 18px 45px rgba(0,0,0,.42)" }, layout: { glassIntensity: .25 } })
  ]);

  class ThemeError extends Error {
    constructor(message, code = "THEME_INVALID") { super(message); this.name = "ThemeError"; this.code = code; }
  }
  const safeText = (value, fallback, max = 120) => {
    const text = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/gu, "") : "";
    return text && text.length <= max ? text : fallback;
  };
  const safeColor = (value, fallback) => typeof value === "string" && COLOR.test(value.trim()) ? value.trim() : fallback;
  const safeCssValue = (value, fallback, pattern, max = 120) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text && text.length <= max && pattern.test(text) ? text : fallback;
  };
  const safeAsset = value => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    if (text.length > 2_800_000 || !SAFE_ASSET.test(text)) throw new ThemeError("主题资源 URL 不安全", "THEME_ASSET_FORBIDDEN");
    return text;
  };
  const safeCustomCss = value => {
    const css = typeof value === "string" ? value.trim() : "";
    if (css.length > MAX_CUSTOM_CSS) throw new ThemeError("customCss 超过 8000 字", "THEME_CSS_TOO_LARGE");
    if (css && DANGEROUS_CSS.test(css)) throw new ThemeError("customCss 包含危险规则", "THEME_CSS_FORBIDDEN");
    return css;
  };
  function normalizeTheme(input, { now = new Date() } = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ThemeError("主题必须是对象");
    const tokens = {}, assets = {}, layout = {};
    for (const key of TOKEN_FIELDS) {
      const fallback = DEFAULT_THEME.tokens[key];
      if (COLOR_FIELDS.has(key)) tokens[key] = safeColor(input.tokens?.[key], fallback);
      else if (key === "shadowSoft") tokens[key] = safeCssValue(input.tokens?.[key], fallback, /^(?:none|(?:-?\d+(?:\.\d+)?px\s+){2,4}(?:rgba?\([^)]+\)|#[0-9a-f]{3,8}))$/iu);
      else if (key === "fontFamily") tokens[key] = safeCssValue(input.tokens?.[key], fallback, /^[\p{L}\p{N}\s._'"-]+$/u, 80);
      else tokens[key] = safeCssValue(input.tokens?.[key], fallback, /^\d+(?:\.\d+)?(?:px|rem|%)$/u);
    }
    for (const key of ASSET_FIELDS) assets[key] = safeAsset(input.assets?.[key]);
    for (const key of LAYOUT_FIELDS) {
      const fallback = DEFAULT_THEME.layout[key];
      if (["glassIntensity", "backgroundDim", "bubbleOpacity", "navOpacity"].includes(key)) {
        const number = Number(input.layout?.[key]);
        layout[key] = Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
      } else if (key === "chatWidth") layout[key] = safeCssValue(input.layout?.[key], fallback, /^(?:auto|\d+(?:\.\d+)?(?:px|rem|%|vw))$/u);
      else layout[key] = safeCssValue(input.layout?.[key], fallback, /^\d+(?:\.\d+)?(?:px|rem|%)$/u);
    }
    const stamp = now.toISOString();
    return Object.freeze({
      id: safeText(input.id, `theme_${Math.random().toString(36).slice(2, 10)}`, 80),
      name: safeText(input.name, "未命名主题", 80), version: THEME_VERSION,
      author: safeText(input.author, "辞辞", 80),
      createdAt: /^\d{4}-\d{2}-\d{2}T/.test(input.createdAt || "") ? input.createdAt : stamp,
      updatedAt: stamp, tokens: Object.freeze(tokens), assets: Object.freeze(assets),
      layout: Object.freeze(layout), customCss: safeCustomCss(input.customCss)
    });
  }
  const cssVariables = theme => ({
    "--theme-primary": theme.tokens.colorPrimary, "--theme-accent": theme.tokens.colorAccent,
    "--theme-bg": theme.tokens.colorBg, "--theme-text": theme.tokens.colorText,
    "--theme-muted": theme.tokens.colorMuted, "--theme-user-bubble": theme.tokens.chatUserBubbleBg,
    "--theme-assistant-bubble": theme.tokens.chatAssistantBubbleBg, "--theme-bubble-text": theme.tokens.chatBubbleText,
    "--theme-bottom-nav": theme.tokens.bottomNavBg, "--theme-card": theme.tokens.cardBg,
    "--theme-border": theme.tokens.borderColor, "--theme-shadow-soft": theme.tokens.shadowSoft,
    "--theme-blur": theme.tokens.blur, "--theme-radius-bubble": theme.tokens.radiusBubble,
    "--theme-radius-card": theme.tokens.radiusCard, "--theme-font-size": theme.tokens.fontSizeBase,
    "--theme-font-family": FONT_MAP[theme.tokens.fontFamily] || `${JSON.stringify(theme.tokens.fontFamily)}, ${FONT_MAP.system}`,
    "--theme-chat-width": theme.layout.chatWidth, "--theme-bubble-max": theme.layout.bubbleMaxWidth,
    "--theme-message-gap": theme.layout.messageGap, "--theme-nav-height": theme.layout.bottomNavHeight,
    "--theme-glass": String(theme.layout.glassIntensity), "--theme-background-dim": String(theme.layout.backgroundDim),
    "--theme-bubble-opacity": String(theme.layout.bubbleOpacity), "--theme-nav-opacity": String(theme.layout.navOpacity),
    "--theme-radius-nav": theme.layout.radiusNav, "--theme-blur-nav": theme.layout.blurNav,
    "--theme-blur-bubble": theme.layout.blurBubble
  });
  class ThemeStore {
    constructor({ storage = typeof localStorage !== "undefined" ? localStorage : null,
      documentRef = typeof document !== "undefined" ? document : null } = {}) {
      this.storage = storage; this.document = documentRef;
    }
    getPresets() { return PRESET_THEMES.map(theme => normalizeTheme(theme)); }
    getActive() {
      try {
        const stored = this.storage?.getItem(ACTIVE_KEY);
        const theme = normalizeTheme(stored ? JSON.parse(stored) : DEFAULT_THEME);
        if (!stored) this.storage?.setItem(ACTIVE_KEY, JSON.stringify(theme));
        return theme;
      }
      catch { return normalizeTheme(DEFAULT_THEME); }
    }
    getLibrary() {
      try { const value = JSON.parse(this.storage?.getItem(LIBRARY_KEY) || "[]"); return Array.isArray(value) ? value.map(item => normalizeTheme(item)).slice(-100) : []; }
      catch { return []; }
    }
    saveLibrary(items) { this.storage?.setItem(LIBRARY_KEY, JSON.stringify(items.slice(-100))); return items; }
    applyTheme(input, { persist = true, applyBackground = false, target = null } = {}) {
      const theme = normalizeTheme(input); const rootNode = target || this.document?.documentElement;
      if (!rootNode?.style) return theme;
      for (const [key, value] of Object.entries(cssVariables(theme))) rootNode.style.setProperty(key, value);
      rootNode.dataset.xinbanTheme = theme.id;
      const background = theme.assets.chatBackgroundImage || theme.assets.backgroundImage || theme.assets.homeBackgroundImage;
      if (applyBackground && background) rootNode.style.setProperty("--theme-background-image", `url(${JSON.stringify(background)})`);
      else rootNode.style.removeProperty("--theme-background-image");
      let style = this.document?.getElementById?.("xinban-theme-custom-css");
      if (this.document && !style) { style = this.document.createElement("style"); style.id = "xinban-theme-custom-css"; this.document.head.append(style); }
      if (style) style.textContent = theme.customCss;
      if (persist) this.storage?.setItem(ACTIVE_KEY, JSON.stringify(theme));
      return theme;
    }
    applyActive() { return this.applyTheme(this.getActive(), { persist: false, applyBackground: true }); }
    importTheme(pack) {
      if (!pack || pack.type !== "xinban-theme" || Number(pack.themeVersion) !== THEME_VERSION) throw new ThemeError("不是受支持的心伴主题包", "THEME_PACKAGE_INVALID");
      const theme = normalizeTheme(pack.theme); const names = new Set([...this.getLibrary(), ...PRESET_THEMES].map(item => item.name));
      let name = theme.name, suffix = 2; while (names.has(name)) name = `${theme.name} (${suffix++})`;
      const imported = normalizeTheme({ ...theme, id: `theme_${Math.random().toString(36).slice(2, 10)}`, name });
      this.saveLibrary([...this.getLibrary(), imported]); return imported;
    }
    exportTheme(input = this.getActive()) { return Object.freeze({ type: "xinban-theme", themeVersion: THEME_VERSION, theme: normalizeTheme(input) }); }
  }
  return { ACTIVE_KEY, LIBRARY_KEY, DEFAULT_THEME, PRESET_THEMES, ThemeError, ThemeStore,
    normalizeTheme, safeAsset, safeCustomCss, cssVariables, THEME_VERSION };
});
