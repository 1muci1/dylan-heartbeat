"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const themes = require("../frontend-p4b/assets/js/theme-store.js");

const root = path.join(__dirname, "..", "frontend-p4b");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const localAsset = "/api/theme/assets/11111111-1111-4111-8111-111111111111";

test("freeform visual slots normalize bounded geometry and style controls", () => {
  const theme = themes.normalizeTheme({ ...themes.DEFAULT_THEME, visualSlots: { enabledByUser: true,
    homeCardDecor: { url: localAsset, enabled: true, x: 500, y: -500, scale: 9, rotation: 720,
      opacity: 2, radius: 80, borderWidth: 40, borderColor: "#5ba7e8", shadow: "0px 8px 20px rgba(0,0,0,.2)" }
  } });
  assert.deepEqual({ x: theme.visualSlots.homeCardDecor.x, y: theme.visualSlots.homeCardDecor.y,
    scale: theme.visualSlots.homeCardDecor.scale, rotation: theme.visualSlots.homeCardDecor.rotation,
    opacity: theme.visualSlots.homeCardDecor.opacity, radius: theme.visualSlots.homeCardDecor.radius,
    borderWidth: theme.visualSlots.homeCardDecor.borderWidth },
  { x: 100, y: -100, scale: 3, rotation: 180, opacity: 1, radius: 50, borderWidth: 12 });
  assert.equal(theme.visualSlots.homeCardDecor.borderColor, "#5ba7e8");
  assert.equal(theme.visualSlots.homeCardDecor.shadow, "0px 8px 20px rgba(0,0,0,.2)");
});

test("freeform theme package round-trips appearance controls without admitting remote slot assets", () => {
  const storage = new Map();
  const adapter = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)) };
  const store = new themes.ThemeStore({ storage: adapter, documentRef: null });
  const customized = themes.normalizeTheme({ ...themes.DEFAULT_THEME, id: "freeform", source: "custom",
    tokens: { ...themes.DEFAULT_THEME.tokens, iconBlockBg: "#d7efff", progressBg: "#dbeaf2", progressFill: "#2879ad", avatarRing: "#5ba7e8" },
    visualSlots: { enabledByUser: true, avatarFrame: { url: localAsset, enabled: true, x: 12, y: -8, scale: 1.4, rotation: 16, opacity: .75, radius: 50, borderWidth: 2, borderColor: "#5ba7e8", shadow: "none" }, navAccent: { url: "https://evil.test/nav.png", enabled: true } }
  });
  const pack = JSON.parse(JSON.stringify(store.exportTheme(customized)));
  const imported = store.importTheme(pack);
  assert.equal(imported.tokens.progressFill, "#2879ad");
  assert.equal(imported.visualSlots.avatarFrame.x, 12);
  assert.equal(imported.visualSlots.avatarFrame.scale, 1.4);
  assert.equal(imported.visualSlots.avatarFrame.enabled, true);
  assert.equal(imported.visualSlots.navAccent.url, "");
});

test("freeform editor exposes live surface controls, slot transforms and pointer dragging", () => {
  const html = read("theme-workshop.html"); const js = read("assets/js/theme-workshop.js"); const css = read("assets/css/theme-workshop.css");
  for (const token of ["iconBlockBg", "progressBg", "progressFill", "avatarRing"]) assert.match(html, new RegExp(`data-theme-token="${token}"`, "u"));
  for (const field of ["x", "y", "scale", "rotation", "opacity", "radius", "borderWidth", "borderColor", "shadow"]) assert.match(js, new RegExp(`addControl\\([^\\n]+"${field}"`, "u"));
  assert.match(js, /pointerdown/u); assert.match(js, /setPointerCapture/u); assert.match(html, /data-theme-reset-slot/u);
  assert.match(css, /data-preview-layer/u); assert.match(css, /theme-slot-controls/u);
});

test("production visual-slot transforms stay bounded and do not alter chat geometry", () => {
  const css = read("assets/css/theme.css"); const variables = themes.cssVariables({ ...themes.DEFAULT_THEME, layout: { ...themes.DEFAULT_THEME.layout, effectsMode: "performance" }, visualSlots: { enabledByUser: true, inputDecor: { url: localAsset, enabled: true, x: 20, scale: 1.5 } } });
  assert.equal(variables["--xb-input-decor"], "none");
  assert.equal(variables["--xb-slot-input-decor-x"], "20px");
  assert.equal(variables["--xb-slot-input-decor-scale"], "1.5");
  assert.match(css, /--xb-slot-input-decor-x/u);
  for (const selector of [".chat-main", ".message-list", ".session-drawer"]) {
    const rules = [...css.matchAll(new RegExp(`${selector.replace(".", "\\.")}[^{}]*\\{([^}]*)\\}`, "gu"))].map(match => match[1]).join(";");
    assert.doesNotMatch(rules, /transform:|position:|width:|height:/u, selector);
  }
});
