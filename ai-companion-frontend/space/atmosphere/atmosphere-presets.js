"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionAtmospherePresets = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const deepFreeze = value => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(deepFreeze);
    }
    return value;
  };

  const ATMOSPHERE_PRESETS = deepFreeze({
    moonlight: {
      lighting: {
        brightness: 0.78,
        contrast: 1.08,
        tint: "purple"
      },
      backgroundOverlay: "rgba(28, 17, 46, .36)",
      avatarEffect: "moon-glow",
      animation: "soft-stars",
      description: "🌙 月夜模式"
    },
    dawn: {
      lighting: {
        brightness: 1.08,
        contrast: 0.92,
        tint: "mist"
      },
      backgroundOverlay: "rgba(255, 244, 224, .16)",
      avatarEffect: "soft-light",
      animation: "morning-mist",
      description: "🌤️ 清晨模式"
    },
    sunset: {
      lighting: {
        brightness: 0.88,
        contrast: 0.96,
        tint: "warm"
      },
      backgroundOverlay: "rgba(171, 91, 72, .2)",
      avatarEffect: "warm-rim",
      animation: "slow-sunset",
      description: "🌇 黄昏模式"
    }
  });

  return {
    ATMOSPHERE_PRESETS
  };
});
