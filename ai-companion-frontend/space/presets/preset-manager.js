"use strict";

((root, factory) => {
  const profileApi = typeof module === "object" && module.exports
    ? require("../space-profile")
    : root?.CompanionSpaceProfile;
  const presetApi = typeof module === "object" && module.exports
    ? require("./presets")
    : root?.CompanionSpacePresetDefinitions;
  const api = factory(profileApi, presetApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionSpacePresetManager = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, (profileApi, presetApi) => {
  const { validateProfile } = profileApi || {};
  const { BUILTIN_SPACE_PRESETS = [] } = presetApi || {};
  const FORBIDDEN_FIELDS = Object.freeze([
    "memory",
    "identity",
    "chat",
    "gateway",
    "token",
    "secret"
  ]);
  const CUSTOM_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;

  class SpacePresetError extends Error {
    constructor(message, code = "SPACE_PRESET_INVALID") {
      super(message);
      this.name = "SpacePresetError";
      this.code = code;
    }
  }

  const clone = value => structuredClone(value);

  const findForbidden = (value, path = "profile") => {
    if (!value || typeof value !== "object") return null;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.includes(key.toLowerCase())) return `${path}.${key}`;
      const nested = findForbidden(child, `${path}.${key}`);
      if (nested) return nested;
    }
    return null;
  };

  const profileFields = profile => ({
    theme: clone(profile.theme),
    avatar: clone(profile.avatar),
    background: clone(profile.background),
    font: clone(profile.font),
    atmosphere: clone(profile.atmosphere)
  });

  class SpacePresetManager {
    #builtins;
    #custom = new Map();

    constructor({ builtins = BUILTIN_SPACE_PRESETS } = {}) {
      if (typeof validateProfile !== "function") {
        throw new TypeError("Space Profile schema 必填");
      }
      this.#builtins = clone(builtins);
    }

    list() {
      return clone([
        ...this.#builtins,
        ...this.#custom.values()
      ]);
    }

    get(id) {
      const safeId = String(id || "").trim();
      const preset = this.#builtins.find(item => item.id === safeId) ||
        this.#custom.get(safeId);
      return preset ? clone(preset) : null;
    }

    apply(id, spaceProfileManager) {
      if (!spaceProfileManager?.snapshot || !spaceProfileManager?.update) {
        throw new TypeError("Space Profile Manager 必填");
      }
      const preset = this.get(id);
      if (!preset) {
        throw new SpacePresetError("空间预设不存在", "SPACE_PRESET_NOT_FOUND");
      }
      const current = spaceProfileManager.snapshot();
      return spaceProfileManager.update(current.id, {
        name: preset.name,
        ...clone(preset.profile)
      });
    }

    createCustom(profile) {
      const forbidden = findForbidden(profile);
      if (forbidden) {
        throw new SpacePresetError(
          `自定义预设不允许字段：${forbidden}`,
          "SPACE_PRESET_FIELD_FORBIDDEN"
        );
      }
      let validated;
      try {
        validated = validateProfile(profile);
      } catch (error) {
        throw new SpacePresetError(
          `自定义预设未通过 Space Profile schema：${error.message}`,
          "SPACE_PRESET_PROFILE_INVALID"
        );
      }
      if (!CUSTOM_ID_PATTERN.test(validated.id)) {
        throw new SpacePresetError("自定义预设 id 无效");
      }
      if (this.#builtins.some(item => item.id === validated.id) ||
          this.#custom.has(validated.id)) {
        throw new SpacePresetError(
          "空间预设 id 已存在",
          "SPACE_PRESET_ALREADY_EXISTS"
        );
      }
      const preset = {
        id: validated.id,
        name: validated.name,
        description: "用户创建的当前运行期空间预设。",
        profile: profileFields(validated)
      };
      this.#custom.set(preset.id, preset);
      return clone(preset);
    }

    removeCustom(id) {
      const safeId = String(id || "").trim();
      if (this.#builtins.some(item => item.id === safeId)) {
        throw new SpacePresetError(
          "内置空间预设不可删除",
          "SPACE_PRESET_BUILTIN_IMMUTABLE"
        );
      }
      return this.#custom.delete(safeId);
    }
  }

  return {
    FORBIDDEN_FIELDS,
    SpacePresetError,
    SpacePresetManager,
    findForbidden
  };
});
