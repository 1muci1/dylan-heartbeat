"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  ThemeEngine,
  ThemeEngineError,
  THEME_MODES
} = require("../ai-companion-frontend/theme/theme-engine");

const themeRoot = path.join(__dirname, "..", "ai-companion-frontend", "theme");

function fixture({ dark = false } = {}) {
  const values = new Map();
  const listeners = new Set();
  const mediaQuery = {
    matches: dark,
    addEventListener(_name, listener) { listeners.add(listener); },
    removeEventListener(_name, listener) { listeners.delete(listener); },
    change(matches) {
      this.matches = matches;
      for (const listener of listeners) listener({ matches });
    }
  };
  const addedFonts = [];
  const documentRef = {
    documentElement: {
      dataset: {},
      style: {
        setProperty(name, value) { values.set(name, value); }
      }
    },
    fonts: { add(face) { addedFonts.push(face); } }
  };
  const fontCalls = [];
  const engine = new ThemeEngine({
    documentRef,
    matchMedia: () => mediaQuery,
    fontFaceFactory(family, source, descriptors) {
      fontCalls.push({ family, source, descriptors });
      return { async load() { return { family, loaded: true }; } };
    }
  });
  return { addedFonts, documentRef, engine, fontCalls, listeners, mediaQuery, values };
}

test("Theme CSS defines the default purple moon night variable system", () => {
  const css = fs.readFileSync(path.join(themeRoot, "theme.css"), "utf8");
  assert.match(css, /--theme-name:\s*"purple-moon-night"/);
  assert.match(css, /--theme-color-primary/);
  assert.match(css, /--theme-background-image/);
  assert.match(css, /--theme-font-family/);
  assert.match(css, /data-companion-theme="day"/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Theme Engine defaults to night and supports manual day/night modes", () => {
  const { documentRef, engine } = fixture();
  assert.deepEqual(THEME_MODES, ["auto", "day", "night"]);
  assert.deepEqual(engine.getMode(), { selected: "night", resolved: "night" });
  assert.equal(documentRef.documentElement.dataset.companionTheme, "night");

  assert.equal(engine.setMode("day"), "day");
  assert.deepEqual(engine.getMode(), { selected: "day", resolved: "day" });
  assert.equal(engine.setMode("night"), "night");
  assert.throws(() => engine.setMode("sepia"), error =>
    error instanceof ThemeEngineError && error.code === "THEME_MODE_INVALID"
  );
});

test("auto mode follows system day/night changes and dispose removes its listener", () => {
  const { engine, listeners, mediaQuery } = fixture({ dark: false });
  assert.equal(engine.setMode("auto"), "day");
  mediaQuery.change(true);
  assert.deepEqual(engine.getMode(), { selected: "auto", resolved: "night" });
  engine.dispose();
  assert.equal(listeners.size, 0);
  mediaQuery.change(false);
  assert.equal(engine.getMode().resolved, "night");
});

test("font loading interface validates, loads, registers, and optionally applies a font", async () => {
  const { addedFonts, engine, fontCalls, values } = fixture();
  const result = await engine.loadFont({
    family: "Companion Serif",
    url: "/assets/fonts/companion.woff2",
    weight: "600"
  });

  assert.deepEqual(result, {
    family: "Companion Serif",
    weight: "600",
    style: "normal",
    applied: true
  });
  assert.equal(fontCalls.length, 1);
  assert.match(fontCalls[0].source, /companion\.woff2/);
  assert.equal(addedFonts.length, 1);
  assert.match(values.get("--theme-font-family"), /Companion Serif/);
  await assert.rejects(
    engine.loadFont({ family: "Unsafe", url: "javascript:alert(1)" }),
    error => error.code === "THEME_ASSET_URL_FORBIDDEN"
  );
});

test("background interface applies safe variables and can clear the image", () => {
  const { engine, values } = fixture();
  const result = engine.setBackground({
    imageUrl: "https://cdn.example.test/moon.webp",
    position: "center top",
    size: "cover",
    overlay: "rgba(18, 11, 27, .5)"
  });

  assert.equal(result.imageUrl, "https://cdn.example.test/moon.webp");
  assert.match(values.get("--theme-background-image"), /moon\.webp/);
  assert.equal(values.get("--theme-background-position"), "center top");
  assert.equal(values.get("--theme-background-overlay"), "rgba(18, 11, 27, .5)");
  engine.clearBackground();
  assert.equal(values.get("--theme-background-image"), "none");
  assert.throws(() => engine.setBackground({
    imageUrl: "javascript:alert(1)",
    overlay: "red; color: red"
  }));
});

test("Theme module is isolated from chat, Gateway, Memory, storage, and network calls", () => {
  const source = [
    fs.readFileSync(path.join(themeRoot, "theme-engine.js"), "utf8"),
    fs.readFileSync(path.join(themeRoot, "theme.css"), "utf8")
  ].join("\n");
  assert.doesNotMatch(
    source,
    /chat\.js|ChatRuntime|Gateway|MemoryWriter|StructuredMemoryStore|localStorage|sessionStorage|fetch\s*\(/
  );
});
