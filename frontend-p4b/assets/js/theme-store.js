"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.XinbanThemes = Object.freeze(api);
    root.XinbanThemeStore = new api.ThemeStore();
    root.XinbanThemeStore.applyActiveTheme();
    root.addEventListener?.("storage", event => { if (event.key === api.ACTIVE_KEY) root.XinbanThemeStore.applyActiveTheme(); });
    root.addEventListener?.("pageshow", () => root.XinbanThemeStore.applyActiveTheme());
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
    "chatUserBubbleBg", "chatUserBubbleText", "chatAssistantBubbleBg", "chatAssistantBubbleText",
    "chatBubbleText", "cardText", "cardMutedText", "inputText", "navText", "navActiveText",
    "previewText", "bottomNavBg", "cardBg", "headerBg", "headerText", "inputBg", "composerBg",
    "chatUserBubbleBorder", "chatAssistantBubbleBorder", "borderColor", "shadowSoft", "blur", "radiusBubble", "radiusCard", "inputRadius",
    "fontFamily", "fontSizeBase"
  ]);
  const COLOR_FIELDS = new Set([
    "colorPrimary", "colorAccent", "colorBg", "colorText", "colorMuted",
    "chatUserBubbleBg", "chatUserBubbleText", "chatAssistantBubbleBg", "chatAssistantBubbleText",
    "chatBubbleText", "cardText", "cardMutedText", "inputText", "navText", "navActiveText",
    "previewText", "bottomNavBg", "cardBg", "headerBg", "headerText", "inputBg", "composerBg",
    "chatUserBubbleBorder", "chatAssistantBubbleBorder", "borderColor"
  ]);
  const ASSET_FIELDS = Object.freeze([
    "backgroundImage", "chatBackgroundImage", "homeBackgroundImage", "bubbleTexture",
    "bottomNavTexture", "fontUrl", "avatarFrame", "inputDecoration", "headerDecoration",
    "userBubbleDecoration", "assistantBubbleDecoration", "decorativeAsset", "navIcon"
  ]);
  const VISUAL_SLOT_FIELDS = Object.freeze([
    "pageBackground", "chatHeaderDecor", "userBubbleDecor", "assistantBubbleDecor",
    "avatarFrame", "inputDecor", "homeCardDecor", "navAccent"
  ]);
  const LOCAL_THEME_ASSET = /^\/api\/theme\/assets\/[a-z0-9-]{8,80}$/iu;
  const LAYOUT_FIELDS = Object.freeze([
    "chatWidth", "bubbleMaxWidth", "messageGap", "bottomNavHeight", "glassIntensity",
    "backgroundDim", "bubbleOpacity", "navOpacity", "cardOpacity", "radiusNav", "blurNav", "blurBubble",
    "effectsMode", "shadowLevel", "backgroundBlur", "enableGlass", "enableAnimations", "readabilityGuard"
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
      colorPrimary: "#9a79c6", colorAccent: "#829bdd", colorBg: "#171326",
      colorText: "#f5f0ff", colorMuted: "#c1b5d3",
      chatUserBubbleBg: "rgba(112,82,137,.94)", chatUserBubbleText: "#ffffff",
      chatAssistantBubbleBg: "rgba(255,255,255,.82)", chatAssistantBubbleText: "#342b45",
      chatBubbleText: "#342b45", cardText: "#342b45", cardMutedText: "#6f647d",
      inputText: "#342b45", navText: "#62576f", navActiveText: "#5e3f7c", previewText: "#342b45",
      bottomNavBg: "rgba(255,255,255,.74)", cardBg: "rgba(255,255,255,.62)", headerBg: "rgba(255,255,255,.68)", headerText: "#342b45",
      inputBg: "rgba(255,255,255,.76)", composerBg: "rgba(255,255,255,.68)", chatUserBubbleBorder: "rgba(91,67,112,.14)", chatAssistantBubbleBorder: "rgba(91,67,112,.14)", borderColor: "rgba(91,67,112,.14)",
      shadowSoft: "0 12px 30px rgba(63,44,78,.12)", blur: "12px",
      radiusBubble: "24px", radiusCard: "28px", inputRadius: "18px", fontFamily: "system", fontSizeBase: "15px"
    }),
    assets: Object.freeze({ backgroundImage: "", chatBackgroundImage: "", homeBackgroundImage: "", bubbleTexture: "", bottomNavTexture: "", fontUrl: "", avatarFrame: "", inputDecoration: "", headerDecoration: "", userBubbleDecoration: "", assistantBubbleDecoration: "", decorativeAsset: "", navIcon: "" }),
    assetLibrary: Object.freeze([]),
    visualSlots: Object.freeze({
      enabledByUser: false,
      pageBackground: Object.freeze({ url: "", enabled: false, opacity: .2, position: "center", size: "cover" }),
      chatHeaderDecor: Object.freeze({ url: "", enabled: false, opacity: .72, position: "right", size: "contain" }),
      userBubbleDecor: Object.freeze({ url: "", enabled: false, opacity: .9, position: "top-right", size: "small" }),
      assistantBubbleDecor: Object.freeze({ url: "", enabled: false, opacity: .9, position: "top-left", size: "small" }),
      avatarFrame: Object.freeze({ url: "", enabled: false, opacity: 1, position: "center", size: "small" }),
      inputDecor: Object.freeze({ url: "", enabled: false, opacity: .8, position: "right", size: "small" }),
      homeCardDecor: Object.freeze({ url: "", enabled: false, opacity: .48, position: "corner", size: "medium" }),
      navAccent: Object.freeze({ url: "", enabled: false, opacity: .32, position: "center", size: "small" })
    }),
    layout: Object.freeze({ chatWidth: "auto", bubbleMaxWidth: "78%", messageGap: "14px", bottomNavHeight: "86px", glassIntensity: .62, backgroundDim: .12, bubbleOpacity: .96, navOpacity: .92, cardOpacity: .82, radiusNav: "24px", blurNav: "12px", blurBubble: "0px", effectsMode: "balanced", shadowLevel: "soft", backgroundBlur: "0px", enableGlass: true, enableAnimations: true, readabilityGuard: true }),
    customCss: ""
  });
  const preset = (id, name, values) => Object.freeze({ ...DEFAULT_THEME, id, name, ...values,
    tokens: Object.freeze({ ...DEFAULT_THEME.tokens, ...(values.tokens || {}) }),
    assets: DEFAULT_THEME.assets, assetLibrary: DEFAULT_THEME.assetLibrary, visualSlots: DEFAULT_THEME.visualSlots,
    layout: Object.freeze({ ...DEFAULT_THEME.layout, ...(values.layout || {}) }) });
  const PRESET_THEMES = Object.freeze([
    DEFAULT_THEME,
    preset("theme_milk_glass", "奶白玻璃", { tokens: { colorPrimary: "#8f789e", colorAccent: "#b9a5c5", colorBg: "#f6f1ec", colorText: "#403943", colorMuted: "#756b75", chatUserBubbleBg: "rgba(218,195,225,.94)", chatUserBubbleText: "#392e3d", chatAssistantBubbleBg: "rgba(255,255,255,.86)", chatAssistantBubbleText: "#403943", cardText: "#403943", cardMutedText: "#756b75", inputText: "#403943", navText: "#6d626f", navActiveText: "#6f527b", previewText: "#403943", bottomNavBg: "rgba(255,255,255,.78)", cardBg: "rgba(255,255,255,.68)", borderColor: "rgba(98,77,108,.14)", shadowSoft: "0 10px 26px rgba(78,58,82,.10)" } }),
    preset("theme_midnight_blue", "深夜蓝紫", { tokens: { colorPrimary: "#8585e6", colorAccent: "#b2a7ff", colorBg: "#090b18", colorText: "#f0f1ff", colorMuted: "#b4b8d8", chatUserBubbleBg: "rgba(82,76,160,.96)", chatUserBubbleText: "#ffffff", chatAssistantBubbleBg: "rgba(24,27,54,.96)", chatAssistantBubbleText: "#f0f1ff", cardText: "#f0f1ff", cardMutedText: "#b4b8d8", inputText: "#f0f1ff", navText: "#c1c4e4", navActiveText: "#ffffff", previewText: "#f0f1ff", bottomNavBg: "rgba(10,12,30,.90)", cardBg: "rgba(18,21,44,.86)", borderColor: "rgba(166,160,255,.17)" } }),
    preset("theme_sakura", "樱花浅粉", { tokens: { colorPrimary: "#b85f7f", colorAccent: "#e89bb5", colorBg: "#fff3f6", colorText: "#533d47", colorMuted: "#806873", chatUserBubbleBg: "rgba(232,158,184,.92)", chatUserBubbleText: "#442d37", chatAssistantBubbleBg: "rgba(255,255,255,.88)", chatAssistantBubbleText: "#533d47", cardText: "#533d47", cardMutedText: "#806873", inputText: "#533d47", navText: "#806873", navActiveText: "#9e4968", previewText: "#533d47", bottomNavBg: "rgba(255,245,248,.86)", cardBg: "rgba(255,255,255,.72)", borderColor: "rgba(172,91,119,.14)" } }),
    preset("theme_obsidian", "黑曜极简", { tokens: { colorPrimary: "#d7d7da", colorAccent: "#ffffff", colorBg: "#070707", colorText: "#f4f4f4", colorMuted: "#b2b2b8", chatUserBubbleBg: "rgba(62,62,66,.98)", chatUserBubbleText: "#ffffff", chatAssistantBubbleBg: "rgba(22,22,24,.98)", chatAssistantBubbleText: "#f4f4f4", cardText: "#f4f4f4", cardMutedText: "#b2b2b8", inputText: "#f4f4f4", navText: "#c0c0c4", navActiveText: "#ffffff", previewText: "#f4f4f4", bottomNavBg: "rgba(10,10,11,.96)", cardBg: "rgba(18,18,20,.96)", borderColor: "rgba(255,255,255,.10)", shadowSoft: "0 12px 30px rgba(0,0,0,.34)" }, layout: { glassIntensity: .25 } })
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
  const safeVisualAsset = value => {
    const text = typeof value === "string" ? value.trim() : "";
    return LOCAL_THEME_ASSET.test(text) ? text : "";
  };
  const normalizeVisualSlots = (input = {}, assets = {}) => {
    const legacy = {
      pageBackground: assets.backgroundImage, chatHeaderDecor: assets.headerDecoration,
      userBubbleDecor: assets.userBubbleDecoration, assistantBubbleDecor: assets.assistantBubbleDecoration,
      avatarFrame: assets.avatarFrame, inputDecor: assets.inputDecoration,
      homeCardDecor: assets.decorativeAsset, navAccent: assets.navIcon
    };
    const enabledByUser = input?.enabledByUser === true; const slots = { enabledByUser };
    for (const key of VISUAL_SLOT_FIELDS) {
      const fallback = DEFAULT_THEME.visualSlots[key]; const candidate = input?.[key] || {};
      slots[key] = Object.freeze({
        url: safeVisualAsset(candidate.url || legacy[key]),
        enabled: enabledByUser && candidate.enabled === true,
        opacity: Number.isFinite(Number(candidate.opacity)) ? Math.max(0, Math.min(1, Number(candidate.opacity))) : fallback.opacity,
        position: ["center", "right", "left", "top-right", "top-left", "corner"].includes(candidate.position) ? candidate.position : fallback.position,
        size: ["cover", "contain", "small", "medium"].includes(candidate.size) ? candidate.size : fallback.size
      });
    }
    return Object.freeze(slots);
  };
  const safeCustomCss = value => {
    const css = typeof value === "string" ? value.trim() : "";
    if (css.length > MAX_CUSTOM_CSS) throw new ThemeError("customCss 超过 8000 字", "THEME_CSS_TOO_LARGE");
    if (css && DANGEROUS_CSS.test(css)) throw new ThemeError("customCss 包含危险规则", "THEME_CSS_FORBIDDEN");
    return css;
  };
  const parseColor = value => {
    const text = String(value || "").trim().toLowerCase();
    const hex = text.match(/^#([0-9a-f]{3,8})$/u)?.[1];
    if (hex) {
      const full = hex.length <= 4 ? [...hex].map(char => char + char).join("") : hex;
      const rgb = [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
      return [...rgb, full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
    }
    const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)%?)?\s*\)$/u);
    if (!rgb) return null;
    const alphaRaw = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Math.max(0, Math.min(1, alphaRaw > 1 ? alphaRaw / 100 : alphaRaw))];
  };
  const composite = (foreground, background) => {
    const alpha = foreground[3];
    return foreground.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha));
  };
  const luminance = rgb => {
    const channels = rgb.slice(0, 3).map(value => { const normalized = value / 255; return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4; });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const contrastRatio = (foreground, background, pageBackground = "#ffffff") => {
    const page = parseColor(pageBackground) || [255, 255, 255, 1];
    const bg = parseColor(background); const fg = parseColor(foreground);
    if (!bg || !fg) return 21;
    const solidBg = composite(bg, page); const solidFg = composite(fg, solidBg);
    const [lighter, darker] = [luminance(solidFg), luminance(solidBg)].sort((a, b) => b - a);
    return (lighter + .05) / (darker + .05);
  };
  const readableText = (background, preferred, pageBackground, minimum = 4.5) => {
    if (contrastRatio(preferred, background, pageBackground) >= minimum) return preferred;
    const candidates = ["#241c30", "#ffffff"];
    return candidates.sort((a, b) => contrastRatio(b, background, pageBackground) - contrastRatio(a, background, pageBackground))[0];
  };
  const needsHarmonyBackground = value => {
    const parsed = parseColor(value); if (!parsed || parsed[3] < .2) return true;
    const [red, green, blue] = parsed; const brightness = red * .299 + green * .587 + blue * .114;
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    return brightness > 72 && brightness < 224 && (red > blue + 16 || spread < 34);
  };
  const guardReadability = theme => {
    const tokens = { ...theme.tokens }; const page = tokens.colorBg;
    tokens.chatUserBubbleText = readableText(tokens.chatUserBubbleBg, tokens.chatUserBubbleText, page);
    tokens.chatAssistantBubbleText = readableText(tokens.chatAssistantBubbleBg, tokens.chatAssistantBubbleText, page);
    tokens.cardText = readableText(tokens.cardBg, tokens.cardText, page);
    tokens.cardMutedText = readableText(tokens.cardBg, tokens.cardMutedText, page);
    tokens.inputText = readableText(tokens.inputBg, tokens.inputText, page);
    tokens.headerText = readableText(tokens.headerBg, tokens.headerText, page);
    tokens.navText = readableText(tokens.bottomNavBg, tokens.navText, page);
    tokens.navActiveText = readableText(tokens.bottomNavBg, tokens.navActiveText, page);
    tokens.previewText = readableText(tokens.cardBg, tokens.previewText, page);
    return { ...theme, tokens };
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
      if (["glassIntensity", "backgroundDim", "bubbleOpacity", "navOpacity", "cardOpacity"].includes(key)) {
        const number = Number(input.layout?.[key]);
        layout[key] = Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
      } else if (key === "effectsMode") layout[key] = ["pretty", "balanced", "performance"].includes(input.layout?.[key]) ? input.layout[key] : fallback;
      else if (key === "shadowLevel") layout[key] = ["none", "soft", "medium"].includes(input.layout?.[key]) ? input.layout[key] : fallback;
      else if (["enableGlass", "enableAnimations", "readabilityGuard"].includes(key)) layout[key] = typeof input.layout?.[key] === "boolean" ? input.layout[key] : fallback;
      else if (key === "chatWidth") layout[key] = safeCssValue(input.layout?.[key], fallback, /^(?:auto|\d+(?:\.\d+)?(?:px|rem|%|vw))$/u);
      else layout[key] = safeCssValue(input.layout?.[key], fallback, /^\d+(?:\.\d+)?(?:px|rem|%)$/u);
    }
    if (!input.tokens?.chatUserBubbleText) tokens.chatUserBubbleText = safeColor(input.tokens?.chatBubbleText, tokens.chatUserBubbleText);
    if (!input.tokens?.chatAssistantBubbleText) tokens.chatAssistantBubbleText = safeColor(input.tokens?.chatBubbleText, tokens.chatAssistantBubbleText);
    if (Number(input.harmonyVersion || 0) < 2 && needsHarmonyBackground(tokens.colorBg)) tokens.colorBg = DEFAULT_THEME.tokens.colorBg;
    const stamp = now.toISOString();
    let normalized = {
      id: safeText(input.id, `theme_${Math.random().toString(36).slice(2, 10)}`, 80),
      name: safeText(input.name, "未命名主题", 80), version: THEME_VERSION, harmonyVersion: 2,
      author: safeText(input.author, "辞辞", 80),
      createdAt: /^\d{4}-\d{2}-\d{2}T/.test(input.createdAt || "") ? input.createdAt : stamp,
      updatedAt: stamp, tokens: Object.freeze(tokens), assets: Object.freeze(assets),
      assetLibrary: Object.freeze((Array.isArray(input.assetLibrary) ? input.assetLibrary : []).slice(0, 30).map((item, index) => Object.freeze({
        id: safeText(item?.id, `asset_${index + 1}`, 80), kind: safeText(item?.kind, "decorativeAsset", 40), url: safeVisualAsset(item?.url)
      })).filter(item => item.url)),
      visualSlots: normalizeVisualSlots(input.visualSlots, assets),
      migratedVisualSlotsSafe: input.migratedVisualSlotsSafe === true || (Boolean(input.visualSlots) && input.visualSlots?.enabledByUser !== true),
      layout, customCss: safeCustomCss(input.customCss)
    };
    if (layout.readabilityGuard) normalized = guardReadability(normalized);
    return Object.freeze({ ...normalized, tokens: Object.freeze(normalized.tokens), assets: Object.freeze(assets), layout: Object.freeze(layout) });
  }
  const cssVariables = input => {
    const theme = normalizeTheme(input); const mode = theme.layout.effectsMode;
    const maxBlur = mode === "pretty" ? 24 : mode === "balanced" ? 12 : 2;
    const clampBlur = value => `${Math.min(maxBlur, Math.max(0, parseFloat(value) || 0))}px`;
    const shadow = mode === "performance" || theme.layout.shadowLevel === "none" ? "none" : theme.layout.shadowLevel === "medium" && mode === "pretty" ? theme.tokens.shadowSoft : "0 8px 22px rgba(63,44,78,.10)";
    const glass = theme.layout.enableGlass && mode !== "performance";
    return ({
    "--theme-primary": theme.tokens.colorPrimary, "--theme-accent": theme.tokens.colorAccent,
    "--theme-bg": theme.tokens.colorBg, "--theme-text": theme.tokens.colorText,
    "--theme-muted": theme.tokens.colorMuted, "--theme-user-bubble": theme.tokens.chatUserBubbleBg,
    "--theme-user-bubble-text": theme.tokens.chatUserBubbleText, "--theme-assistant-bubble": theme.tokens.chatAssistantBubbleBg,
    "--theme-assistant-bubble-text": theme.tokens.chatAssistantBubbleText, "--theme-bubble-text": theme.tokens.chatAssistantBubbleText,
    "--theme-card-text": theme.tokens.cardText, "--theme-card-muted": theme.tokens.cardMutedText,
    "--theme-input-text": theme.tokens.inputText, "--theme-nav-text": theme.tokens.navText,
    "--theme-nav-active-text": theme.tokens.navActiveText, "--theme-preview-text": theme.tokens.previewText,
    "--theme-bottom-nav": theme.tokens.bottomNavBg, "--theme-card": theme.tokens.cardBg,
    "--theme-header-bg": theme.tokens.headerBg, "--theme-header-text": theme.tokens.headerText,
    "--theme-input-bg": theme.tokens.inputBg, "--theme-composer-bg": theme.tokens.composerBg,
    "--theme-user-bubble-border": theme.tokens.chatUserBubbleBorder, "--theme-assistant-bubble-border": theme.tokens.chatAssistantBubbleBorder,
    "--theme-border": theme.tokens.borderColor, "--theme-shadow-soft": shadow,
    "--theme-blur": clampBlur(theme.tokens.blur), "--theme-radius-bubble": theme.tokens.radiusBubble,
    "--theme-radius-card": theme.tokens.radiusCard, "--theme-font-size": theme.tokens.fontSizeBase,
    "--theme-input-radius": theme.tokens.inputRadius,
    "--theme-font-family": FONT_MAP[theme.tokens.fontFamily] || `${JSON.stringify(theme.tokens.fontFamily)}, ${FONT_MAP.system}`,
    "--theme-chat-width": theme.layout.chatWidth, "--theme-bubble-max": theme.layout.bubbleMaxWidth,
    "--theme-message-gap": theme.layout.messageGap, "--theme-nav-height": theme.layout.bottomNavHeight,
    "--theme-glass": glass ? String(theme.layout.glassIntensity) : "0", "--theme-background-dim": String(theme.layout.backgroundDim),
    "--theme-bubble-opacity": String(theme.layout.bubbleOpacity), "--theme-nav-opacity": String(theme.layout.navOpacity),
    "--theme-card-opacity": String(theme.layout.cardOpacity), "--theme-radius-nav": theme.layout.radiusNav,
    "--theme-blur-nav": glass ? clampBlur(theme.layout.blurNav) : "0px", "--theme-blur-bubble": "0px",
    "--theme-background-blur": mode === "performance" ? "0px" : clampBlur(theme.layout.backgroundBlur),
    "--theme-animation-duration": theme.layout.enableAnimations && mode !== "performance" ? ".2s" : "0s"
    ,"--theme-color-text": theme.tokens.colorText, "--theme-color-text-muted": theme.tokens.colorMuted
    ,"--theme-color-primary": theme.tokens.colorPrimary, "--theme-color-primary-strong": theme.tokens.colorPrimary
    ,"--theme-color-primary-bright": theme.tokens.colorAccent
    ,"--theme-color-surface": theme.tokens.cardBg, "--theme-color-surface-soft": `color-mix(in srgb, ${theme.tokens.cardBg} 76%, ${theme.tokens.colorBg})`
    ,"--theme-color-border": theme.tokens.borderColor, "--theme-color-focus": `color-mix(in srgb, ${theme.tokens.colorPrimary} 38%, transparent)`
    ,"--theme-shadow": shadow, "--theme-background-overlay": "transparent"
    ,"--theme-background": `linear-gradient(180deg, ${theme.tokens.colorBg}, color-mix(in srgb, ${theme.tokens.colorBg} 92%, ${theme.tokens.colorPrimary}))`
    ,"--avatar-border-color": theme.tokens.colorPrimary, "--avatar-ring-color": `color-mix(in srgb, ${theme.tokens.colorPrimary} 24%, transparent)`
    ,"--avatar-surface": `linear-gradient(145deg, ${theme.tokens.colorAccent}, ${theme.tokens.colorPrimary})`
    ,"--theme-bubble-texture": theme.assets.bubbleTexture ? `url(${JSON.stringify(theme.assets.bubbleTexture)})` : "none"
    ,"--theme-nav-texture": theme.assets.bottomNavTexture ? `url(${JSON.stringify(theme.assets.bottomNavTexture)})` : "none"
    ,"--theme-input-decoration": theme.assets.inputDecoration ? `url(${JSON.stringify(theme.assets.inputDecoration)})` : "none"
    ,"--theme-header-decoration": theme.assets.headerDecoration ? `url(${JSON.stringify(theme.assets.headerDecoration)})` : "none"
    ,"--theme-avatar-frame": theme.assets.avatarFrame ? `url(${JSON.stringify(theme.assets.avatarFrame)})` : "none"
    ,"--xb-color-bg": theme.tokens.colorBg, "--xb-color-text": theme.tokens.colorText
    ,"--xb-color-surface": theme.tokens.cardBg, "--xb-color-surface-soft": `color-mix(in srgb, ${theme.tokens.cardBg} 76%, ${theme.tokens.colorBg})`
    ,"--xb-color-text-muted": theme.tokens.colorMuted, "--xb-color-accent": theme.tokens.colorPrimary, "--xb-color-accent-soft": `color-mix(in srgb, ${theme.tokens.colorPrimary} 15%, ${theme.tokens.cardBg})`
    ,"--xb-accent": theme.tokens.colorPrimary, "--xb-accent-soft": `color-mix(in srgb, ${theme.tokens.colorPrimary} 13%, ${theme.tokens.cardBg})`
    ,"--xb-accent-soft-2": `color-mix(in srgb, ${theme.tokens.colorPrimary} 22%, ${theme.tokens.cardBg})`, "--xb-accent-strong": `color-mix(in srgb, ${theme.tokens.colorPrimary} 86%, ${theme.tokens.colorText})`
    ,"--xb-accent-border": `color-mix(in srgb, ${theme.tokens.colorPrimary} 28%, ${theme.tokens.borderColor})`, "--xb-accent-text": theme.tokens.colorPrimary
    ,"--xb-accent-icon-bg": `color-mix(in srgb, ${theme.tokens.colorPrimary} 14%, ${theme.tokens.cardBg})`, "--xb-accent-card-bg": `color-mix(in srgb, ${theme.tokens.colorPrimary} 19%, ${theme.tokens.cardBg})`
    ,"--xb-accent-card-text": readableText(`rgba(255,255,255,.78)`, theme.tokens.cardText, theme.tokens.colorBg), "--xb-fab-bg": `color-mix(in srgb, ${theme.tokens.colorPrimary} 20%, ${theme.tokens.bottomNavBg})`, "--xb-fab-text": theme.tokens.colorPrimary
    ,"--xb-page-bg": theme.tokens.colorBg, "--xb-page-text": theme.tokens.colorText
    ,"--xb-header-bg": theme.tokens.headerBg, "--xb-header-text": theme.tokens.headerText
    ,"--xb-card-bg": theme.tokens.cardBg, "--xb-card-text": theme.tokens.cardText, "--xb-card-muted": theme.tokens.cardMutedText
    ,"--xb-card-border": theme.tokens.borderColor, "--xb-card-shadow": shadow
    ,"--xb-composer-bg": theme.tokens.composerBg, "--xb-input-bg": theme.tokens.inputBg, "--xb-input-text": theme.tokens.inputText, "--xb-input-border": theme.tokens.borderColor
    ,"--xb-button-bg": theme.tokens.colorPrimary, "--xb-button-text": readableText(theme.tokens.colorPrimary, "#ffffff", theme.tokens.colorBg), "--xb-button-border": theme.tokens.borderColor
    ,"--xb-bottom-nav-bg": theme.tokens.bottomNavBg, "--xb-nav-text": theme.tokens.navText, "--xb-nav-active-text": theme.tokens.colorPrimary, "--xb-nav-active-icon": theme.tokens.colorPrimary
    ,"--xb-nav-active-bg": `color-mix(in srgb, ${theme.tokens.colorPrimary} 14%, ${theme.tokens.bottomNavBg})`
    ,"--xb-status-bg": `color-mix(in srgb, ${theme.tokens.colorAccent} 14%, ${theme.tokens.cardBg})`, "--xb-status-text": theme.tokens.cardText
    ,"--xb-badge-bg": `color-mix(in srgb, ${theme.tokens.colorPrimary} 13%, ${theme.tokens.cardBg})`, "--xb-badge-text": theme.tokens.cardText
    ,"--xb-avatar-ring": theme.tokens.colorPrimary, "--xb-progress-bg": `color-mix(in srgb, ${theme.tokens.cardMutedText} 18%, ${theme.tokens.cardBg})`, "--xb-progress-fill": theme.tokens.colorPrimary
    ,"--xb-chat-user-bubble-bg": theme.tokens.chatUserBubbleBg, "--xb-chat-user-bubble-text": theme.tokens.chatUserBubbleText
    ,"--xb-chat-assistant-bubble-bg": theme.tokens.chatAssistantBubbleBg, "--xb-chat-assistant-bubble-text": theme.tokens.chatAssistantBubbleText
    ,"--xb-border-color": theme.tokens.borderColor, "--xb-radius-bubble": theme.tokens.radiusBubble, "--xb-radius-card": theme.tokens.radiusCard, "--xb-radius-button": `calc(${theme.tokens.radiusCard} * .48)`
    ,"--xb-bg-image": mode === "performance" || !theme.visualSlots.pageBackground.enabled || !theme.visualSlots.pageBackground.url ? "none" : `url(${JSON.stringify(theme.visualSlots.pageBackground.url)})`
    ,"--xb-bg-image-opacity": String(theme.visualSlots.pageBackground.opacity)
    ,"--xb-header-decor": mode === "performance" || !theme.visualSlots.chatHeaderDecor.enabled || !theme.visualSlots.chatHeaderDecor.url ? "none" : `url(${JSON.stringify(theme.visualSlots.chatHeaderDecor.url)})`
    ,"--xb-user-bubble-decor": mode === "performance" || !theme.visualSlots.userBubbleDecor.enabled || !theme.visualSlots.userBubbleDecor.url ? "none" : `url(${JSON.stringify(theme.visualSlots.userBubbleDecor.url)})`
    ,"--xb-assistant-bubble-decor": mode === "performance" || !theme.visualSlots.assistantBubbleDecor.enabled || !theme.visualSlots.assistantBubbleDecor.url ? "none" : `url(${JSON.stringify(theme.visualSlots.assistantBubbleDecor.url)})`
    ,"--xb-avatar-frame": mode === "performance" || !theme.visualSlots.avatarFrame.enabled || !theme.visualSlots.avatarFrame.url ? "none" : `url(${JSON.stringify(theme.visualSlots.avatarFrame.url)})`
    ,"--xb-input-decor": mode === "performance" || !theme.visualSlots.inputDecor.enabled || !theme.visualSlots.inputDecor.url ? "none" : `url(${JSON.stringify(theme.visualSlots.inputDecor.url)})`
    ,"--xb-home-card-decor": mode === "performance" || !theme.visualSlots.homeCardDecor.enabled || !theme.visualSlots.homeCardDecor.url ? "none" : `url(${JSON.stringify(theme.visualSlots.homeCardDecor.url)})`
    ,"--xb-nav-accent": mode === "performance" || !theme.visualSlots.navAccent.enabled || !theme.visualSlots.navAccent.url ? "none" : `url(${JSON.stringify(theme.visualSlots.navAccent.url)})`
  }); };
  class ThemeStore {
    constructor({ storage = typeof localStorage !== "undefined" ? localStorage : null,
      documentRef = typeof document !== "undefined" ? document : null } = {}) {
      this.storage = storage; this.document = documentRef; this.lastVisualSlotsMigration = false;
    }
    getPresets() { return PRESET_THEMES.map(theme => normalizeTheme(theme)); }
    getActive() {
      try {
        const stored = this.storage?.getItem(ACTIVE_KEY);
        const parsed = stored ? JSON.parse(stored) : DEFAULT_THEME; const theme = normalizeTheme(parsed);
        const visualSlotsMigration = Boolean(parsed.visualSlots && parsed.visualSlots.enabledByUser !== true && parsed.migratedVisualSlotsSafe !== true);
        if (visualSlotsMigration) this.lastVisualSlotsMigration = true;
        if (!stored || Number(parsed.harmonyVersion || 0) < 2 || visualSlotsMigration) this.storage?.setItem(ACTIVE_KEY, JSON.stringify(theme));
        return theme;
      }
      catch { return normalizeTheme(DEFAULT_THEME); }
    }
    getLibrary() {
      try { const value = JSON.parse(this.storage?.getItem(LIBRARY_KEY) || "[]"); return Array.isArray(value) ? value.map(item => normalizeTheme(item)).slice(-100) : []; }
      catch { return []; }
    }
    saveLibrary(items) { this.storage?.setItem(LIBRARY_KEY, JSON.stringify(items.slice(-100))); return items; }
    getThemeById(id) { return [...this.getLibrary(), ...this.getPresets()].find(theme => theme.id === id) || null; }
    applyTheme(input, { persist = true, applyBackground = false, target = null } = {}) {
      const theme = normalizeTheme(input); const rootNode = target || this.document?.documentElement;
      if (!rootNode?.style) return theme;
      for (const [key, value] of Object.entries(cssVariables(theme))) rootNode.style.setProperty(key, value);
      rootNode.dataset.xinbanTheme = theme.id;
      rootNode.dataset.themeEffects = theme.layout.effectsMode;
      const effectClasses = ["theme-effects-pretty", "theme-effects-balanced", "theme-effects-performance"];
      rootNode.classList?.add?.("has-xinban-theme"); rootNode.classList?.remove?.(...effectClasses); rootNode.classList?.add?.(`theme-effects-${theme.layout.effectsMode}`);
      const applyBodyClasses = () => { const body = this.document?.body; if (!body?.classList) return; body.classList.add("has-xinban-theme"); body.classList.remove(...effectClasses); body.classList.add(`theme-effects-${theme.layout.effectsMode}`); };
      applyBodyClasses();
      if (!this.document?.body) this.document?.addEventListener?.("DOMContentLoaded", applyBodyClasses, { once: true });
      const background = theme.assets.chatBackgroundImage || theme.assets.backgroundImage || theme.assets.homeBackgroundImage;
      if (applyBackground && background) rootNode.style.setProperty("--theme-background-image", `url(${JSON.stringify(background)})`);
      else rootNode.style.removeProperty("--theme-background-image");
      let style = this.document?.getElementById?.("xinban-theme-custom-css");
      if (this.document && !style) { style = this.document.createElement("style"); style.id = "xinban-theme-custom-css"; this.document.head.append(style); }
      if (style) style.textContent = theme.customCss;
      if (persist) this.storage?.setItem(ACTIVE_KEY, JSON.stringify(theme));
      const view = this.document?.defaultView || (typeof window !== "undefined" ? window : null);
      if (view?.dispatchEvent && typeof view.CustomEvent === "function") view.dispatchEvent(new view.CustomEvent("xinban:theme-applied", { detail: { id: theme.id, effectsMode: theme.layout.effectsMode } }));
      return theme;
    }
    applyActiveTheme() { return this.applyTheme(this.getActive(), { persist: false, applyBackground: true, target: this.document?.documentElement }); }
    applyActive() { return this.applyActiveTheme(); }
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
    normalizeTheme, normalizeVisualSlots, safeAsset, safeVisualAsset, safeCustomCss, cssVariables, parseColor, contrastRatio, readableText, guardReadability, needsHarmonyBackground, THEME_VERSION };
});
