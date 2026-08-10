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
const legacyPurple = /#(?:8b5cf6|a78bfa|9b7cff|9b84af|806798|5a466c)/iu;

const makeTheme = (id, primary, bg, card) => themes.normalizeTheme({
  ...themes.DEFAULT_THEME, id, name: id,
  tokens: {
    ...themes.DEFAULT_THEME.tokens,
    colorPrimary: primary, colorAccent: primary, colorBg: bg,
    cardBg: card, bottomNavBg: card, chatUserBubbleBg: card,
    chatUserBubbleText: themes.readableText(card, "#243244", bg),
    borderColor: `color-mix(in srgb, ${primary} 24%, transparent)`
  }
});

const fixtures = [
  makeTheme("blue-accent", "#5ba7e8", "#eaf7ff", "rgba(255,255,255,.78)"),
  makeTheme("pink-accent", "#d8739f", "#fff1f6", "rgba(255,255,255,.82)"),
  makeTheme("purple-accent", "#76539b", "#f5effa", "rgba(255,255,255,.8)")
];

const createPage = (htmlFile, cssFiles, theme) => {
  const dom = new JSDOM(read(htmlFile), { url: "https://chat.xiaowo.homes/", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.localStorage.setItem(themes.ACTIVE_KEY, JSON.stringify(theme));
  for (const file of cssFiles) {
    const style = dom.window.document.createElement("style"); style.textContent = read(file); dom.window.document.head.append(style);
  }
  const style = dom.window.document.createElement("style"); style.textContent = themeCss; dom.window.document.head.append(style);
  dom.window.eval(themeScript);
  return dom;
};

const resolveVars = (value, rootStyle, depth = 0) => depth > 12 ? value : String(value || "").replace(/var\((--[\w-]+)(?:,[^)]+)?\)/gu,
  (_all, name) => resolveVars(rootStyle.getPropertyValue(name).trim(), rootStyle, depth + 1));

const value = (window, selector, property) => {
  const node = window.document.querySelector(selector); assert.ok(node, selector);
  return resolveVars(window.getComputedStyle(node).getPropertyValue(property), window.getComputedStyle(window.document.documentElement));
};

test("blue, pink and custom purple themes derive one translucent accent family", () => {
  for (const theme of fixtures) {
    const vars = themes.cssVariables(theme);
    for (const key of ["--xb-accent", "--xb-accent-soft", "--xb-accent-soft-2", "--xb-accent-strong", "--xb-accent-border", "--xb-accent-text", "--xb-accent-icon-bg", "--xb-accent-card-bg", "--xb-progress-fill", "--xb-nav-active-bg", "--xb-nav-active-text", "--xb-nav-active-icon", "--xb-fab-bg", "--xb-fab-text"]) {
      assert.ok(vars[key], `${theme.id} ${key}`);
      assert.match(vars[key], new RegExp(theme.tokens.colorPrimary.replace("#", "#"), "iu"), `${theme.id} ${key}`);
    }
  }
});

test("home quick card and progress computed styles follow each active theme", () => {
  for (const theme of fixtures) {
    const dom = createPage("frontend-p4b/index.html", ["frontend-p4b/assets/css/common.css", "frontend-p4b/assets/css/home.css"], theme);
    const active = dom.window.document.querySelector(".bottom-nav a[data-nav=home]"); active.classList.add("is-active");
    for (const [selector, property] of [[".action-card--chat", "background"], [".today-card__meter span", "background"], [".action-card__icon", "background"], [".bottom-nav a.is-active", "background"]]) {
      const computed = value(dom.window, selector, property);
      assert.match(computed, new RegExp(theme.tokens.colorPrimary, "iu"), `${theme.id} ${selector}: ${computed}`);
      if (theme.id !== "purple-accent") assert.doesNotMatch(computed, legacyPurple);
    }
    dom.window.close();
  }
});

test("chat active navigation and center icon use soft theme-derived accent", () => {
  for (const theme of fixtures) {
    const dom = createPage("frontend-p4b/chat.html", ["frontend-p4b/assets/css/common.css", "frontend-p4b/assets/css/chat.css"], theme);
    const active = dom.window.document.querySelector(".bottom-nav__chat"); active.classList.add("is-active");
    for (const [selector, property] of [[".bottom-nav__chat.is-active", "background"], [".bottom-nav__chat svg", "background"], [".composer__send", "background"]]) {
      const computed = value(dom.window, selector, property);
      assert.match(computed, new RegExp(theme.tokens.colorPrimary, "iu"), `${theme.id} ${selector}: ${computed}`);
      if (theme.id !== "purple-accent") assert.doesNotMatch(computed, legacyPurple);
    }
    dom.window.close();
  }
});

test("custom purple comes from activeTheme rather than legacy fixed purple", () => {
  const vars = themes.cssVariables(fixtures[2]);
  assert.equal(vars["--xb-accent"], "#76539b");
  assert.equal(vars["--xb-progress-fill"], "#76539b");
  assert.doesNotMatch(Object.values(vars).join("\n"), /#8b5cf6|#a78bfa|#9b7cff/iu);
});
