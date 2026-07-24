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

test("Space Home page loads the upgraded hero and navigation structure", () => {
  const html = fs.readFileSync(path.join(homeRoot, "index.html"), "utf8");
  for (const token of [
    "data-home-shell",
    "data-home-hero",
    "data-home-user-avatar",
    "data-home-avatar",
    "data-home-space-title",
    "data-home-atmosphere",
    "data-home-preset-name",
    "data-home-moment",
    "home-cards",
    "共同记忆"
  ]) {
    assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const source of [
    "theme-engine.js",
    "avatar-studio.js",
    "space-profile.js",
    "preset-manager.js",
    "atmosphere-engine.js",
    "home.js"
  ]) {
    assert.match(html, new RegExp(source.replace(".", "\\.")));
  }
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

test("Home contains all documented cards and no runtime backdoors", () => {
  const html = fs.readFileSync(path.join(homeRoot, "index.html"), "utf8");
  const entries = [
    ['href="/chat.html"', "和沉聊天"],
    ['href="../space/"', "空间设置"],
    ['href="../collaboration/"', "和 AI 一起讨论"],
    ['href="../game/"', "一起玩"],
    ['href="/frontend-p4b/memory.html"', "共同记忆"]
  ];
  for (const [href, label] of entries) {
    assert.match(html, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
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
