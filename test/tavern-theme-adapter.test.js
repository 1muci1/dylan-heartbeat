"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const themeApi = require("../frontend-p4b/assets/js/theme-store.js");
const adapter = require("../frontend-p4b/assets/js/tavern-theme-adapter.js");

const tavern = overrides => ({
  name: "蝶_雨露倾珠_PC端", main_text_color: "rgba(52,43,69,1)",
  blur_tint_color: "rgba(255,255,255,.82)", chat_tint_color: "rgba(238,233,243,1)",
  user_mes_blur_tint_color: "rgba(112,82,137,.94)", bot_mes_blur_tint_color: "rgba(255,255,255,.9)",
  border_color: "rgba(91,67,112,.14)", font_scale: 1.04, chat_width: 500,
  blur_strength: 50, fast_ui_mode: false, custom_css: "", ...overrides
});

test("detectThemeFormat identifies native, SillyTavern, external and unknown JSON", () => {
  assert.equal(adapter.detectThemeFormat({ type: "xinban-theme", themeVersion: 1, theme: {} }), "xinban");
  assert.equal(adapter.detectThemeFormat(tavern()), "sillytavern");
  assert.equal(adapter.detectThemeFormat({ palette: { mainTextColor: "#333333" } }), "external");
  assert.equal(adapter.detectThemeFormat({ hello: "world" }), "unknown");
});

test("SillyTavern fields map into a bounded, readable xinban theme and report", () => {
  const result = adapter.convertSillyTavernTheme(tavern());
  assert.equal(result.ok, true); assert.equal(result.theme.name, "蝶_雨露倾珠_PC端");
  assert.equal(result.theme.tokens.colorText, "rgba(52,43,69,1)");
  assert.equal(result.theme.tokens.cardBg, "rgba(255,255,255,.82)");
  assert.equal(result.theme.tokens.fontSizeBase, "15.6px");
  assert.equal(result.theme.layout.bubbleMaxWidth, "95%");
  assert.equal(result.theme.layout.blurNav, "24px");
  assert.equal(result.theme.layout.effectsMode, "balanced");
  assert.ok(themeApi.contrastRatio(result.theme.tokens.chatAssistantBubbleText, result.theme.tokens.chatAssistantBubbleBg, result.theme.tokens.colorBg) >= 4.5);
  assert.ok(result.report.counts.recognized >= 7);
});

test("fast_ui_mode selects performance and dangerous Tavern CSS is never emitted", () => {
  const css = `@import url(https://evil.test/a.css);<script>alert(1)</script><img onerror=x>
    body{position:fixed;width:100vw;height:100vh;pointer-events:none;background-image:url(https://img.test/a.png)}
    .bubble{color:#332244;border-radius:20px}`;
  const result = adapter.convertSillyTavernTheme(tavern({ fast_ui_mode: true, custom_css: css }));
  assert.equal(result.theme.layout.effectsMode, "performance");
  assert.doesNotMatch(result.theme.customCss, /@import|https?:|script|onerror|position\s*:\s*fixed/iu);
  assert.match(result.theme.customCss, /color:#332244/);
  assert.ok(result.report.counts.blocked >= 3);
  assert.ok(result.report.counts.externalImages >= 1);
  assert.ok(result.report.counts.ignored >= 1);
});

test("CSS adapter accepts only scoped safe declarations and caps input/output", () => {
  const result = adapter.sanitizeExternalCustomCss(`.x{font-family:"Songti SC";background-color:rgba(255,255,255,.7);box-shadow:0px 8px 16px rgba(0,0,0,.2)}${" ".repeat(210 * 1024)}`);
  assert.match(result.css, /^\.app-shell\{/u); assert.ok(result.css.length <= 8000);
  assert.ok(result.report.counts.ignored >= 2);
});

test("external recursive scan is bounded to five levels and two hundred fields", () => {
  const wide = {}; for (let index = 0; index < 300; index += 1) wide[`color_${index}`] = "#ffffff";
  wide.nested = { a: { b: { c: { d: { e: { mainTextColor: "#222222" } } } } } };
  const result = adapter.convertExternalTheme(wide, "external.json");
  assert.ok(result.report.counts.scannedFields <= adapter.MAX_FIELDS);
  assert.equal(adapter.MAX_DEPTH, 5);
});

test("JSON import size is capped and workshop stages conversion before library import", () => {
  assert.throws(() => adapter.assertImportSize(1024 * 1024 + 1), error => error.code === "THEME_FILE_TOO_LARGE");
  const script = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b/assets/js/theme-workshop.js"), "utf8");
  assert.ok(script.indexOf("pendingImport = converted") < script.indexOf("data-theme-import-confirm"));
  assert.match(script, /store\.importTheme\(\{ type: "xinban-theme"/u);
  assert.match(script, /adapter\.assertImportSize\(file\.size\)/u);
});
