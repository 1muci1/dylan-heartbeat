"use strict";

((root, factory) => {
  const themeApi = typeof module === "object" && module.exports ? require("./theme-store.js") : root?.XinbanThemes;
  const api = factory(themeApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XinbanTavernThemes = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, themeApi => {
  const MAX_JSON_BYTES = 1024 * 1024;
  const MAX_CSS_INPUT = 200 * 1024;
  const MAX_CSS_OUTPUT = 8000;
  const MAX_DEPTH = 5;
  const MAX_FIELDS = 200;
  const TAVERN_KEYS = new Set(["main_text_color", "blur_tint_color", "chat_tint_color", "user_mes_blur_tint_color", "bot_mes_blur_tint_color", "blur_strength", "font_scale", "chat_width", "fast_ui_mode", "custom_css"]);
  const BLOCKED_PATTERNS = Object.freeze([
    [/<\/?script\b/giu, "script"], [/javascript\s*:/giu, "javascript"], [/\bon(?:load|error|click|mouseover)\s*=/giu, "event-handler"],
    [/@import\b/giu, "@import"], [/expression\s*\(/giu, "expression"], [/<\/?(?:iframe|object|embed)\b/giu, "embedded-content"],
    [/\b(?:localStorage|sessionStorage|document\.cookie|Authorization|API\s*Key|Bearer|fetch\s*\(|XMLHttpRequest)\b/giu, "runtime-access"],
    [/position\s*:\s*fixed[^}]{0,500}(?:100vw|100vh|width\s*:\s*100%|height\s*:\s*100%)/giu, "fixed-fullscreen"],
    [/(?:\*|html|body|:root)\s*\{[^}]{0,2000}pointer-events\s*:\s*none/giu, "global-pointer-events"]
  ]);
  const EXTERNAL_URL = /url\s*\(\s*["']?https?:\/\/[^)]*\)/giu;
  const SAFE_DECLARATIONS = new Set(["color", "background-color", "font-family", "border-radius", "box-shadow", "background-image"]);
  class AdapterError extends Error { constructor(message, code) { super(message); this.name = "AdapterError"; this.code = code; } }
  const countMatches = (text, pattern) => [...text.matchAll(new RegExp(pattern.source, pattern.flags))].length;
  const safeNumber = (value, fallback, min, max) => { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; };
  const safeColor = value => {
    const text = typeof value === "string" ? value.trim() : "";
    return themeApi?.parseColor?.(text) ? text : null;
  };
  const harmonizeGlassTint = (value, fallback = "rgba(255,255,255,.66)") => {
    const parsed = themeApi?.parseColor?.(value); if (!parsed) return fallback;
    const [red, green, blue] = parsed; const brightness = red * .299 + green * .587 + blue * .114;
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    const muddyWarm = brightness > 80 && brightness < 215 && red > blue + 24 && spread > 38;
    if (muddyWarm) return fallback;
    const alpha = Math.max(.58, Math.min(.72, parsed[3]));
    return `rgba(${Math.round(red)},${Math.round(green)},${Math.round(blue)},${alpha.toFixed(2)})`;
  };
  const safeName = (value, fallback = "导入的外部主题") => typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
  const createReport = format => ({ format, recognized: [], ignored: [], blocked: [], counts: { recognized: 0, ignored: 0, blocked: 0, externalImages: 0, scannedFields: 0 } });
  const note = (report, bucket, detail) => { report[bucket].push(detail); report.counts[bucket] += 1; };

  function detectThemeFormat(json) {
    if (!json || typeof json !== "object" || Array.isArray(json)) return "unknown";
    if (json.type === "xinban-theme" && Number(json.themeVersion) === 1 && json.theme) return "xinban";
    const keys = Object.keys(json);
    if (keys.filter(key => TAVERN_KEYS.has(key)).length >= 2 || ("main_text_color" in json && "custom_css" in json)) return "sillytavern";
    const stack = [{ value: json, depth: 0 }]; let scanned = 0;
    while (stack.length && scanned < MAX_FIELDS) {
      const { value, depth } = stack.pop();
      for (const [key, child] of Object.entries(value)) {
        scanned += 1;
        if (/(?:theme|color|tint|blur|font|shadow|width|css|background)/iu.test(key)) return "external";
        if (child && typeof child === "object" && !Array.isArray(child) && depth < MAX_DEPTH) stack.push({ value: child, depth: depth + 1 });
        if (scanned >= MAX_FIELDS) break;
      }
    }
    return "unknown";
  }

  function sanitizeExternalCustomCss(input) {
    const report = createReport("css");
    let css = typeof input === "string" ? input : "";
    if (css.length > MAX_CSS_INPUT) { css = css.slice(0, MAX_CSS_INPUT); note(report, "ignored", "custom_css 超过 200KB，已截断读取"); }
    for (const [pattern, label] of BLOCKED_PATTERNS) {
      const count = countMatches(css, pattern);
      if (count) { report.counts.blocked += count; report.blocked.push(`${label} ×${count}`); css = css.replace(pattern, ""); }
    }
    const externalCount = countMatches(css, EXTERNAL_URL);
    if (externalCount) { report.counts.externalImages += externalCount; report.counts.ignored += externalCount; report.ignored.push(`外部图片已忽略 ×${externalCount}，可手动上传背景/装饰图`); css = css.replace(EXTERNAL_URL, "none"); }
    const declarations = [];
    for (const rule of css.matchAll(/([.#:\w][^{}]{0,500})\{([^{}]{0,8000})\}/gu)) {
      report.counts.ignored += 1; report.ignored.push(`酒馆选择器未应用：${rule[1].trim().slice(0, 80)}`);
      for (const declaration of rule[2].split(";")) {
        const separator = declaration.indexOf(":"); if (separator < 1) continue;
        const property = declaration.slice(0, separator).trim().toLowerCase(); const value = declaration.slice(separator + 1).trim();
        if (!SAFE_DECLARATIONS.has(property) || !value || /[{}<>]|!important/iu.test(value)) continue;
        if (property === "background-image" && !/^url\(\s*["']?(?:\.?\.?\/|\/|data:image\/)/iu.test(value)) continue;
        if (property === "font-family" && !/^[\p{L}\p{N}\s,'"._-]{1,80}$/u.test(value)) continue;
        if (["color", "background-color"].includes(property) && !safeColor(value)) continue;
        if (property === "border-radius" && !/^\d+(?:\.\d+)?(?:px|rem|%)$/u.test(value)) continue;
        if (property === "box-shadow" && !/^(?:none|(?:-?\d+(?:\.\d+)?px\s+){2,4}(?:rgba?\([^)]+\)|#[0-9a-f]{3,8}))$/iu.test(value)) continue;
        declarations.push(`${property}:${value}`); note(report, "recognized", `CSS ${property}`);
      }
    }
    let output = declarations.length ? `.app-shell{${[...new Set(declarations)].join(";")}}` : "";
    if (output.length > MAX_CSS_OUTPUT) { output = output.slice(0, MAX_CSS_OUTPUT); note(report, "ignored", "安全 CSS 超过 8000 字，已截断"); }
    return { css: output, report };
  }

  function buildTheme(values, format, filename = "") {
    const report = createReport(format); const base = JSON.parse(JSON.stringify(themeApi.DEFAULT_THEME));
    base.id = `theme_external_${Math.random().toString(36).slice(2, 10)}`;
    base.name = safeName(values.name || values.title || values.themeName, filename.replace(/\.json$/iu, "") || "导入的外部主题");
    const mapColor = (source, targets) => { const color = safeColor(values[source]); if (!color) return; for (const target of targets) base.tokens[target] = color; note(report, "recognized", `${source} → ${targets.join(", ")}`); };
    mapColor("main_text_color", ["colorText", "chatAssistantBubbleText", "cardText", "inputText", "previewText"]);
    mapColor("italics_text_color", ["colorMuted"]);
    if (safeColor(values.blur_tint_color)) { const tint = harmonizeGlassTint(values.blur_tint_color); base.tokens.cardBg = tint; base.tokens.chatAssistantBubbleBg = tint; note(report, "recognized", "blur_tint_color → glass tint"); }
    if (safeColor(values.chat_tint_color)) note(report, "ignored", themeApi.parseColor(values.chat_tint_color)[3] === 0 ? "chat_tint_color 完全透明，已忽略" : "chat_tint_color 不作为整页背景，已保留柔和紫雾底色");
    mapColor("user_mes_blur_tint_color", ["chatUserBubbleBg"]);
    if (safeColor(values.bot_mes_blur_tint_color)) { base.tokens.chatAssistantBubbleBg = harmonizeGlassTint(values.bot_mes_blur_tint_color, base.tokens.chatAssistantBubbleBg); note(report, "recognized", "bot_mes_blur_tint_color → assistant glass tint"); }
    mapColor("border_color", ["borderColor"]);
    if (values.font_scale !== undefined) { base.tokens.fontSizeBase = `${Math.round(safeNumber(values.font_scale, 1, .8, 1.5) * 15 * 10) / 10}px`; note(report, "recognized", "font_scale → fontSizeBase"); }
    if (values.chat_width !== undefined) { base.layout.bubbleMaxWidth = `${safeNumber(values.chat_width, 78, 50, 95)}%`; note(report, "recognized", "chat_width → bubbleMaxWidth"); }
    if (values.blur_strength !== undefined) { const blur = safeNumber(values.blur_strength, 0, 0, 24); base.layout.blurNav = `${blur}px`; base.layout.backgroundBlur = `${blur}px`; note(report, "recognized", "blur_strength → blur effects"); }
    const shadowWidth = safeNumber(values.shadow_width, 0, 0, 24); const shadowColor = safeColor(values.shadow_color);
    if (shadowColor && shadowWidth > 0) { base.tokens.shadowSoft = `0px ${Math.round(shadowWidth)}px ${Math.round(shadowWidth * 2)}px ${shadowColor}`; base.layout.shadowLevel = "medium"; note(report, "recognized", "shadow_color/shadow_width → shadowSoft"); }
    base.layout.effectsMode = values.fast_ui_mode === true || values.noShadows === true ? "performance" : "balanced";
    if (values.fast_ui_mode !== undefined || values.noShadows !== undefined) note(report, "recognized", "fast_ui_mode/noShadows → effectsMode");
    const sanitized = sanitizeExternalCustomCss(values.custom_css || values.customCss || ""); base.customCss = sanitized.css;
    for (const bucket of ["recognized", "ignored", "blocked"]) { report[bucket].push(...sanitized.report[bucket]); report.counts[bucket] += sanitized.report.counts[bucket]; }
    report.counts.externalImages += sanitized.report.counts.externalImages;
    report.assets = scanCssAssets(values.custom_css || values.customCss || "");
    return { ok: true, theme: themeApi.normalizeTheme(base), report };
  }

  function convertSillyTavernTheme(json, options = {}) {
    if (detectThemeFormat(json) !== "sillytavern") throw new AdapterError("未检测到酒馆主题字段", "TAVERN_THEME_NOT_DETECTED");
    return buildTheme(json, "sillytavern", options.filename);
  }
  function scanExternal(json) {
    const output = {}; let fields = 0;
    const visit = (value, depth) => {
      if (!value || typeof value !== "object" || depth > MAX_DEPTH || fields >= MAX_FIELDS) return;
      for (const [key, child] of Object.entries(value)) {
        if (fields >= MAX_FIELDS) break;
        fields += 1;
        if (child && typeof child === "object") visit(child, depth + 1);
        else if (!(key in output)) output[key] = child;
      }
    };
    visit(json, 0);
    const aliases = { mainTextColor: "main_text_color", blurTintColor: "blur_tint_color", chatTintColor: "chat_tint_color", userMessageColor: "user_mes_blur_tint_color", botMessageColor: "bot_mes_blur_tint_color", fontScale: "font_scale", chatWidth: "chat_width", customCss: "custom_css" };
    for (const [source, target] of Object.entries(aliases)) if (source in output && !(target in output)) output[target] = output[source];
    return { values: output, fields };
  }
  function convertExternalTheme(json, filename = "") {
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new AdapterError("外部主题必须是 JSON 对象", "EXTERNAL_THEME_INVALID");
    const scanned = scanExternal(json); const result = buildTheme(scanned.values, "external", filename); result.report.counts.scannedFields = scanned.fields;
    if (!result.report.counts.recognized) note(result.report, "ignored", "没有识别到可转换的常见主题字段");
    return result;
  }
  const extractCssFromText = input => {
    const text = String(input || "").replace(/\0/gu, "").slice(0, MAX_CSS_INPUT);
    const fenced = [...text.matchAll(/```(?:css)?\s*([\s\S]*?)```/giu)].map(match => match[1]);
    return (fenced.length ? fenced.join("\n") : text).trim();
  };
  const classifyAssetKind = selector => {
    const value = String(selector || "").toLowerCase();
    if (/(?:bubble-user|bubble-other|\bmsg\b|\bmes\b)/u.test(value)) return "bubbleDecoration";
    if (/avatar/u.test(value)) return "avatarFrame";
    if (/(?:input|composer|send)/u.test(value)) return "inputDecoration";
    if (/(?:header|top-bar)/u.test(value)) return "headerDecoration";
    if (/(?:dock|nav|bottom)/u.test(value)) return "navIcon";
    if (/(?:app|page|shell|background)/u.test(value)) return "backgroundImage";
    return "decorativeAsset";
  };
  function scanCssAssets(input) {
    const css = extractCssFromText(input), assets = []; let index = 0;
    for (const rule of css.matchAll(/([.#:\w][^{}]{0,500})\{([^{}]{0,8000})\}/gu)) {
      const selector = rule[1].trim();
      for (const declaration of rule[2].matchAll(/(?:^|;)\s*(background(?:-image)?)\s*:\s*([^;]+)/giu)) {
        for (const urlMatch of declaration[2].matchAll(/url\s*\(\s*["']?([^)'"\s]+)["']?\s*\)/giu)) {
          if (!/^https?:\/\//iu.test(urlMatch[1])) continue;
          assets.push({ id: `asset_${++index}`, sourceUrl: urlMatch[1], kind: classifyAssetKind(selector), selector: selector.slice(0, 160), property: declaration[1].toLowerCase(), status: "detected", willLocalize: false });
        }
      }
    }
    return assets.slice(0, 30);
  }
  const detectStyleTextFormat = input => {
    const css = extractCssFromText(input);
    return /\.echoes-(?:app-shell|chat-header|bubble-user|bubble-other|input-area)\b/iu.test(css) ? "echoes-css" : /[.#:\w][^{}]{0,500}\{[^{}]+\}/u.test(css) ? "css" : "unknown";
  };
  function convertStyleText(input, filename = "") {
    const css = extractCssFromText(input); const format = detectStyleTextFormat(css); if (format === "unknown") throw new AdapterError("文件中没有识别到 CSS", "THEME_CSS_NOT_FOUND");
    const base = JSON.parse(JSON.stringify(themeApi.DEFAULT_THEME)); base.id = `theme_style_${Math.random().toString(36).slice(2,10)}`; base.name = safeName(filename.replace(/\.(?:docx|txt|css)$/iu, ""), format === "echoes-css" ? "Echoes 美化" : "CSS 美化");
    const report = createReport(format); report.assets = scanCssAssets(css); report.counts.externalImages = report.assets.length; if (report.assets.length) note(report, "ignored", `检测到外部装饰图片 ${report.assets.length} 张，等待用户确认本地化`);
    for (const rule of css.matchAll(/([.#:\w][^{}]{0,500})\{([^{}]{0,8000})\}/gu)) {
      const selector = rule[1].toLowerCase();
      for (const raw of rule[2].split(";")) {
        const separator = raw.indexOf(":"); if (separator < 1) continue; const property = raw.slice(0,separator).trim().toLowerCase(); const value = raw.slice(separator+1).trim();
        if (["color","background-color","border-color"].includes(property) && safeColor(value)) {
          if (/(?:bubble-user|user)/u.test(selector)) property === "color" ? base.tokens.chatUserBubbleText=value : base.tokens.chatUserBubbleBg=harmonizeGlassTint(value,base.tokens.chatUserBubbleBg);
          else if (/(?:bubble-other|assistant|bot)/u.test(selector)) property === "color" ? base.tokens.chatAssistantBubbleText=value : base.tokens.chatAssistantBubbleBg=harmonizeGlassTint(value,base.tokens.chatAssistantBubbleBg);
          else if (/(?:input|composer)/u.test(selector) && property === "color") base.tokens.inputText=value;
          else if (property === "color") { base.tokens.cardText=value; base.tokens.colorText=value; }
          else if (property === "border-color") base.tokens.borderColor=value;
          else base.tokens.cardBg=harmonizeGlassTint(value);
          note(report,"recognized",`${selector.slice(0,60)} ${property}`);
        }
        if (property === "border-radius" && /^\d+(?:\.\d+)?(?:px|rem|%)$/u.test(value)) { if (/bubble/u.test(selector)) base.tokens.radiusBubble=value; else base.tokens.radiusCard=value; note(report,"recognized",`${selector.slice(0,60)} border-radius`); }
      }
    }
    const sanitized=sanitizeExternalCustomCss(css); base.customCss=sanitized.css; for(const bucket of ["recognized","ignored","blocked"]){report[bucket].push(...sanitized.report[bucket]);report.counts[bucket]+=sanitized.report.counts[bucket];} report.counts.externalImages=Math.max(report.counts.externalImages,sanitized.report.counts.externalImages);
    return {ok:true,theme:themeApi.normalizeTheme(base),report};
  }
  const assertImportSize = size => { if (Number(size) > MAX_JSON_BYTES) throw new AdapterError("主题 JSON 不能超过 1MB", "THEME_FILE_TOO_LARGE"); return true; };
  return { detectThemeFormat, convertSillyTavernTheme, convertExternalTheme, convertStyleText, detectStyleTextFormat, extractCssFromText, scanCssAssets, classifyAssetKind, sanitizeExternalCustomCss, harmonizeGlassTint, assertImportSize, MAX_JSON_BYTES, MAX_DEPTH, MAX_FIELDS, AdapterError };
});
