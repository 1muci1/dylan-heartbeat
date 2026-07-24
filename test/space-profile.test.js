"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  DEFAULT_SPACE_PROFILE,
  SpaceProfileManager
} = require("../ai-companion-frontend/space/space-profile");

const spaceRoot = path.join(__dirname, "..", "ai-companion-frontend", "space");

test("creates the default purple moon Space Profile", () => {
  const manager = new SpaceProfileManager();
  assert.deepEqual(manager.snapshot(), structuredClone(DEFAULT_SPACE_PROFILE));
  assert.equal(manager.get("default-space").name, "紫月小屋");
});

test("snapshot and get return deeply isolated copies", () => {
  const manager = new SpaceProfileManager();
  const snapshot = manager.snapshot();
  snapshot.name = "changed";
  snapshot.theme.mode = "day";
  snapshot.avatar.crop.x = 0;

  assert.equal(manager.snapshot().name, "紫月小屋");
  assert.equal(manager.snapshot().theme.mode, "night");
  assert.equal(manager.get("default-space").avatar.crop.x, 50);
});

test("update changes an allowed theme field through validated deep merge", () => {
  const manager = new SpaceProfileManager();
  const updated = manager.update("default-space", {
    theme: { mode: "auto" },
    atmosphere: { autoDayNight: true }
  });

  assert.deepEqual(updated.theme, { mode: "auto", color: "purple" });
  assert.equal(manager.snapshot().theme.mode, "auto");
});

test("update changes allowed avatar fields without replacing crop defaults", () => {
  const manager = new SpaceProfileManager();
  const updated = manager.update("default-space", {
    avatar: { frame: "soft", scale: 1.75, crop: { x: 25 } }
  });

  assert.equal(updated.avatar.frame, "soft");
  assert.equal(updated.avatar.scale, 1.75);
  assert.deepEqual(updated.avatar.crop, { x: 25, y: 50 });
});

test("update rejects memory and identity fields", () => {
  const manager = new SpaceProfileManager();
  for (const patch of [
    { memory: { content: "forbidden" } },
    { identity: { name: "forbidden" } }
  ]) {
    assert.throws(
      () => manager.update("default-space", patch),
      error => error.code === "SPACE_PROFILE_FIELD_FORBIDDEN"
    );
  }
});

test("reset restores the full default profile", () => {
  const manager = new SpaceProfileManager();
  manager.update("default-space", {
    name: "Changed",
    theme: { mode: "day" },
    background: { url: "/assets/background.webp", opacity: 0.8, blur: 8 }
  });

  assert.deepEqual(manager.reset(), structuredClone(DEFAULT_SPACE_PROFILE));
  assert.deepEqual(manager.snapshot(), structuredClone(DEFAULT_SPACE_PROFILE));
});

test("missing Persistence Adapter is safe and does not read or save", async () => {
  const manager = new SpaceProfileManager();
  assert.equal(await manager.load(), null);
  assert.equal(await manager.save(), false);
  assert.equal(manager.setPersistenceAdapter(null), false);
});

test("Persistence Adapter is never called automatically", async () => {
  const calls = [];
  const adapter = {
    async load() { calls.push("load"); return null; },
    async save() { calls.push("save"); }
  };
  const manager = new SpaceProfileManager({ persistenceAdapter: adapter });
  manager.snapshot();
  manager.get("default-space");
  manager.update("default-space", { name: "Still in memory" });
  manager.reset();

  assert.deepEqual(calls, []);
  await manager.save();
  assert.deepEqual(calls, ["save"]);
});

test("Space Profile module has no forbidden runtime or storage dependency", () => {
  const source = fs.readFileSync(path.join(spaceRoot, "space-profile.js"), "utf8");
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|Gateway|MemoryWriter|StructuredMemoryStore|IdentityBoundary|ChatRuntime/
  );
});

test("Space Runtime loads Space Profile before Theme and Avatar modules", () => {
  const html = fs.readFileSync(path.join(spaceRoot, "index.html"), "utf8");
  const runtime = fs.readFileSync(path.join(spaceRoot, "space.js"), "utf8");
  assert.ok(html.indexOf("space-profile.js") < html.indexOf("space.js"));
  assert.match(runtime, /SpaceProfileManager/);
  assert.doesNotMatch(runtime, /createSpaceState/);
});
