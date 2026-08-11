"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const themes = require("../frontend-p4b/assets/js/theme-store");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const themeScript = read("frontend-p4b/assets/js/theme-store.js");
const themeCss = read("frontend-p4b/assets/css/theme.css");
const colorLiteral = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/giu;

const seaBlueWithoutAccent = {
  ...themes.DEFAULT_THEME,
  id: "theme_imported_sea_blue_without_accent",
  name: "淡海蓝导入主题",
  source: "echoes",
  accentMode: "theme-or-transparent",
  accentExplicit: false,
  tokens: {
    ...themes.DEFAULT_THEME.tokens,
    colorBg: "#eaf7ff", colorText: "#243244", colorMuted: "#61778a",
    cardBg: "rgba(255,255,255,.78)", cardText: "#243244", cardMutedText: "#61778a",
    headerBg: "rgba(235,248,255,.88)", headerText: "#243244",
    inputBg: "rgba(255,255,255,.9)", inputText: "#243244", composerBg: "rgba(235,248,255,.9)",
    bottomNavBg: "rgba(240,250,255,.92)", navText: "#47657b", navActiveText: "#1d4f73",
    borderColor: "rgba(91,167,232,.28)"
  }
};

const createHome = theme => {
  const dom = new JSDOM(read("frontend-p4b/index.html"), { url: "https://chat.xiaowo.homes/index.html", runScripts: "outside-only", pretendToBeVisual: true });
  if (theme) dom.window.localStorage.setItem(themes.ACTIVE_KEY, JSON.stringify(theme));
  for (const file of ["frontend-p4b/assets/css/common.css", "frontend-p4b/assets/css/home.css"]) {
    const style = dom.window.document.createElement("style"); style.textContent = read(file); dom.window.document.head.append(style);
  }
  const style = dom.window.document.createElement("style"); style.textContent = themeCss; dom.window.document.head.append(style);
  dom.window.eval(themeScript);
  dom.window.document.querySelector(".bottom-nav [data-nav=home]").setAttribute("aria-current", "page");
  return dom;
};

const resolveVars = (value, rootStyle, depth = 0) => depth > 12 ? value : String(value || "").replace(/var\((--[\w-]+)(?:,[^)]+)?\)/gu,
  (_all, name) => resolveVars(rootStyle.getPropertyValue(name).trim(), rootStyle, depth + 1));

const computed = (window, selector, property) => {
  const node = window.document.querySelector(selector); assert.ok(node, selector);
  return resolveVars(window.getComputedStyle(node).getPropertyValue(property).trim(), window.getComputedStyle(window.document.documentElement));
};

const assertNoPurple = (value, label) => {
  for (const color of value.match(colorLiteral) || []) assert.equal(themes.isPurpleColor(color), false, `${label}: ${color} in ${value}`);
};

test("imported sea-blue activeTheme with inherited default accent uses blue details and neutral glass", () => {
  const normalized = themes.normalizeTheme(seaBlueWithoutAccent);
  const vars = themes.cssVariables(normalized);
  assert.equal(normalized.accentMode, "theme-or-transparent");
  assert.equal(themes.themeAllowsPurpleAccent(normalized), false);
  assert.equal(vars["--xb-accent"], "#1d4f73");
  assert.equal(vars["--xb-accent-card-bg"], "rgba(255,255,255,.35)");
  assert.equal(vars["--xb-accent-icon-bg"], "rgba(80,110,130,.10)");
  assert.equal(vars["--xb-nav-active-bg"], "rgba(255,255,255,.18)");
  assert.equal(vars["--xb-fab-bg"], "rgba(255,255,255,.35)");
  for (const name of ["--xb-color-accent", "--xb-color-accent-soft", "--xb-accent", "--xb-accent-soft", "--xb-accent-soft-2", "--xb-accent-border", "--xb-accent-text", "--xb-accent-icon-bg", "--xb-accent-card-bg", "--xb-fab-bg", "--xb-fab-text", "--xb-button-bg", "--xb-nav-active-bg", "--xb-nav-active-text", "--xb-nav-active-icon", "--xb-avatar-ring", "--xb-progress-fill"]) assertNoPurple(vars[name], name);

  const dom = createHome(normalized);
  for (const [selector, property] of [
    [".companion-hero", "background"], [".today-card__mark", "background"],
    [".today-card__meter span", "background"], [".action-card--chat", "background"],
    [".action-card--memory .action-card__icon", "background"], [".action-card--status .action-card__icon", "background"],
    [".bottom-nav [aria-current=page]", "background"], [".bottom-nav__chat svg", "background"],
    [".companion-portrait", "border-color"]
  ]) assertNoPurple(computed(dom.window, selector, property), `${selector} ${property}`);
  assert.match(computed(dom.window, ".today-card__meter span", "background"), /#1d4f73/iu);
  assert.match(computed(dom.window, ".companion-portrait", "border-color"), /#1d4f73/iu);
  dom.window.close();
});

test("no activeTheme keeps the explicit default purple preset", () => {
  const dom = createHome(null); const rootStyle = dom.window.getComputedStyle(dom.window.document.documentElement);
  assert.equal(themes.themeIsDefaultPurple(dom.window.XinbanThemeStore.getActive()), true);
  assert.equal(rootStyle.getPropertyValue("--xb-accent").trim(), themes.DEFAULT_THEME.tokens.colorPrimary);
  assert.equal(themes.isPurpleColor(rootStyle.getPropertyValue("--xb-accent").trim()), true);
  dom.window.close();
});

test("an explicitly purple imported theme may use only its declared purple accent", () => {
  const explicit = themes.normalizeTheme({
    ...seaBlueWithoutAccent, id: "theme_explicit_purple", source: "json", accentExplicit: true,
    tokens: { ...seaBlueWithoutAccent.tokens, colorPrimary: "#76539b", colorAccent: "#76539b" }
  });
  const vars = themes.cssVariables(explicit);
  assert.equal(themes.themeAllowsPurpleAccent(explicit), true);
  assert.equal(vars["--xb-accent"], "#76539b");
  assert.equal(vars["--xb-progress-fill"], "#76539b");
  assert.doesNotMatch(Object.values(vars).join("\n"), /#8b5cf6|#a78bfa|#9b7cff|#9a79c6/iu);
});

test("HSL purple detection covers the forbidden 260-285 hue interval", () => {
  assert.equal(themes.isPurpleColor("hsl(272 80% 68%)"), true);
  assert.equal(themes.isPurpleColor("hsl(205 62% 62%)"), false);
});
