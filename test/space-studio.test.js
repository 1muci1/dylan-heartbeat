"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { AvatarStudio } = require("../ai-companion-frontend/avatar/avatar-studio");
const {
  SpaceProfileManager
} = require("../ai-companion-frontend/space/space-profile");
const {
  SpacePresetManager
} = require("../ai-companion-frontend/space/presets/preset-manager");
const {
  SpaceStudioController
} = require("../ai-companion-frontend/space/studio/studio");

const studioRoot = path.join(
  __dirname,
  "..",
  "ai-companion-frontend",
  "space",
  "studio"
);

function fixture() {
  let sequence = 0;
  const calls = [];
  const revoked = [];
  const themeEngine = {
    setMode(mode) { calls.push(["mode", mode]); return mode; },
    setAccent(color) { calls.push(["accent", color]); return { name: color }; },
    setFontFamily(family) { calls.push(["font", family]); return { family }; },
    async loadFont(input) {
      calls.push(["loadFont", { ...input }]);
      return { family: input.family, weight: "400", style: "normal" };
    },
    setBackground(input) {
      calls.push(["background", { ...input }]);
      return { ...input };
    },
    clearBackground() { calls.push(["clearBackground"]); },
    dispose() {}
  };
  const avatarStudio = new AvatarStudio({
    createObjectURL: () => `blob:avatar-${++sequence}`,
    revokeObjectURL: url => revoked.push(url)
  });
  const controller = new SpaceStudioController({
    profileManager: new SpaceProfileManager(),
    presetManager: new SpacePresetManager(),
    themeEngine,
    avatarStudio,
    createObjectURL: () => `blob:background-${++sequence}`,
    revokeObjectURL: url => revoked.push(url)
  });
  calls.length = 0;
  return { calls, controller, revoked };
}

test("Space Studio page loads the profile, active-theme adapter, and avatar modules", () => {
  const html = fs.readFileSync(path.join(studioRoot, "index.html"), "utf8");
  assert.match(html, /空间工作室/);
  assert.match(html, /data-profile-name/);
  assert.match(html, /\.\.\/space-profile\.js/);
  assert.match(html, /\.\.\/theme-adapter\.js\?v=v63-p4b/);
  assert.doesNotMatch(html, /theme\/theme-engine\.js/);
  assert.match(html, /\.\.\/\.\.\/avatar\/avatar-studio\.js/);
  assert.match(html, /<meta name="viewport"/);
});

test("current configuration comes from Space Profile Manager", () => {
  const { controller } = fixture();
  const profile = controller.snapshot();
  assert.equal(profile.name, "紫月小屋");
  assert.deepEqual(profile.theme, { mode: "night", color: "purple" });
  assert.equal(profile.avatar.frame, "moon");
  assert.equal(profile.background.url, null);
  assert.equal(profile.font.family, "default");
});

test("theme changes update the profile and Theme Engine together", () => {
  const { calls, controller } = fixture();
  const profile = controller.setTheme({ mode: "day", color: "blue" });
  assert.deepEqual(profile.theme, { mode: "day", color: "blue" });
  assert.equal(profile.atmosphere.autoDayNight, false);
  assert.deepEqual(calls, [["mode", "day"], ["accent", "blue"]]);
});

test("avatar upload, scale, crop, and border remain Profile-backed", () => {
  const { controller } = fixture();
  controller.setAvatarFile({ type: "image/png", size: 2048 });
  const profile = controller.setAvatarAppearance({
    scale: 1.8,
    x: 22,
    y: 71,
    frame: "soft"
  });
  assert.equal(profile.avatar.type, "upload");
  assert.equal(profile.avatar.scale, 1.8);
  assert.deepEqual(profile.avatar.crop, { x: 22, y: 71 });
  assert.equal(profile.avatar.frame, "soft");
  assert.deepEqual(controller.getAvatar().crop, { x: 22, y: 71, zoom: 1.8 });
});

test("background upload, opacity, blur, and clear use the Theme Engine", () => {
  const { calls, controller, revoked } = fixture();
  controller.setBackgroundFile({ type: "image/webp", size: 4096 });
  const profile = controller.setBackgroundAppearance({ opacity: 0.55, blur: 9 });
  assert.equal(profile.background.opacity, 0.55);
  assert.equal(profile.background.blur, 9);
  assert.match(profile.background.url, /^blob:background-/);
  const applied = calls.filter(([name]) => name === "background").at(-1)[1];
  assert.equal(applied.blur, 9);
  assert.match(applied.overlay, /0\.55/);

  const cleared = controller.clearBackground();
  assert.equal(cleared.background.url, null);
  assert.equal(calls.at(-1)[0], "clearBackground");
  assert.equal(revoked.length, 1);
});

test("font switching and custom font preview update the same profile", async () => {
  const { calls, controller } = fixture();
  let profile = await controller.setFont({ family: "serif" });
  assert.equal(profile.font.family, "serif");
  assert.equal(profile.font.url, null);

  profile = await controller.setFont({
    family: "Chen Custom",
    url: "/assets/chen.woff2"
  });
  assert.equal(profile.font.family, "Chen Custom");
  assert.equal(profile.font.url, "/assets/chen.woff2");
  assert.equal(calls.some(([name]) => name === "loadFont"), true);
});

test("reset restores the purple moon default profile", () => {
  const { controller } = fixture();
  controller.setTheme({ mode: "auto", color: "rose" });
  controller.setBackgroundAppearance({ opacity: 0.8, blur: 12 });
  controller.setAvatarAppearance({ scale: 2, frame: "none" });

  const profile = controller.reset();
  assert.equal(profile.name, "紫月小屋");
  assert.deepEqual(profile.theme, { mode: "night", color: "purple" });
  assert.equal(profile.background.blur, 0);
  assert.equal(profile.avatar.frame, "moon");
  assert.equal(profile.font.family, "default");
});

test("preset selection flows through Profile Manager into Theme and Avatar", () => {
  const { calls, controller } = fixture();
  assert.equal(controller.listPresets().length, 4);
  const profile = controller.applyPreset("deep-space-room");
  assert.equal(profile.name, "深空房间");
  assert.equal(profile.theme.color, "blue");
  assert.equal(controller.getAvatar().frame.border, "minimal");
  assert.equal(calls.some(([name, value]) => name === "accent" && value === "blue"), true);
});

test("Space Studio is in-memory only and cannot affect Memory or backend flows", () => {
  const source = [
    fs.readFileSync(path.join(studioRoot, "index.html"), "utf8"),
    fs.readFileSync(path.join(studioRoot, "studio.js"), "utf8"),
    fs.readFileSync(path.join(studioRoot, "studio.css"), "utf8")
  ].join("\n");
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|StructuredMemoryStore|MemoryWriter|IdentityBoundary|Gateway|chat\.js/
  );
});

test("Space Studio CSS provides a mobile-first single-column fallback", () => {
  const css = fs.readFileSync(path.join(studioRoot, "studio.css"), "utf8");
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.studio-grid\s*\{\s*grid-template-columns: 1fr/);
});
