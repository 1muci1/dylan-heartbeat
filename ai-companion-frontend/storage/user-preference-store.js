"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionUserPreferences = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const STORAGE_KEY = "xinban-user-preferences-v1";
  const CHANGE_EVENT = "user-preferences-change";
  const VERSION = 1;
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const DEFAULTS = Object.freeze({
    version: VERSION,
    theme: Object.freeze({ mode: "night", preset: "purple" }),
    background: Object.freeze({ url: null, position: "center", size: "cover", blur: 0, opacity: 0.3 }),
    avatar: Object.freeze({ source: "default", crop: Object.freeze({ x: 50, y: 50 }), scale: 1, border: "moon", imageData: null, userAvatar: null, chenAvatar: null }),
    chatBackground: Object.freeze({ imageData: null, position: "center", size: "cover", overlay: 0.35 }),
    space: Object.freeze({ profileId: "default-space", presetId: null, profile: null }),
    model: Object.freeze({ selectedModelId: null }),
    ui: Object.freeze({})
  });
  const clone = value => JSON.parse(JSON.stringify(value));
  const isObject = value => value && typeof value === "object" && !Array.isArray(value);
  const isPersistentAvatarImage = value => {
    const image = String(value || "").trim();
    return /^data:image\//iu.test(image) || image.startsWith("https://") || image.startsWith("/");
  };
  const firstPersistentImage = candidates => candidates.find(isPersistentAvatarImage) || null;
  const getChenAvatarImage = preferences => {
    const avatar = isObject(preferences?.avatar) ? preferences.avatar : {};
    const chen = isObject(avatar.chenAvatar) ? avatar.chenAvatar : {};
    const candidates = [
      chen.imageData,
      chen.dataUrl,
      chen.imageUrl,
      chen.url,
      chen.src,
      avatar.imageData
    ];
    return firstPersistentImage(candidates);
  };
  const getUserAvatarImage = preferences => {
    const avatar = isObject(preferences?.avatar) ? preferences.avatar : {};
    const user = isObject(avatar.userAvatar) ? avatar.userAvatar : {};
    const me = isObject(avatar.meAvatar) ? avatar.meAvatar : {};
    const owner = isObject(avatar.ownerAvatar) ? avatar.ownerAvatar : {};
    return firstPersistentImage([
      user.imageData,
      user.dataUrl,
      user.imageUrl,
      user.url,
      user.src,
      me.imageData,
      owner.imageData
    ]);
  };
  const finiteNumber = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const getChatBackground = preferences => {
    const sources = [
      preferences?.chatBackground,
      preferences?.background,
      preferences?.space?.profile?.background
    ].filter(isObject);
    const source = sources.find(candidate => firstPersistentImage([
      candidate.imageData,
      candidate.dataUrl,
      candidate.imageUrl,
      candidate.url,
      candidate.src
    ])) || sources[0] || {};
    const image = firstPersistentImage([
      source.imageData,
      source.dataUrl,
      source.imageUrl,
      source.url,
      source.src
    ]);
    return {
      image,
      color: typeof source.color === "string" && source.color.trim() ? source.color.trim() : null,
      overlay: finiteNumber(source.overlay ?? source.opacity, image ? 0.35 : 0, 0, 1),
      blur: finiteNumber(source.blur, 0, 0, 40),
      opacity: finiteNumber(source.imageOpacity, 1, 0, 1),
      position: typeof source.position === "string" && source.position.trim() ? source.position.trim() : "center",
      size: typeof source.size === "string" && source.size.trim() ? source.size.trim() : "cover"
    };
  };
  const forbidden = /^(?:token|password|apiKey|api_key|authorization|bearer|secret|chat|messages|memory|identity|gatewaySecret)$/iu;
  const stripSensitive = value => {
    if (typeof value === "string" && value.startsWith("blob:")) return null;
    if (Array.isArray(value)) return value.map(stripSensitive);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !forbidden.test(key))
      .map(([key, child]) => [key, stripSensitive(child)]));
  };
  const merge = (base, patch) => {
    if (!isObject(patch)) return clone(base);
    const output = isObject(base) ? clone(base) : {};
    Object.entries(patch).forEach(([key, value]) => {
      if (forbidden.test(key)) return;
      output[key] = isObject(value) && isObject(output[key]) ? merge(output[key], value) : clone(value);
    });
    return output;
  };
  const normalize = value => {
    const safe = stripSensitive(value);
    const result = merge(DEFAULTS, isObject(safe) ? safe : {});
    result.version = VERSION;
    if (!isObject(result.theme)) result.theme = clone(DEFAULTS.theme);
    if (!isObject(result.avatar)) result.avatar = clone(DEFAULTS.avatar);
    if (!isObject(result.chatBackground)) result.chatBackground = clone(DEFAULTS.chatBackground);
    if (!isObject(result.space)) result.space = clone(DEFAULTS.space);
    if (!isObject(result.model)) result.model = clone(DEFAULTS.model);
    if (!isObject(result.background)) result.background = clone(DEFAULTS.background);
    if (!isObject(result.ui)) result.ui = {};
    return result;
  };

  class UserPreferenceStore {
    #storage;
    #key;
    #maxImageBytes;
    constructor({ storage, key = STORAGE_KEY, maxImageBytes = MAX_IMAGE_BYTES, eventTarget } = {}) {
      this.#storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      this.#key = key;
      this.#maxImageBytes = maxImageBytes;
      this.eventTarget = eventTarget === undefined
        ? (typeof window !== "undefined" ? window : null)
        : eventTarget;
    }
    loadSync() {
      if (!this.#storage) return clone(DEFAULTS);
      try { return normalize(JSON.parse(this.#storage.getItem(this.#key) || "null")); } catch { return clone(DEFAULTS); }
    }
    async load() { return this.loadSync(); }
    save(patch) {
      const next = normalize(merge(this.loadSync(), patch));
      if (this.#storage) {
        try { this.#storage.setItem(this.#key, JSON.stringify(next)); } catch { /* storage unavailable */ }
      }
      this.#notify(next);
      return clone(next);
    }
    reset() {
      if (this.#storage) {
        try { this.#storage.removeItem(this.#key); } catch { /* storage unavailable */ }
      }
      this.#notify(DEFAULTS);
      return clone(DEFAULTS);
    }
    clear() { return this.reset(); }
    saveTheme({ mode, preset } = {}) { return this.save({ theme: { mode, preset } }); }
    saveAvatar(value = {}, target = "chen") {
      if (value.imageData && this.imageBytes(value.imageData) > this.#maxImageBytes) {
        const error = new Error("头像图片超过本地保存大小限制（2MB）");
        error.code = "PREFERENCE_IMAGE_TOO_LARGE";
        throw error;
      }
      const key = target === "user" ? "userAvatar" : "chenAvatar";
      return this.save({ avatar: { ...value, [key]: value } });
    }
    getAvatar(target = "chen") {
      const value = this.loadSync().avatar;
      return clone(value[target === "user" ? "userAvatar" : "chenAvatar"] || value);
    }
    getChenAvatarImage(preferences = this.loadSync()) {
      return getChenAvatarImage(preferences);
    }
    getUserAvatarImage(preferences = this.loadSync()) {
      return getUserAvatarImage(preferences);
    }
    getChatBackground(preferences = this.loadSync()) {
      return getChatBackground(preferences);
    }
    saveChatBackground(value = {}) {
      if (value.imageData && this.imageBytes(value.imageData) > this.#maxImageBytes) {
        const error = new Error("聊天背景图片超过本地保存大小限制（2MB）");
        error.code = "PREFERENCE_IMAGE_TOO_LARGE";
        throw error;
      }
      return this.save({ chatBackground: value });
    }
    saveSpace(value = {}) { return this.save({ space: value }); }
    saveBackground(value = {}) { return this.save({ background: value }); }
    saveModel(selectedModelId) { return this.save({ model: { selectedModelId: String(selectedModelId || "") } }); }
    saveUi(value = {}) { return this.save({ ui: value }); }
    imageBytes(dataUrl) {
      const value = String(dataUrl || "");
      if (!value.startsWith("data:image/")) return 0;
      const payload = value.slice(value.indexOf(",") + 1).replace(/\s/g, "");
      return Math.floor(payload.length * 3 / 4) - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
    }
    subscribe(listener) {
      if (typeof listener !== "function" || !this.eventTarget?.addEventListener) return () => {};
      const onChange = event => listener(clone(event?.detail?.preferences || this.loadSync()));
      const onStorage = event => {
        if (event?.key === this.#key) listener(this.loadSync());
      };
      this.eventTarget.addEventListener(CHANGE_EVENT, onChange);
      this.eventTarget.addEventListener("storage", onStorage);
      return () => {
        this.eventTarget?.removeEventListener?.(CHANGE_EVENT, onChange);
        this.eventTarget?.removeEventListener?.("storage", onStorage);
      };
    }
    #notify(preferences) {
      if (!this.eventTarget?.dispatchEvent) return;
      const EventConstructor = this.eventTarget.CustomEvent ||
        (typeof CustomEvent !== "undefined" ? CustomEvent : null);
      if (!EventConstructor) return;
      this.eventTarget.dispatchEvent(new EventConstructor(CHANGE_EVENT, {
        detail: { preferences: clone(preferences) }
      }));
    }
    adapter({ profileId = "default-space" } = {}) {
      return {
        loadSync: () => this.loadSync().space.profile?.id === profileId ? this.loadSync().space.profile : null,
        load: () => Promise.resolve(this.loadSync().space.profile?.id === profileId ? this.loadSync().space.profile : null),
        save: profile => { this.saveSpace({ profileId: profile.id, profile }); return true; }
      };
    }
  }
  return {
    CHANGE_EVENT,
    DEFAULTS,
    MAX_IMAGE_BYTES,
    STORAGE_KEY,
    UserPreferenceStore,
    getChatBackground,
    getChenAvatarImage,
    getUserAvatarImage,
    isPersistentAvatarImage,
    normalize,
    stripSensitive
  };
});
