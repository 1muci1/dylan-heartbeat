"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const themeApi = require("../frontend-p4b/assets/js/theme-store");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const themeScript = read("frontend-p4b/assets/js/theme-store.js");
const themeCss = read("frontend-p4b/assets/css/theme.css");
const purple = /#(?:8b5cf6|8a63d2|9b7cff|a78bfa|8b6f9f|7c5c96|76618a|594766|725c84|7a638c|9278a5)/iu;

const blueTheme = themeApi.normalizeTheme({
  ...themeApi.DEFAULT_THEME,
  id: "theme_blue_computed_v63",
  name: "淡海蓝章 computed fixture",
  tokens: {
    ...themeApi.DEFAULT_THEME.tokens,
    colorPrimary: "#5ba7e8", colorAccent: "#7cbce9", colorBg: "#eaf7ff",
    colorText: "#243244", colorMuted: "#61778a", cardBg: "rgba(255,255,255,.78)",
    cardText: "#243244", cardMutedText: "#61778a", headerBg: "rgba(235,248,255,.88)",
    headerText: "#243244", inputBg: "rgba(255,255,255,.9)", inputText: "#243244",
    composerBg: "rgba(235,248,255,.9)", bottomNavBg: "rgba(240,250,255,.92)",
    navText: "#47657b", navActiveText: "#1d4f73", borderColor: "rgba(91,167,232,.28)"
  }
});

const createPage = ({ html, css, url }) => {
  const dom = new JSDOM(read(html), { url, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.localStorage.setItem(themeApi.ACTIVE_KEY, JSON.stringify(blueTheme));
  for (const file of css) {
    const style = dom.window.document.createElement("style");
    style.dataset.source = file;
    style.textContent = read(file);
    dom.window.document.head.append(style);
  }
  const style = dom.window.document.createElement("style");
  style.dataset.source = "frontend-p4b/assets/css/theme.css";
  style.textContent = themeCss;
  dom.window.document.head.append(style);
  dom.window.eval(themeScript);
  return dom;
};

const resolveVars = (value, rootStyle, depth = 0) => {
  if (!value || depth > 12) return value;
  return value.replace(/var\((--[\w-]+)(?:,[^)]+)?\)/gu, (_match, name) =>
    resolveVars(rootStyle.getPropertyValue(name).trim(), rootStyle, depth + 1));
};

const computedValue = (window, selector, property) => {
  const node = window.document.querySelector(selector);
  assert.ok(node, `missing ${selector}`);
  const rootStyle = window.getComputedStyle(window.document.documentElement);
  return resolveVars(window.getComputedStyle(node).getPropertyValue(property).trim(), rootStyle);
};

const assertBlue = (window, selector, property) => {
  const value = computedValue(window, selector, property);
  assert.match(value, /#5ba7e8|rgba\(\s*(?:255\s*,\s*255\s*,\s*255|240\s*,\s*250\s*,\s*255)|#eaf7ff/iu, `${selector} ${property}: ${value}`);
  assert.doesNotMatch(value, purple, `${selector} leaked purple: ${value}`);
};

test("real collaboration URL applies blue activeTheme to computed primary surfaces", () => {
  const html = read("frontend-p4b/index.html");
  assert.match(html, /href="\/collaboration\/"[^>]*data-nav="collaboration"/u);
  const dom = createPage({
    html: "ai-companion-frontend/collaboration/index.html",
    css: ["ai-companion-frontend/collaboration/collaboration.css"],
    url: "https://chat.xiaowo.homes/collaboration/"
  });
  const rootStyle = dom.window.getComputedStyle(dom.window.document.documentElement);
  assert.equal(rootStyle.getPropertyValue("--xb-color-accent").trim(), "#5ba7e8");
  assert.equal(dom.window.XinbanThemeStore.getActive().name, blueTheme.name);
  for (const [selector, property] of [
    ["body", "background"], [".intro-card", "background"], [".create-card", "background"],
    [".agent-card", "background"], [".primary-button", "background"],
    [".page-header a", "background"], ["textarea", "background"], [".roundtable-mark span", "background"]
  ]) assertBlue(dom.window, selector, property);
  dom.window.close();
});

test("space settings uses canonical blue variables instead of purple legacy engine values", () => {
  const settings = read("frontend-p4b/settings.html");
  assert.match(settings, /href="\/space\/studio\/"/u);
  assert.doesNotMatch(settings, /ai-companion-frontend\/space/u);
  const dom = createPage({
    html: "ai-companion-frontend/space/index.html",
    css: ["ai-companion-frontend/theme/theme.css", "ai-companion-frontend/theme/app-nav.css", "ai-companion-frontend/avatar/avatar.css", "ai-companion-frontend/space/space.css"],
    url: "https://chat.xiaowo.homes/space/"
  });
  const active = dom.window.document.querySelector(".segmented button");
  assert.ok(active); active.classList.add("is-active");
  for (const [selector, property] of [
    ["body", "background-color"], [".preview-card", "background"], [".studio-card", "background"],
    [".segmented button.is-active", "background"], ["input[type=range]", "accent-color"],
    [".app-tab-bar", "background"], [".app-tab-bar a[aria-current=page]", "background"]
  ]) assertBlue(dom.window, selector, property);
  const rootStyle = dom.window.getComputedStyle(dom.window.document.documentElement);
  assert.equal(rootStyle.getPropertyValue("--theme-color-primary").trim(), "#5ba7e8");
  assert.doesNotMatch(resolveVars(rootStyle.getPropertyValue("--avatar-surface"), rootStyle), purple);
  dom.window.close();
});

test("home computed navigation, progress, quick card and avatar ring follow blue activeTheme", () => {
  const dom = createPage({
    html: "frontend-p4b/index.html",
    css: ["frontend-p4b/assets/css/common.css", "frontend-p4b/assets/css/home.css"],
    url: "https://chat.xiaowo.homes/index.html"
  });
  const activeNav = dom.window.document.querySelector(".bottom-nav a[data-nav=home]");
  assert.ok(activeNav); activeNav.setAttribute("aria-current", "page");
  for (const [selector, property] of [
    [".bottom-nav", "background"], [".bottom-nav a[aria-current=page]", "background"],
    [".action-card--chat", "background"], [".today-card__meter span:nth-child(1)", "background"],
    [".companion-portrait", "border-color"]
  ]) assertBlue(dom.window, selector, property);
  dom.window.close();
});

test("default purple remains allowed only when no activeTheme is stored", () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://chat.xiaowo.homes/", runScripts: "outside-only" });
  dom.window.eval(themeScript);
  assert.match(dom.window.getComputedStyle(dom.window.document.documentElement).getPropertyValue("--xb-color-accent"), /#9a79c6/iu);
  dom.window.close();
});
