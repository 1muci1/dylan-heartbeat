"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  AVATAR_BORDERS,
  AvatarStudio,
  DEFAULT_CHEN_AVATAR,
  MAX_AVATAR_BYTES
} = require("../ai-companion-frontend/avatar/avatar-studio");

const avatarRoot = path.join(__dirname, "..", "ai-companion-frontend", "avatar");

function fixture() {
  let sequence = 0;
  const revoked = [];
  const studio = new AvatarStudio({
    createObjectURL: () => `blob:avatar-${++sequence}`,
    revokeObjectURL: url => revoked.push(url)
  });
  return { revoked, studio };
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
        append(...children) { this.children.push(...children); }
      };
    }
  };
}

test("default chen avatar configuration is safe and returned as an isolated copy", () => {
  const { studio } = fixture();
  const first = studio.defaultChen();
  first.crop.x = 0;
  first.frame.border = "none";
  const second = studio.defaultChen();

  assert.equal(DEFAULT_CHEN_AVATAR.id, "chen");
  assert.equal(second.displayName, "沉");
  assert.deepEqual(second.crop, { x: 50, y: 50, zoom: 1 });
  assert.deepEqual(second.frame, { border: "moon", shape: "circle", size: 72 });
});

test("upload interface accepts supported images without persistence or network", () => {
  const { studio } = fixture();
  const config = studio.fromUpload({
    type: "image/webp",
    size: 1024,
    name: "avatar.webp"
  });

  assert.equal(config.imageUrl, "blob:avatar-1");
  assert.equal(config.source, "upload");
  assert.throws(
    () => studio.fromUpload({ type: "text/html", size: 10 }),
    error => error.code === "AVATAR_FILE_INVALID"
  );
  assert.throws(
    () => studio.fromUpload({ type: "image/png", size: MAX_AVATAR_BYTES + 1 }),
    error => error.code === "AVATAR_FILE_INVALID"
  );
});

test("crop and zoom configuration is validated and does not mutate its source", () => {
  const { studio } = fixture();
  const source = studio.defaultChen();
  const changed = studio.setCrop(source, { x: 20, y: 75, zoom: 2.25 });

  assert.deepEqual(changed.crop, { x: 20, y: 75, zoom: 2.25 });
  assert.deepEqual(source.crop, { x: 50, y: 50, zoom: 1 });
  assert.throws(() => studio.setCrop(source, { x: -1, y: 50, zoom: 1 }));
  assert.throws(() => studio.setCrop(source, { x: 50, y: 50, zoom: 4 }));
});

test("avatar border system supports all documented presets", () => {
  const { studio } = fixture();
  const source = studio.defaultChen();
  assert.deepEqual(AVATAR_BORDERS, ["moon", "soft", "minimal", "none"]);
  for (const border of AVATAR_BORDERS) {
    const value = studio.setFrame(source, { border, shape: "rounded", size: 96 });
    assert.deepEqual(value.frame, { border, shape: "rounded", size: 96 });
  }
  assert.throws(
    () => studio.setFrame(source, { border: "unsafe", shape: "circle", size: 72 }),
    error => error.code === "AVATAR_BORDER_INVALID"
  );
});

test("renderer applies crop, scale, border, and safe text/image fields", () => {
  const { studio } = fixture();
  const config = studio.fromUpload(
    { type: "image/png", size: 2048 },
    {
      crop: { x: 30, y: 60, zoom: 1.5 },
      frame: { border: "soft", shape: "circle", size: 80 }
    }
  );
  const documentRef = fakeDocument();
  const container = { children: [], append(item) { this.children.push(item); } };
  const avatar = studio.render(documentRef, container, config);

  assert.equal(avatar.dataset.avatarBorder, "soft");
  assert.equal(avatar.style.values.get("--avatar-crop-x"), "30%");
  assert.equal(avatar.style.values.get("--avatar-crop-y"), "60%");
  assert.equal(avatar.style.values.get("--avatar-zoom"), "1.5");
  assert.equal(avatar.children[0].textContent, "沉");
  assert.equal(avatar.children[1].src, "blob:avatar-1");
  assert.equal(avatar.children[1].alt, "沉的头像");
});

test("uploaded Object URLs are released explicitly or on dispose", () => {
  const { revoked, studio } = fixture();
  const first = studio.fromUpload({ type: "image/png", size: 10 });
  studio.fromUpload({ type: "image/jpeg", size: 10 });

  assert.equal(studio.release(first), true);
  assert.equal(studio.release(first), false);
  studio.dispose();
  assert.deepEqual(revoked, ["blob:avatar-1", "blob:avatar-2"]);
});

test("avatar CSS adapts to Theme Engine day and night attributes", () => {
  const css = fs.readFileSync(path.join(avatarRoot, "avatar.css"), "utf8");
  assert.match(css, /data-companion-theme="day"/);
  assert.match(css, /data-companion-theme="night"/);
  assert.match(css, /var\(--theme-color-primary/);
  assert.match(css, /data-avatar-border="moon"/);
  assert.match(css, /--avatar-crop-x/);
  assert.match(css, /--avatar-zoom/);
});

test("Avatar Studio is isolated from chat, Gateway, Memory, Identity, and storage", () => {
  const source = [
    fs.readFileSync(path.join(avatarRoot, "avatar-studio.js"), "utf8"),
    fs.readFileSync(path.join(avatarRoot, "avatar.css"), "utf8")
  ].join("\n");
  assert.doesNotMatch(
    source,
    /chat\.js|ChatRuntime|Gateway|MemoryWriter|StructuredMemoryStore|IdentityBoundary|localStorage|sessionStorage|fetch\s*\(/
  );
});
