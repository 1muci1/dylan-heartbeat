"use strict";

((root, factory) => {
  const presetApi = typeof module === "object" && module.exports
    ? require("./atmosphere-presets")
    : root?.CompanionAtmospherePresets;
  const api = factory(presetApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionAtmosphere = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, presetApi => {
  const { ATMOSPHERE_PRESETS = {} } = presetApi || {};
  const ATMOSPHERE_MODES = Object.freeze(["auto", "day", "night"]);

  class AtmosphereError extends Error {
    constructor(message, code = "ATMOSPHERE_INVALID") {
      super(message);
      this.name = "AtmosphereError";
      this.code = code;
    }
  }

  const clone = value => structuredClone(value);

  const toDate = value => {
    const date = value == null ? new Date() : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new AtmosphereError("氛围时间无效", "ATMOSPHERE_TIME_INVALID");
    }
    return date;
  };

  const resolvePresetName = (mode, time) => {
    if (mode === "night") return "moonlight";
    if (mode === "day") return "dawn";
    const hour = toDate(time).getHours();
    if (hour < 6 || hour >= 18) return "moonlight";
    if (hour >= 16) return "sunset";
    return "dawn";
  };

  class AtmosphereEngine {
    #mode = "auto";
    #clock;

    constructor({ mode = "auto", clock = () => new Date() } = {}) {
      if (typeof clock !== "function") throw new TypeError("Atmosphere clock 必填");
      this.#clock = clock;
      this.setMode(mode);
    }

    setMode(mode) {
      if (!ATMOSPHERE_MODES.includes(mode)) {
        throw new AtmosphereError("氛围模式无效", "ATMOSPHERE_MODE_INVALID");
      }
      this.#mode = mode;
      return this.getCurrent();
    }

    getCurrent(input = {}) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new AtmosphereError("氛围输入必须是 object");
      }
      const time = input.time ?? this.#clock();
      const name = resolvePresetName(this.#mode, time);
      const preset = ATMOSPHERE_PRESETS[name];
      if (!preset) throw new AtmosphereError("氛围预设不可用");
      return clone(preset);
    }

    apply(profile, { time } = {}) {
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        throw new AtmosphereError("Space Profile 必填", "ATMOSPHERE_PROFILE_INVALID");
      }
      return this.getCurrent({ time: time ?? this.#clock() });
    }
  }

  return {
    ATMOSPHERE_MODES,
    AtmosphereEngine,
    AtmosphereError,
    resolvePresetName
  };
});
