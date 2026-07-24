"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionSpacePresetDefinitions = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const freeze = value => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };
  const BACKGROUNDS = freeze({
    morningMist: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='600'%3E%3Cdefs%3E%3ClinearGradient id='g' y2='1'%3E%3Cstop stop-color='%23dce9ef'/%3E%3Cstop offset='1' stop-color='%23f8f2ec'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='900' height='600' fill='url(%23g)'/%3E%3Ccircle cx='690' cy='130' r='75' fill='%23fff6dc' opacity='.75'/%3E%3C/svg%3E",
    deepSpace: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='600'%3E%3Crect width='900' height='600' fill='%230d1024'/%3E%3Cg fill='%23d9e7ff'%3E%3Ccircle cx='110' cy='90' r='2'/%3E%3Ccircle cx='270' cy='210' r='3'/%3E%3Ccircle cx='480' cy='75' r='2'/%3E%3Ccircle cx='760' cy='180' r='3'/%3E%3Ccircle cx='650' cy='410' r='2'/%3E%3Ccircle cx='180' cy='470' r='2'/%3E%3C/g%3E%3C/svg%3E",
    classicStudy: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='600'%3E%3Crect width='900' height='600' fill='%23d8c4a1'/%3E%3Cg fill='%23846a4b' opacity='.72'%3E%3Crect x='80' y='110' width='740' height='18'/%3E%3Crect x='80' y='300' width='740' height='18'/%3E%3Crect x='120' y='55' width='80' height='245'/%3E%3Crect x='260' y='80' width='105' height='220'/%3E%3Crect x='620' y='65' width='120' height='235'/%3E%3C/g%3E%3C/svg%3E"
  });

  const makeProfile = ({
    mode,
    color,
    frame,
    background,
    font,
    autoDayNight = false
  }) => ({
    theme: { mode, color },
    avatar: {
      type: "default",
      frame,
      scale: 1,
      crop: { x: 50, y: 50 },
      shape: "circle",
      size: 96
    },
    background: {
      url: background.url || null,
      position: "center",
      opacity: background.opacity,
      size: "cover",
      blur: background.blur
    },
    font: {
      family: font,
      url: null,
      weight: "400",
      style: "normal"
    },
    atmosphere: { autoDayNight }
  });

  const BUILTIN_SPACE_PRESETS = freeze([
    {
      id: "purple-moon-room",
      name: "紫月小屋",
      description: "紫月夜色、月光头像边框与柔和中文排版。",
      profile: makeProfile({
        mode: "night",
        color: "purple",
        frame: "moon",
        background: { url: null, opacity: 0.3, blur: 0 },
        font: "default"
      })
    },
    {
      id: "morning-mist-room",
      name: "晨雾房间",
      description: "浅色晨光、柔和边框与安静的清晨氛围。",
      profile: makeProfile({
        mode: "day",
        color: "blue",
        frame: "soft",
        background: { url: BACKGROUNDS.morningMist, opacity: 0.18, blur: 7 },
        font: "rounded"
      })
    },
    {
      id: "deep-space-room",
      name: "深空房间",
      description: "深色星空感、高对比排版与稳定的夜间氛围。",
      profile: makeProfile({
        mode: "night",
        color: "blue",
        frame: "minimal",
        background: { url: BACKGROUNDS.deepSpace, opacity: 0.56, blur: 0 },
        font: "Inter"
      })
    },
    {
      id: "classic-study-room",
      name: "古典书房",
      description: "米色书房气质、古典中文字体与简洁头像。",
      profile: makeProfile({
        mode: "day",
        color: "beige",
        frame: "minimal",
        background: { url: BACKGROUNDS.classicStudy, opacity: 0.22, blur: 2 },
        font: "Noto Serif SC"
      })
    }
  ]);

  return {
    BACKGROUNDS,
    BUILTIN_SPACE_PRESETS
  };
});
