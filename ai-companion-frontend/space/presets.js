"use strict";

((root, factory) => {
  const presets = factory();
  if (typeof module === "object" && module.exports) module.exports = presets;
  if (root) root.CompanionSpacePresets = Object.freeze(presets);
})(typeof window !== "undefined" ? window : null, () => {
  const DEFAULT_SPACE_PRESET = Object.freeze({
    id: "purple-moon-room",
    name: "紫月小屋",
    themeMode: "night",
    background: Object.freeze({
      imageUrl: null,
      position: "center",
      size: "cover",
      overlay: "rgba(18, 11, 27, .46)"
    }),
    font: Object.freeze({
      family: null,
      url: null,
      weight: "400",
      style: "normal"
    }),
    avatar: Object.freeze({
      border: "moon",
      shape: "circle",
      size: 96,
      crop: Object.freeze({ x: 50, y: 50, zoom: 1 })
    })
  });

  const DAYLIGHT_SPACE_PRESET = Object.freeze({
    id: "soft-day-room",
    name: "柔光白昼",
    themeMode: "day",
    background: Object.freeze({
      imageUrl: null,
      position: "center",
      size: "cover",
      overlay: "rgba(255, 252, 255, .3)"
    }),
    font: DEFAULT_SPACE_PRESET.font,
    avatar: Object.freeze({
      border: "soft",
      shape: "circle",
      size: 96,
      crop: DEFAULT_SPACE_PRESET.avatar.crop
    })
  });

  const SPACE_PRESETS = Object.freeze([
    DEFAULT_SPACE_PRESET,
    DAYLIGHT_SPACE_PRESET
  ]);

  const clonePreset = preset => ({
    id: preset.id,
    name: preset.name,
    themeMode: preset.themeMode,
    background: { ...preset.background },
    font: { ...preset.font },
    avatar: {
      ...preset.avatar,
      crop: { ...preset.avatar.crop }
    }
  });

  return {
    DAYLIGHT_SPACE_PRESET,
    DEFAULT_SPACE_PRESET,
    SPACE_PRESETS,
    clonePreset
  };
});
