"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { AvatarStudio } = require("../ai-companion-frontend/avatar/avatar-studio");
const {
  AtmosphereEngine
} = require("../ai-companion-frontend/space/atmosphere/atmosphere-engine");
const {
  SpacePresetManager
} = require("../ai-companion-frontend/space/presets/preset-manager");
const {
  SpaceProfileManager
} = require("../ai-companion-frontend/space/space-profile");
const {
  SpaceHomeController,
  describeAtmosphere,
  resolveMoment
} = require("../ai-companion-frontend/home/home");

const homeRoot = path.join(__dirname, "..", "ai-companion-frontend", "home");
const appRoot = path.join(__dirname, "..", "ai-companion-frontend");
const fixedNow = () => new Date("2026-07-24T21:05:00.000Z");

function fixture() {
  const calls = [];
  const profileManager = new SpaceProfileManager();
  const themeEngine = {
    setMode(value) { calls.push(["mode", value]); },
    setAccent(value) { calls.push(["accent", value]); },
    setFontFamily(value) { calls.push(["font", value]); return { family: value }; },
    setBackground(value) { calls.push(["background", value]); },
    clearBackground() { calls.push(["clearBackground"]); },
    dispose() {}
  };
  const avatarStudio = new AvatarStudio({
    createObjectURL: () => "blob:unused",
    revokeObjectURL() {}
  });
  const controller = new SpaceHomeController({
    profileManager,
    themeEngine,
    avatarStudio,
    atmosphereEngine: new AtmosphereEngine({
      clock: fixedNow
    }),
    presetManager: new SpacePresetManager(),
    clock: fixedNow
  });
  return { calls, controller, profileManager };
}

function fakeDocument() {
  return {
    createElement(tagName) {
      return {
        tagName,
        alt: "",
        className: "",
        dataset: {},
        children: [],
        src: "",
        textContent: "",
        style: {
          values: new Map(),
          setProperty(name, value) { this.values.set(name, value); }
        },
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute(name, value) { this[name] = value; }
      };
    }
  };
}

test("Space Home compatibility entry redirects without loading the legacy shell", () => {
  const html = fs.readFileSync(path.join(homeRoot, "index.html"), "utf8");
  assert.match(html, /v61-p4b-nav-unify/);
  assert.match(html, /location\.replace\("\/index\.html"\)/);
  assert.doesNotMatch(html, /theme-engine\.js|home\.js\?v=37|data-home-shell|app-tab-bar/u);
});

test("Root entry redirects into the canonical Home while preserving AppConfig bootstrap", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  assert.match(html, /landing-card/);
  assert.match(html, /loading__bars/);
  assert.match(html, /\/assets\/js\/data\.js/);
  assert.match(html, /window\.AppConfig/);
  assert.match(html, /setTimeout\(\(\) => window\.location\.replace\("\/index\.html"\), 720\)/);
  assert.match(html, /location\.replace\("\/index\.html"\)/);
  assert.match(html, /正在进入沉的小世界/);
});

test("Legacy Home implementation files remain testable but are not loaded by the compatibility entry", () => {
  const html = fs.readFileSync(path.join(homeRoot, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(homeRoot, "home.css"), "utf8");
  const js = fs.readFileSync(path.join(homeRoot, "home.js"), "utf8");
  for (const token of [
    "home-shell-fade",
    "home-hero-rise",
    "home-atmosphere-fade",
    "home-card-rise",
    "home-fade-up",
    "home-pop",
    "is-home-ready"
  ]) {
    assert.match(css + js, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(html, /home\.css|home\.js/);
});

test("Home exposes the current space, atmosphere, and moment without mutating profile state", () => {
  const { controller, profileManager } = fixture();
  const before = profileManager.snapshot();
  const state = controller.load();
  assert.equal(state.profile.name, "紫月小屋");
  assert.equal(state.profile.theme.mode, "night");
  assert.equal(state.heroTitle, "🌙 紫月小屋");
  assert.equal(state.heroPresence, "沉正在这里");
  assert.equal(state.heroAtmosphere, "夜晚 · 月光氛围");
  assert.deepEqual(state.moment, {
    key: "night",
    label: "夜晚",
    icon: "🌙",
    clock: "21:05",
    date: "2026年07月24日"
  });
  state.profile.name = "污染";
  assert.deepEqual(profileManager.snapshot(), before);
});

test("Home derives the current Chen avatar and keeps the summary data intact", () => {
  const { controller } = fixture();
  controller.load();
  const container = { children: [], append(item) { this.children.push(item); } };
  const avatar = controller.renderAvatar(fakeDocument(), container);
  assert.equal(avatar.dataset.avatarId, "chen");
  assert.equal(avatar.dataset.avatarBorder, "moon");
  assert.equal(avatar.children[0].textContent, "沉");
  assert.equal(container.children.length, 1);
});

test("Home helper functions resolve day, sunset, and night states deterministically", () => {
  assert.deepEqual(resolveMoment(new Date("2026-07-24T07:00:00.000Z")), {
    key: "day",
    label: "白昼",
    icon: "🌤️",
    atmosphere: "晨雾氛围"
  });
  assert.deepEqual(resolveMoment(new Date("2026-07-24T17:00:00.000Z")), {
    key: "sunset",
    label: "黄昏",
    icon: "🌇",
    atmosphere: "暮色氛围"
  });
  assert.deepEqual(resolveMoment(new Date("2026-07-24T21:00:00.000Z")), {
    key: "night",
    label: "夜晚",
    icon: "🌙",
    atmosphere: "月光氛围"
  });
  assert.equal(describeAtmosphere({ animation: "slow-sunset" }), "暮色氛围");
});

test("Legacy Home compatibility entry contains no duplicate cards or runtime backdoors", () => {
  const html = fs.readFileSync(path.join(homeRoot, "index.html"), "utf8");
  assert.match(html, /href="\/index\.html"/);
  assert.doesNotMatch(html, /href="\/(?:chat\.html|space\/|collaboration\/|game\/|frontend-p4b\/memory\.html)"/u);
});

test("Space Home is frontend-only and cannot access protected runtimes", () => {
  const source = [
    fs.readFileSync(path.join(homeRoot, "index.html"), "utf8"),
    fs.readFileSync(path.join(homeRoot, "home.js"), "utf8"),
    fs.readFileSync(path.join(homeRoot, "home.css"), "utf8")
  ].join("\n");
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|StructuredMemoryStore|MemoryWriter|IdentityBoundary|ChatRuntime|Bearer|Gateway/
  );
});

test("Space Home keeps the responsive layout and motion treatment", () => {
  const css = fs.readFileSync(path.join(homeRoot, "home.css"), "utf8");
  assert.match(css, /\.home-hero__orb/);
  assert.match(css, /@keyframes home-orb-drift/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-width: 1024px\)/);
});
