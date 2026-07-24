"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionSpaceProfile = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const PROFILE_FIELDS = Object.freeze([
    "id",
    "name",
    "theme",
    "avatar",
    "background",
    "font",
    "atmosphere"
  ]);
  const UPDATE_FIELDS = Object.freeze([
    "name",
    "theme",
    "avatar",
    "background",
    "font",
    "atmosphere"
  ]);
  const THEME_MODES = Object.freeze(["auto", "day", "night"]);
  const THEME_COLORS = Object.freeze(["purple", "rose", "blue", "beige"]);
  const AVATAR_TYPES = Object.freeze(["default", "upload"]);
  const AVATAR_FRAMES = Object.freeze(["moon", "soft", "minimal", "none"]);
  const BACKGROUND_POSITIONS = Object.freeze([
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "center top",
    "center bottom"
  ]);
  const SAFE_URL_PATTERN = /^(?:(?:https?:|data:image\/|blob:)|(?:\/|\.\.?\/))/iu;
  const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

  const DEFAULT_SPACE_PROFILE = Object.freeze({
    id: "default-space",
    name: "紫月小屋",
    theme: Object.freeze({ mode: "night", color: "purple" }),
    avatar: Object.freeze({
      type: "default",
      frame: "moon",
      scale: 1,
      crop: Object.freeze({ x: 50, y: 50 }),
      shape: "circle",
      size: 96
    }),
    background: Object.freeze({
      url: null,
      position: "center",
      opacity: 0.3,
      size: "cover",
      blur: 0
    }),
    font: Object.freeze({
      family: "default",
      url: null,
      weight: "400",
      style: "normal"
    }),
    atmosphere: Object.freeze({ autoDayNight: true })
  });

  class SpaceProfileError extends Error {
    constructor(message, code = "SPACE_PROFILE_INVALID") {
      super(message);
      this.name = "SpaceProfileError";
      this.code = code;
    }
  }

  const clone = value => structuredClone(value);

  const strictFields = (input, allowed, field) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new SpaceProfileError(`${field} 必须是 object`);
    }
    const unknown = Object.keys(input).find(key => !allowed.includes(key));
    if (unknown) {
      throw new SpaceProfileError(
        `${field} 不允许字段：${unknown}`,
        "SPACE_PROFILE_FIELD_FORBIDDEN"
      );
    }
  };

  const text = (value, field, maxLength) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > maxLength ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw new SpaceProfileError(`${field} 格式无效`);
    }
    return value.trim();
  };

  const number = (value, field, min, max) => {
    const result = Number(value);
    if (!Number.isFinite(result) || result < min || result > max) {
      throw new SpaceProfileError(`${field} 必须在 ${min} 到 ${max} 之间`);
    }
    return result;
  };

  const optionalUrl = value => {
    if (value == null || value === "") return null;
    const url = text(value, "资源 URL", 2048);
    if (!SAFE_URL_PATTERN.test(url)) {
      throw new SpaceProfileError(
        "资源 URL 协议不允许",
        "SPACE_PROFILE_URL_FORBIDDEN"
      );
    }
    return url;
  };

  const validateProfile = input => {
    strictFields(input, PROFILE_FIELDS, "Space Profile");
    const missing = PROFILE_FIELDS.find(field => !Object.hasOwn(input, field));
    if (missing) throw new SpaceProfileError(`Space Profile 缺少字段：${missing}`);
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!ID_PATTERN.test(id)) throw new SpaceProfileError("id 格式无效");

    strictFields(input.theme, ["mode", "color"], "theme");
    if (!THEME_MODES.includes(input.theme.mode) || !THEME_COLORS.includes(input.theme.color)) {
      throw new SpaceProfileError("theme 配置无效");
    }

    strictFields(
      input.avatar,
      ["type", "frame", "scale", "crop", "shape", "size"],
      "avatar"
    );
    strictFields(input.avatar.crop, ["x", "y"], "avatar.crop");
    if (!AVATAR_TYPES.includes(input.avatar.type) ||
        !AVATAR_FRAMES.includes(input.avatar.frame) ||
        !["circle", "rounded", "square"].includes(input.avatar.shape)) {
      throw new SpaceProfileError("avatar 配置无效");
    }

    strictFields(
      input.background,
      ["url", "position", "opacity", "size", "blur"],
      "background"
    );
    if (!BACKGROUND_POSITIONS.includes(input.background.position) ||
        !["cover", "contain", "auto"].includes(input.background.size)) {
      throw new SpaceProfileError("background 配置无效");
    }

    strictFields(input.font, ["family", "url", "weight", "style"], "font");
    if (!/^(?:normal|bold|[1-9]00)$/u.test(String(input.font.weight)) ||
        !/^(?:normal|italic|oblique)$/u.test(input.font.style)) {
      throw new SpaceProfileError("font 配置无效");
    }

    strictFields(input.atmosphere, ["autoDayNight"], "atmosphere");
    if (typeof input.atmosphere.autoDayNight !== "boolean") {
      throw new SpaceProfileError("atmosphere.autoDayNight 必须是 boolean");
    }

    return {
      id,
      name: text(input.name, "name", 120),
      theme: { mode: input.theme.mode, color: input.theme.color },
      avatar: {
        type: input.avatar.type,
        frame: input.avatar.frame,
        scale: number(input.avatar.scale, "avatar.scale", 1, 3),
        crop: {
          x: number(input.avatar.crop.x, "avatar.crop.x", 0, 100),
          y: number(input.avatar.crop.y, "avatar.crop.y", 0, 100)
        },
        shape: input.avatar.shape,
        size: number(input.avatar.size, "avatar.size", 32, 256)
      },
      background: {
        url: optionalUrl(input.background.url),
        position: input.background.position,
        opacity: number(input.background.opacity, "background.opacity", 0, 1),
        size: input.background.size,
        blur: number(input.background.blur, "background.blur", 0, 24)
      },
      font: {
        family: text(input.font.family, "font.family", 80),
        url: optionalUrl(input.font.url),
        weight: String(input.font.weight),
        style: input.font.style
      },
      atmosphere: { autoDayNight: input.atmosphere.autoDayNight }
    };
  };

  const mergePatch = (current, patch) => {
    strictFields(patch, UPDATE_FIELDS, "Space Profile patch");
    return {
      ...current,
      ...patch,
      id: current.id,
      theme: { ...current.theme, ...(patch.theme || {}) },
      avatar: {
        ...current.avatar,
        ...(patch.avatar || {}),
        crop: { ...current.avatar.crop, ...(patch.avatar?.crop || {}) }
      },
      background: { ...current.background, ...(patch.background || {}) },
      font: { ...current.font, ...(patch.font || {}) },
      atmosphere: { ...current.atmosphere, ...(patch.atmosphere || {}) }
    };
  };

  class SpaceProfileManager {
    #defaultProfile;
    #profiles = new Map();
    #activeId;
    #adapter;

    constructor({
      defaultProfile = DEFAULT_SPACE_PROFILE,
      persistenceAdapter = null
    } = {}) {
      this.#defaultProfile = validateProfile(defaultProfile);
      this.#profiles.set(this.#defaultProfile.id, this.#defaultProfile);
      this.#activeId = this.#defaultProfile.id;
      this.setPersistenceAdapter(persistenceAdapter);
    }

    setPersistenceAdapter(adapter) {
      if (adapter != null &&
          (typeof adapter.load !== "function" || typeof adapter.save !== "function")) {
        throw new TypeError("Persistence Adapter 必须实现 load/save");
      }
      this.#adapter = adapter;
      return Boolean(adapter);
    }

    create(profile) {
      const value = validateProfile(profile);
      if (this.#profiles.has(value.id)) {
        throw new SpaceProfileError(
          "Space Profile 已存在",
          "SPACE_PROFILE_ALREADY_EXISTS"
        );
      }
      this.#profiles.set(value.id, value);
      this.#activeId = value.id;
      return clone(value);
    }

    get(id) {
      const value = this.#profiles.get(String(id || "").trim());
      return value ? clone(value) : null;
    }

    update(id, patch) {
      const current = this.#profiles.get(String(id || "").trim());
      if (!current) {
        throw new SpaceProfileError(
          "Space Profile 不存在",
          "SPACE_PROFILE_NOT_FOUND"
        );
      }
      const updated = validateProfile(mergePatch(current, patch));
      this.#profiles.set(updated.id, updated);
      this.#activeId = updated.id;
      return clone(updated);
    }

    snapshot() {
      return clone(this.#profiles.get(this.#activeId));
    }

    reset() {
      const restored = validateProfile(this.#defaultProfile);
      this.#profiles = new Map([[restored.id, restored]]);
      this.#activeId = restored.id;
      return clone(restored);
    }

    async load() {
      if (!this.#adapter) return null;
      const external = await this.#adapter.load();
      if (external == null) return null;
      const value = validateProfile(external);
      this.#profiles.set(value.id, value);
      this.#activeId = value.id;
      return clone(value);
    }

    async save() {
      if (!this.#adapter) return false;
      await this.#adapter.save(this.snapshot());
      return true;
    }
  }

  return {
    AVATAR_FRAMES,
    DEFAULT_SPACE_PROFILE,
    PROFILE_FIELDS,
    SpaceProfileError,
    SpaceProfileManager,
    THEME_COLORS,
    UPDATE_FIELDS,
    mergePatch,
    validateProfile
  };
});
