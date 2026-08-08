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
  assert.equal(result.theme.tokens.cardBg, "rgba(255,255,255,0.72)");
  assert.equal(result.theme.tokens.fontSizeBase, "15.6px");
  assert.equal(result.theme.layout.bubbleMaxWidth, "95%");
  assert.equal(result.theme.layout.blurNav, "24px");
  assert.equal(result.theme.layout.effectsMode, "balanced");
  assert.ok(themeApi.contrastRatio(result.theme.tokens.chatAssistantBubbleText, result.theme.tokens.chatAssistantBubbleBg, result.theme.tokens.colorBg) >= 4.5);
  assert.ok(result.report.counts.recognized >= 7);
});

test("Tavern page tint never replaces the global background and transparent tint is ignored", () => {
  const transparent = adapter.convertSillyTavernTheme(tavern({ chat_tint_color: "rgba(200,180,90,0)" }));
  assert.equal(transparent.theme.tokens.colorBg, themeApi.DEFAULT_THEME.tokens.colorBg);
  assert.ok(transparent.report.ignored.some(item => item.includes("完全透明")));
  const muddy = adapter.convertSillyTavernTheme(tavern({ blur_tint_color: "rgba(190,165,80,.9)" }));
  assert.equal(muddy.theme.tokens.cardBg, "rgba(255,255,255,.66)");
  assert.notEqual(muddy.theme.tokens.colorBg, "rgba(190,165,80,.9)");
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

test("Echoes CSS is detected, converted and external decorations are classified", () => {
  const css = `.echoes-app-shell{background-image:url(https://img.test/bg.png);color:#332244}
    .echoes-bubble-other::before{background:url("https://img.test/bot.webp");border-radius:22px}
    .echoes-input-area{background-image:url(https://img.test/input.png)}`;
  assert.equal(adapter.detectStyleTextFormat(css), "echoes-css");
  const result = adapter.convertStyleText(css, "echoes.docx");
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.assets.map(item => item.kind), ["backgroundImage", "bubbleAssistantDecoration", "inputDecoration"]);
  assert.doesNotMatch(JSON.stringify(result.theme), /https:\/\/img\.test/u);
});

test("style text extraction accepts fenced CSS and Tavern JSON reports localizable assets", () => {
  assert.match(adapter.extractCssFromText("说明\n```css\n.x{color:#123456}\n```"), /^\.x/u);
  const result = adapter.convertSillyTavernTheme(tavern({ custom_css: ".avatar{background-image:url(https://img.test/frame.png)}" }));
  assert.equal(result.report.assets[0].kind, "avatarFrame");
  assert.doesNotMatch(JSON.stringify(result.theme), /https:\/\//u);
});

test("Echoes TXT normalization handles BOM, NBSP, full-width spaces and copy marker", () => {
  const text = `\uFEFF使用说明\r\n以下内容复制：\r\n.echoes-app-shell\u00a0{\u3000background-color:#182038; color:#f5f7ff; }`;
  assert.equal(adapter.detectStyleTextFormat(text), "echoes-css");
  const info=adapter.inspectStyleText(text); assert.equal(info.echoes,true); assert.equal(info.hasBraces,true); assert.equal(info.hasProperty,true);
  const result=adapter.convertStyleText(text,"theme.txt"); assert.equal(result.theme.tokens.colorBg,"#182038"); assert.equal(result.theme.tokens.colorText,"#f5f7ff");
});

test("TXT is accepted by extension regardless of text/plain, empty or octet-stream MIME", () => {
  assert.equal(adapter.detectImportFileKind("echoes.txt","text/plain"),"txt");
  assert.equal(adapter.detectImportFileKind("echoes.txt",""),"txt");
  assert.equal(adapter.detectImportFileKind("echoes.txt","application/octet-stream"),"txt");
});

test("Echoes modules map to distinct chat tokens and produce a meaningful report", () => {
  const css=`
    .echoes-app-shell,.echoes-chat-page{background:#10182d;color:#eef2ff}
    .echoes-chat-header{background:#24345c;color:#ffffff;border-bottom:1px solid #7180aa}
    .echoes-character-card{background:#202b49;color:#f4f5ff;border:1px solid #66749a;border-radius:20px;box-shadow:0px 8px 16px rgba(0,0,0,.2)}
    .echoes-input-area,.echoes-chat-input,textarea{background:#17223d;color:#f8f9ff;border:1px solid #65749b;border-radius:18px}
    .echoes-bubble-user{background:#6f55a7;color:#ffffff;border:1px solid #b7a3ec;border-radius:25px}
    .echoes-bubble-other{background:#f6f3ff;color:#312d45;border:1px solid #d4cbea;border-radius:25px}`;
  const result=adapter.convertStyleText(css,"echoes.txt"), tokens=result.theme.tokens;
  assert.equal(tokens.chatUserBubbleBg,"#6f55a7"); assert.equal(tokens.chatUserBubbleText,"#ffffff");
  assert.equal(tokens.chatAssistantBubbleBg,"#f6f3ff"); assert.equal(tokens.chatAssistantBubbleText,"#312d45");
  assert.equal(tokens.headerBg,"#24345c"); assert.equal(tokens.headerText,"#ffffff");
  assert.equal(tokens.inputBg,"#17223d"); assert.equal(tokens.composerBg,"#17223d"); assert.equal(tokens.bottomNavBg,"#17223d");
  assert.ok(result.report.counts.changedTokens>=10); for(const name of ["页面背景","顶栏","卡片","输入栏","用户气泡","沉气泡","文字色"]) assert.ok(result.report.modules.includes(name),name);
  const vars=themeApi.cssVariables(result.theme); assert.equal(vars["--theme-user-bubble"],"#6f55a7"); assert.equal(vars["--theme-input-bg"],"#17223d");
});

test("style diagnostics distinguish missing braces from missing properties", () => {
  assert.throws(()=>adapter.convertStyleText("普通说明，没有样式","x.txt"),error=>error.code==="THEME_CSS_BRACES_MISSING");
  assert.throws(()=>adapter.convertStyleText(".echoes-app-shell { 只是文字 }","x.txt"),error=>error.code==="THEME_CSS_PROPERTIES_MISSING");
});
