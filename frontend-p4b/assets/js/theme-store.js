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
    "chatUserBubbleBorder", "chatAssistantBubbleBorder", "borderColor", "iconBlockBg", "progressBg", "progressFill", "avatarRing",
    "shadowSoft", "blur", "radiusBubble", "radiusCard", "inputRadius",
    "fontFamily", "fontSizeBase"
  ]);
  const COLOR_FIELDS = new Set([
    "colorPrimary", "colorAccent", "colorBg", "colorText", "colorMuted",
    "chatUserBubbleBg", "chatUserBubbleText", "chatAssistantBubbleBg", "chatAssistantBubbleText",
    "chatBubbleText", "cardText", "cardMutedText", "inputText", "navText", "navActiveText",
    "previewText", "bottomNavBg", "cardBg", "headerBg", "headerText", "inputBg", "composerBg",
    "chatUserBubbleBorder", "chatAssistantBubbleBorder", "borderColor", "iconBlockBg", "progressBg", "progressFill", "avatarRing"
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
  const DESIGN_REGIONS = Object.freeze({
    "chat.page":"聊天 · 页面背景","chat.header":"聊天 · 顶栏","chat.userBubble":"聊天 · 用户气泡","chat.assistantBubble":"聊天 · 沉气泡","chat.composer":"聊天 · 输入栏","chat.bottomNav":"聊天 · 底部导航","chat.sendButton":"聊天 · 发送按钮","chat.activeButton":"聊天 · active 按钮",
    "home.page":"小窝 · 页面背景","home.hero":"小窝 · Hero 大卡片","home.avatar":"小窝 · 头像圈","home.status":"小窝 · 状态条","home.todayCard":"小窝 · 今日寄语卡片","home.progress":"小窝 · 进度条","home.startChatCard":"小窝 · 开始聊天卡片","home.secondaryCards":"小窝 · 记忆/状态卡片","home.bottomNav":"小窝 · 底部导航","home.activeButton":"小窝 · active 按钮","home.iconBlock":"小窝 · 图标底块",
    "space.page":"空间 · 页面背景","space.card":"空间 · 主卡片","space.input":"空间 · 输入框","space.button":"空间 · 按钮","space.avatarCard":"空间 · 头像卡片",
    "collaboration.page":"议事厅 · 页面背景","collaboration.card":"议事厅 · 主卡片","collaboration.input":"议事厅 · 输入框","collaboration.button":"议事厅 · 按钮","collaboration.avatarCard":"议事厅 · Agent 卡片",
    "settings.page":"设置 · 页面背景","settings.card":"设置 · 卡片","settings.button":"设置 · 按钮","settings.input":"设置 · 输入框","settings.bottomNav":"设置 · 底部导航"
  });
  const DESIGN_PAGES = Object.freeze({ chat:"聊天",home:"小窝",space:"空间",collaboration:"议事厅",settings:"设置" });
  const DESIGN_COLOR_FIELDS = Object.freeze(["backgroundColor","textColor","borderColor","accentColor"]);
  const DESIGN_IMAGE_DEFAULT = Object.freeze({ enabled:false,url:"",opacity:.25,size:"cover",position:"center",repeat:"no-repeat",blendMode:"normal",offsetX:0,offsetY:0,scale:1,blur:0 });
  const DESIGN_REGION_DEFAULT = Object.freeze({ enabled:false,backgroundColor:"transparent",textColor:"transparent",borderColor:"transparent",accentColor:"transparent",borderWidth:0,radius:0,shadow:0,blur:0,opacity:1,glassOpacity:1,image:DESIGN_IMAGE_DEFAULT });
  const DEFAULT_THEME = Object.freeze({
    id: "theme_default_purple_mist", name: "默认紫雾", version: 1, author: "心伴",
    source: "preset", accentMode: "theme", accentExplicit: true,
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
      iconBlockBg: "rgba(154,121,198,.14)", progressBg: "rgba(111,100,125,.18)", progressFill: "#9a79c6", avatarRing: "rgba(154,121,198,.58)",
      shadowSoft: "0 12px 30px rgba(63,44,78,.12)", blur: "12px",
      radiusBubble: "24px", radiusCard: "28px", inputRadius: "18px", fontFamily: "system", fontSizeBase: "15px"
    }),
    assets: Object.freeze({ backgroundImage: "", chatBackgroundImage: "", homeBackgroundImage: "", bubbleTexture: "", bottomNavTexture: "", fontUrl: "", avatarFrame: "", inputDecoration: "", headerDecoration: "", userBubbleDecoration: "", assistantBubbleDecoration: "", decorativeAsset: "", navIcon: "" }),
    assetLibrary: Object.freeze([]),
    visualSlots: Object.freeze({
      enabledByUser: false,
      pageBackground: Object.freeze({ url: "", enabled: false, opacity: .2, position: "center", size: "cover", x: 0, y: 0, scale: 1, rotation: 0, radius: 0, borderWidth: 0, borderColor: "transparent", shadow: "none" }),
      chatHeaderDecor: Object.freeze({ url: "", enabled: false, opacity: .72, position: "right", size: "contain", x: 0, y: 0, scale: 1, rotation: 0, radius: 0, borderWidth: 0, borderColor: "transparent", shadow: "none" }),
      userBubbleDecor: Object.freeze({ url: "", enabled: false, opacity: .9, position: "top-right", size: "small", x: 0, y: 0, scale: 1, rotation: 0, radius: 0, borderWidth: 0, borderColor: "transparent", shadow: "none" }),
      assistantBubbleDecor: Object.freeze({ url: "", enabled: false, opacity: .9, position: "top-left", size: "small", x: 0, y: 0, scale: 1, rotation: 0, radius: 0, borderWidth: 0, borderColor: "transparent", shadow: "none" }),
      avatarFrame: Object.freeze({ url: "", enabled: false, opacity: 1, position: "center", size: "small", x: 0, y: 0, scale: 1, rotation: 0, radius: 50, borderWidth: 0, borderColor: "transparent", shadow: "none" }),
      inputDecor: Object.freeze({ url: "", enabled: false, opacity: .8, position: "right", size: "small", x: 0, y: 0, scale: 1, rotation: 0, radius: 0, borderWidth: 0, borderColor: "transparent", shadow: "none" }),
      homeCardDecor: Object.freeze({ url: "", enabled: false, opacity: .48, position: "corner", size: "medium", x: 0, y: 0, scale: 1, rotation: 0, radius: 0, borderWidth: 0, borderColor: "transparent", shadow: "none" }),
      navAccent: Object.freeze({ url: "", enabled: false, opacity: .32, position: "center", size: "small", x: 0, y: 0, scale: 1, rotation: 0, radius: 0, borderWidth: 0, borderColor: "transparent", shadow: "none" })
    }),
    layout: Object.freeze({ chatWidth: "auto", bubbleMaxWidth: "78%", messageGap: "14px", bottomNavHeight: "86px", glassIntensity: .62, backgroundDim: .12, bubbleOpacity: .96, navOpacity: .92, cardOpacity: .82, radiusNav: "24px", blurNav: "12px", blurBubble: "0px", effectsMode: "balanced", shadowLevel: "soft", backgroundBlur: "0px", enableGlass: true, enableAnimations: true, readabilityGuard: true }),
    customDesign: Object.freeze({ version:1, regions:Object.freeze({}) }), customCss: ""
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
  const boundedNumber = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const normalizeCustomDesign = input => {
    const regions = {};
    if (!input || typeof input !== "object" || Array.isArray(input)) return Object.freeze({ version:1, regions:Object.freeze(regions) });
    for (const key of Object.keys(DESIGN_REGIONS)) {
      const candidate=input.regions?.[key]; if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))continue;
      const region={ enabled:candidate.enabled===true };
      for(const field of DESIGN_COLOR_FIELDS)region[field]=safeColor(candidate[field],DESIGN_REGION_DEFAULT[field]);
      region.borderWidth=boundedNumber(candidate.borderWidth,0,0,12);region.radius=boundedNumber(candidate.radius,0,0,60);region.shadow=boundedNumber(candidate.shadow,0,0,.6);region.blur=boundedNumber(candidate.blur,0,0,30);region.opacity=boundedNumber(candidate.opacity,1,0,1);region.glassOpacity=boundedNumber(candidate.glassOpacity,1,0,1);
      const image=candidate.image&&typeof candidate.image==="object"&&!Array.isArray(candidate.image)?candidate.image:{};
      region.image=Object.freeze({ enabled:image.enabled===true,url:safeVisualAsset(image.url),opacity:boundedNumber(image.opacity,.25,0,1),size:["cover","contain"].includes(image.size)?image.size:"cover",position:["center","top","bottom","left","right"].includes(image.position)?image.position:"center",repeat:["repeat","no-repeat"].includes(image.repeat)?image.repeat:"no-repeat",blendMode:["normal","soft-light"].includes(image.blendMode)?image.blendMode:"normal",offsetX:boundedNumber(image.offsetX,0,-100,100),offsetY:boundedNumber(image.offsetY,0,-100,100),scale:boundedNumber(image.scale,1,.25,3),blur:boundedNumber(image.blur,0,0,20) });
      regions[key]=Object.freeze(region);
    }
    return Object.freeze({ version:1,regions:Object.freeze(regions) });
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
      const number = (value, fallbackValue, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallbackValue;
      slots[key] = Object.freeze({
        url: safeVisualAsset(candidate.url || legacy[key]),
        enabled: enabledByUser && candidate.enabled === true,
        opacity: number(candidate.opacity, fallback.opacity, 0, 1),
        position: ["center", "right", "left", "top-right", "top-left", "corner"].includes(candidate.position) ? candidate.position : fallback.position,
        size: ["cover", "contain", "small", "medium"].includes(candidate.size) ? candidate.size : fallback.size,
        x: number(candidate.x, fallback.x, -100, 100), y: number(candidate.y, fallback.y, -100, 100),
        scale: number(candidate.scale, fallback.scale, .25, 3), rotation: number(candidate.rotation, fallback.rotation, -180, 180),
        radius: number(candidate.radius, fallback.radius, 0, 50), borderWidth: number(candidate.borderWidth, fallback.borderWidth, 0, 12),
        borderColor: safeColor(candidate.borderColor, fallback.borderColor),
        shadow: safeCssValue(candidate.shadow, fallback.shadow, /^(?:none|(?:-?\d+(?:\.\d+)?px\s+){2,4}(?:rgba?\([^)]+\)|#[0-9a-f]{3,8}))$/iu)
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
    if (rgb) {
      const alphaRaw = rgb[4] === undefined ? 1 : Number(rgb[4]);
      return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Math.max(0, Math.min(1, alphaRaw > 1 ? alphaRaw / 100 : alphaRaw))];
    }
    const hsl = text.match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*([\d.]+)%?)?\s*\)$/u);
    if (!hsl) return null;
    const hue = ((Number(hsl[1]) % 360) + 360) % 360; const saturation = Number(hsl[2]) / 100; const lightness = Number(hsl[3]) / 100;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation; const section = hue / 60; const x = chroma * (1 - Math.abs(section % 2 - 1));
    const [r, g, b] = section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0] : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma] : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
    const offset = lightness - chroma / 2; const alphaRaw = hsl[4] === undefined ? 1 : Number(hsl[4]);
    return [(r + offset) * 255, (g + offset) * 255, (b + offset) * 255, Math.max(0, Math.min(1, alphaRaw > 1 ? alphaRaw / 100 : alphaRaw))];
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
  const rgbHue = ([red, green, blue]) => {
    const [r, g, b] = [red, green, blue].map(value => value / 255); const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
    if (!delta) return 0;
    const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return (sector * 60 + 360) % 360;
  };
  const colorSaturation = color => {
    const parsed = parseColor(color); if (!parsed) return 0;
    const max = Math.max(...parsed.slice(0, 3)); const min = Math.min(...parsed.slice(0, 3));
    return max ? (max - min) / max : 0;
  };
  const isPurpleColor = color => {
    const parsed = parseColor(color); if (!parsed || parsed[3] < .08 || colorSaturation(color) < .12) return false;
    const hue = rgbHue(parsed); return hue >= 260 && hue <= 285;
  };
  const sameColor = (left, right) => String(left || "").replace(/\s+/gu, "").toLowerCase() === String(right || "").replace(/\s+/gu, "").toLowerCase();
  const PRESET_IDS = new Set(["theme_default_purple_mist", "theme_milk_glass", "theme_midnight_blue", "theme_sakura", "theme_obsidian"]);
  const themeIsDefaultPurple = theme => theme?.id === DEFAULT_THEME.id;
  const themeAllowsPurpleAccent = theme => themeIsDefaultPurple(theme) || (PRESET_IDS.has(theme?.id) && isPurpleColor(theme?.tokens?.colorPrimary)) || (theme?.accentExplicit === true && isPurpleColor(theme?.tokens?.colorPrimary));
  const deriveThemeAccent = theme => {
    const imported = theme.accentMode === "theme-or-transparent" || ["echoes", "css", "imported", "json", "sillytavern", "external"].includes(theme.source);
    const allowsPurple = themeAllowsPurpleAccent(theme);
    const inheritedDefaults = new Set([DEFAULT_THEME.tokens.colorPrimary, DEFAULT_THEME.tokens.colorAccent].map(value => value.toLowerCase()));
    const candidates = [theme.tokens.colorPrimary, theme.tokens.colorAccent, theme.tokens.navActiveText, theme.tokens.borderColor,
      theme.tokens.colorText, theme.tokens.headerText, theme.tokens.cardText, theme.tokens.inputText, theme.tokens.navText, theme.tokens.colorMuted];
    for (const color of candidates) {
      const parsed = parseColor(color); if (!parsed || parsed[3] < .08 || colorSaturation(color) < .12) continue;
      if (imported && theme.accentExplicit !== true && inheritedDefaults.has(String(color).toLowerCase())) continue;
      if (!allowsPurple && isPurpleColor(color)) continue;
      return color;
    }
    return theme.tokens.colorText || "rgba(80,110,130,.72)";
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
    const source = ["preset", "echoes", "css", "imported", "json", "sillytavern", "external", "custom"].includes(input.source) ? input.source : PRESET_IDS.has(input.id) ? "preset" : "custom";
    const inheritedPurple = !PRESET_IDS.has(input.id) && sameColor(input.tokens?.colorPrimary, DEFAULT_THEME.tokens.colorPrimary) && sameColor(input.tokens?.colorAccent, DEFAULT_THEME.tokens.colorAccent);
    const accentMode = ["theme", "transparent", "theme-or-transparent"].includes(input.accentMode) ? input.accentMode : source === "preset" ? "theme" : inheritedPurple ? "theme-or-transparent" : "theme";
    const accentExplicit = input.accentExplicit === true || (source === "custom" && !sameColor(input.tokens?.colorPrimary, DEFAULT_THEME.tokens.colorPrimary));
    const visualAccent = deriveThemeAccent({ id: input.id, source, accentMode, accentExplicit, tokens });
    if (source !== "preset") {
      if (!input.tokens?.iconBlockBg || sameColor(input.tokens.iconBlockBg, DEFAULT_THEME.tokens.iconBlockBg)) tokens.iconBlockBg = accentMode === "theme" ? visualAccent : "rgba(80,110,130,.10)";
      if (!input.tokens?.progressBg || sameColor(input.tokens.progressBg, DEFAULT_THEME.tokens.progressBg)) tokens.progressBg = accentMode === "theme" ? tokens.cardBg : "rgba(80,110,130,.12)";
      if (!input.tokens?.progressFill || sameColor(input.tokens.progressFill, DEFAULT_THEME.tokens.progressFill)) tokens.progressFill = visualAccent;
      if (!input.tokens?.avatarRing || sameColor(input.tokens.avatarRing, DEFAULT_THEME.tokens.avatarRing)) tokens.avatarRing = visualAccent;
    }
    let normalized = {
      id: safeText(input.id, `theme_${Math.random().toString(36).slice(2, 10)}`, 80),
      name: safeText(input.name, "未命名主题", 80), version: THEME_VERSION, harmonyVersion: 2,
      author: safeText(input.author, "辞辞", 80),
      source, accentMode, accentExplicit,
      createdAt: /^\d{4}-\d{2}-\d{2}T/.test(input.createdAt || "") ? input.createdAt : stamp,
      updatedAt: stamp, tokens: Object.freeze(tokens), assets: Object.freeze(assets),
      assetLibrary: Object.freeze((Array.isArray(input.assetLibrary) ? input.assetLibrary : []).slice(0, 30).map((item, index) => Object.freeze({
        id: safeText(item?.id, `asset_${index + 1}`, 80), kind: safeText(item?.kind, "decorativeAsset", 40), url: safeVisualAsset(item?.url)
      })).filter(item => item.url)),
      visualSlots: normalizeVisualSlots(input.visualSlots, assets), customDesign: normalizeCustomDesign(input.customDesign),
      migratedVisualSlotsSafe: input.migratedVisualSlotsSafe === true || (Boolean(input.visualSlots) && input.visualSlots?.enabledByUser !== true),
      layout, customCss: safeCustomCss(input.customCss)
    };
    if (layout.readabilityGuard) normalized = guardReadability(normalized);
    return Object.freeze({ ...normalized, tokens: Object.freeze(normalized.tokens), assets: Object.freeze(assets), layout: Object.freeze(layout), customDesign:normalized.customDesign });
  }
  const designFallback = key => {
    if(key.endsWith(".page"))return {bg:"var(--xb-page-bg)",text:"var(--xb-page-text)",border:"transparent",accent:"var(--xb-accent)"};
    if(/userBubble/u.test(key))return {bg:"var(--xb-chat-user-bubble-bg)",text:"var(--xb-chat-user-bubble-text)",border:"var(--theme-user-bubble-border)",accent:"var(--xb-accent)"};
    if(/assistantBubble/u.test(key))return {bg:"var(--xb-chat-assistant-bubble-bg)",text:"var(--xb-chat-assistant-bubble-text)",border:"var(--theme-assistant-bubble-border)",accent:"var(--xb-accent)"};
    if(/bottomNav/u.test(key))return {bg:"var(--xb-bottom-nav-bg)",text:"var(--xb-nav-text)",border:"var(--xb-border-color)",accent:"var(--xb-nav-active-text)"};
    if(/(?:input|composer)/u.test(key))return {bg:"var(--xb-input-bg)",text:"var(--xb-input-text)",border:"var(--xb-input-border)",accent:"var(--xb-accent)"};
    if(/(?:button|progress|activeButton|iconBlock|avatar)/u.test(key))return {bg:"var(--xb-accent-icon-bg)",text:"var(--xb-accent-text)",border:"var(--xb-accent-border)",accent:"var(--xb-accent)"};
    return {bg:"var(--xb-card-bg)",text:"var(--xb-card-text)",border:"var(--xb-card-border)",accent:"var(--xb-accent)"};
  };
  const customDesignVariables = input => {
    const design=normalizeCustomDesign(input),variables={};
    for(const key of Object.keys(DESIGN_REGIONS)){const slug=key.replace(/\./gu,"-").replace(/[A-Z]/gu,match=>`-${match.toLowerCase()}`),prefix=`--xb-design-${slug}`,region=design.regions[key],enabled=region?.enabled===true,image=region?.image,fields=["bg","text","border","accent","border-width","radius","shadow","blur","glass-opacity","image","image-opacity","image-size","image-position","image-repeat","image-blend","image-x","image-y","image-scale","image-blur"];
      variables[`${prefix}-enabled`]=enabled?"1":"0";if(!enabled){for(const field of fields)variables[`${prefix}-${field}`]="";continue;}variables[`${prefix}-bg`]=region.backgroundColor;variables[`${prefix}-text`]=region.textColor;variables[`${prefix}-border`]=region.borderColor;variables[`${prefix}-accent`]=region.accentColor;variables[`${prefix}-border-width`]=`${region.borderWidth}px`;variables[`${prefix}-radius`]=`${region.radius}px`;variables[`${prefix}-shadow`]=region.shadow>0?`0 10px 28px rgba(25,30,38,${region.shadow})`:"none";variables[`${prefix}-blur`]=`${region.blur}px`;variables[`${prefix}-glass-opacity`]=String(region.glassOpacity);variables[`${prefix}-image`]=image?.enabled&&image.url?`url(${JSON.stringify(image.url)})`:"none";variables[`${prefix}-image-opacity`]=String(image?.opacity??0);variables[`${prefix}-image-size`]=image?.size||"cover";variables[`${prefix}-image-position`]=image?.position||"center";variables[`${prefix}-image-repeat`]=image?.repeat||"no-repeat";variables[`${prefix}-image-blend`]=image?.blendMode||"normal";variables[`${prefix}-image-x`]=`${image?.offsetX||0}px`;variables[`${prefix}-image-y`]=`${image?.offsetY||0}px`;variables[`${prefix}-image-scale`]=String(image?.scale||1);variables[`${prefix}-image-blur`]=`${image?.blur||0}px`;
    }return variables;
  };
  const cssVariables = input => {
    const theme = normalizeTheme(input); const mode = theme.layout.effectsMode;
    const accent = deriveThemeAccent(theme); const transparentAccent = theme.accentMode !== "theme" && !themeIsDefaultPurple(theme);
    const effectivePrimary = transparentAccent ? accent : theme.tokens.colorPrimary; const effectiveAccent = transparentAccent ? accent : theme.tokens.colorAccent;
    const maxBlur = mode === "pretty" ? 24 : mode === "balanced" ? 12 : 2;
    const clampBlur = value => `${Math.min(maxBlur, Math.max(0, parseFloat(value) || 0))}px`;
    const shadow = mode === "performance" || theme.layout.shadowLevel === "none" ? "none" : transparentAccent ? "0 8px 22px rgba(45,65,78,.10)" : theme.layout.shadowLevel === "medium" && mode === "pretty" ? theme.tokens.shadowSoft : "0 8px 22px rgba(63,44,78,.10)";
    const glass = theme.layout.enableGlass && mode !== "performance";
    const inheritedVisual = key => !themeIsDefaultPurple(theme) && sameColor(theme.tokens[key], DEFAULT_THEME.tokens[key]);
    const iconBlockBg = inheritedVisual("iconBlockBg") ? transparentAccent ? "rgba(80,110,130,.10)" : `color-mix(in srgb, ${accent} 14%, ${theme.tokens.cardBg})` : theme.tokens.iconBlockBg;
    const progressBg = inheritedVisual("progressBg") ? `color-mix(in srgb, ${theme.tokens.cardMutedText} 18%, ${theme.tokens.cardBg})` : theme.tokens.progressBg;
    const progressFill = inheritedVisual("progressFill") ? accent : theme.tokens.progressFill;
    const avatarRing = inheritedVisual("avatarRing") ? `color-mix(in srgb, ${accent} 58%, transparent)` : theme.tokens.avatarRing;
    return ({
    "--theme-primary": effectivePrimary, "--theme-accent": effectiveAccent,
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
    ,"--theme-color-primary": effectivePrimary, "--theme-color-primary-strong": effectivePrimary
    ,"--theme-color-primary-bright": effectiveAccent
    ,"--theme-color-surface": theme.tokens.cardBg, "--theme-color-surface-soft": `color-mix(in srgb, ${theme.tokens.cardBg} 76%, ${theme.tokens.colorBg})`
    ,"--theme-color-border": theme.tokens.borderColor, "--theme-color-focus": `color-mix(in srgb, ${effectivePrimary} 38%, transparent)`
    ,"--theme-shadow": shadow, "--theme-background-overlay": "transparent"
    ,"--theme-background": `linear-gradient(180deg, ${theme.tokens.colorBg}, color-mix(in srgb, ${theme.tokens.colorBg} 92%, ${effectivePrimary}))`
    ,"--avatar-border-color": effectivePrimary, "--avatar-ring-color": `color-mix(in srgb, ${effectivePrimary} 24%, transparent)`
    ,"--avatar-surface": `linear-gradient(145deg, ${effectiveAccent}, ${effectivePrimary})`
    ,"--theme-bubble-texture": theme.assets.bubbleTexture ? `url(${JSON.stringify(theme.assets.bubbleTexture)})` : "none"
    ,"--theme-nav-texture": theme.assets.bottomNavTexture ? `url(${JSON.stringify(theme.assets.bottomNavTexture)})` : "none"
    ,"--theme-input-decoration": theme.assets.inputDecoration ? `url(${JSON.stringify(theme.assets.inputDecoration)})` : "none"
    ,"--theme-header-decoration": theme.assets.headerDecoration ? `url(${JSON.stringify(theme.assets.headerDecoration)})` : "none"
    ,"--theme-avatar-frame": theme.assets.avatarFrame ? `url(${JSON.stringify(theme.assets.avatarFrame)})` : "none"
    ,"--xb-color-bg": theme.tokens.colorBg, "--xb-color-text": theme.tokens.colorText
    ,"--xb-color-surface": theme.tokens.cardBg, "--xb-color-surface-soft": `color-mix(in srgb, ${theme.tokens.cardBg} 76%, ${theme.tokens.colorBg})`
    ,"--xb-color-text-muted": theme.tokens.colorMuted, "--xb-color-accent": accent, "--xb-color-accent-soft": transparentAccent ? "rgba(80,110,130,.10)" : `color-mix(in srgb, ${accent} 15%, ${theme.tokens.cardBg})`
    ,"--xb-accent": accent, "--xb-accent-soft": transparentAccent ? "rgba(255,255,255,.18)" : `color-mix(in srgb, ${accent} 13%, ${theme.tokens.cardBg})`
    ,"--xb-accent-soft-2": transparentAccent ? "rgba(80,110,130,.10)" : `color-mix(in srgb, ${accent} 22%, ${theme.tokens.cardBg})`, "--xb-accent-strong": `color-mix(in srgb, ${accent} 86%, ${theme.tokens.colorText})`
    ,"--xb-accent-border": `color-mix(in srgb, ${accent} 28%, ${theme.tokens.borderColor})`, "--xb-accent-text": accent
    ,"--xb-accent-icon-bg": iconBlockBg, "--xb-accent-card-bg": transparentAccent ? "rgba(255,255,255,.35)" : `color-mix(in srgb, ${accent} 19%, ${theme.tokens.cardBg})`
    ,"--xb-accent-card-text": readableText(`rgba(255,255,255,.78)`, theme.tokens.cardText, theme.tokens.colorBg), "--xb-fab-bg": transparentAccent ? "rgba(255,255,255,.35)" : `color-mix(in srgb, ${accent} 20%, ${theme.tokens.bottomNavBg})`, "--xb-fab-text": accent
    ,"--xb-page-bg": theme.tokens.colorBg, "--xb-page-text": theme.tokens.colorText
    ,"--xb-header-bg": theme.tokens.headerBg, "--xb-header-text": theme.tokens.headerText
    ,"--xb-card-bg": theme.tokens.cardBg, "--xb-card-text": theme.tokens.cardText, "--xb-card-muted": theme.tokens.cardMutedText
    ,"--xb-card-border": theme.tokens.borderColor, "--xb-card-shadow": shadow
    ,"--xb-composer-bg": theme.tokens.composerBg, "--xb-input-bg": theme.tokens.inputBg, "--xb-input-text": theme.tokens.inputText, "--xb-input-border": theme.tokens.borderColor
    ,"--xb-button-bg": effectivePrimary, "--xb-button-text": readableText(effectivePrimary, "#ffffff", theme.tokens.colorBg), "--xb-button-border": theme.tokens.borderColor
    ,"--xb-bottom-nav-bg": theme.tokens.bottomNavBg, "--xb-nav-text": theme.tokens.navText, "--xb-nav-active-text": accent, "--xb-nav-active-icon": accent
    ,"--xb-nav-active-bg": transparentAccent ? "rgba(255,255,255,.18)" : `color-mix(in srgb, ${accent} 14%, ${theme.tokens.bottomNavBg})`
    ,"--xb-status-bg": transparentAccent ? "rgba(80,110,130,.10)" : `color-mix(in srgb, ${effectiveAccent} 14%, ${theme.tokens.cardBg})`, "--xb-status-text": theme.tokens.cardText
    ,"--xb-badge-bg": transparentAccent ? "rgba(255,255,255,.18)" : `color-mix(in srgb, ${effectivePrimary} 13%, ${theme.tokens.cardBg})`, "--xb-badge-text": theme.tokens.cardText
    ,"--xb-avatar-ring": avatarRing, "--xb-progress-bg": progressBg, "--xb-progress-fill": progressFill
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
    ,...Object.fromEntries(VISUAL_SLOT_FIELDS.flatMap(key => { const slot=theme.visualSlots[key]; const prefix=`--xb-slot-${key.replace(/[A-Z]/gu, match=>`-${match.toLowerCase()}`)}`; return [[`${prefix}-opacity`,String(slot.opacity)],[`${prefix}-x`,`${slot.x}px`],[`${prefix}-y`,`${slot.y}px`],[`${prefix}-scale`,String(slot.scale)],[`${prefix}-rotation`,`${slot.rotation}deg`],[`${prefix}-radius`,`${slot.radius}%`],[`${prefix}-border-width`,`${slot.borderWidth}px`],[`${prefix}-border-color`,slot.borderColor],[`${prefix}-shadow`,slot.shadow]]; }))
    ,...customDesignVariables(theme.customDesign)
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
      rootNode.dataset.xbDesignRegions = Object.entries(theme.customDesign.regions).filter(([,region])=>region.enabled).map(([key])=>key.replace(/\./gu,"-").replace(/[A-Z]/gu,match=>`-${match.toLowerCase()}`)).join(" ");
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
    normalizeTheme, normalizeVisualSlots, normalizeCustomDesign, customDesignVariables, safeAsset, safeVisualAsset, safeCustomCss, cssVariables, parseColor, contrastRatio, readableText, guardReadability, needsHarmonyBackground,
    isPurpleColor, themeIsDefaultPurple, themeAllowsPurpleAccent, deriveThemeAccent, DESIGN_REGIONS, DESIGN_PAGES, DESIGN_REGION_DEFAULT, DESIGN_IMAGE_DEFAULT, THEME_VERSION };
});
