"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AvatarStudio = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const AVATAR_SHAPES = Object.freeze(["circle", "rounded", "square"]);
  const AVATAR_BORDERS = Object.freeze(["moon", "soft", "minimal", "none"]);
  const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
  const IMAGE_TYPE_PATTERN = /^image\/(?:png|jpeg|webp|gif|avif)$/iu;

  const DEFAULT_CHEN_AVATAR = Object.freeze({
    id: "chen",
    displayName: "沉",
    fallbackText: "沉",
    imageUrl: null,
    source: "default",
    crop: Object.freeze({ x: 50, y: 50, zoom: 1 }),
    frame: Object.freeze({ border: "moon", shape: "circle", size: 72 })
  });

  class AvatarStudioError extends Error {
    constructor(message, code = "AVATAR_STUDIO_INVALID") {
      super(message);
      this.name = "AvatarStudioError";
      this.code = code;
    }
  }

  const cloneConfig = config => ({
    id: config.id,
    displayName: config.displayName,
    fallbackText: config.fallbackText,
    imageUrl: config.imageUrl,
    source: config.source,
    crop: { ...config.crop },
    frame: { ...config.frame }
  });

  const validNumber = (value, field, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new AvatarStudioError(`${field} 必须在 ${min} 到 ${max} 之间`);
    }
    return number;
  };

  const normalizeCrop = input => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new AvatarStudioError("crop 必须是 object");
    }
    const unknown = Object.keys(input).find(field => !["x", "y", "zoom"].includes(field));
    if (unknown) throw new AvatarStudioError(`不允许 crop 字段：${unknown}`);
    return {
      x: validNumber(input.x, "crop.x", 0, 100),
      y: validNumber(input.y, "crop.y", 0, 100),
      zoom: validNumber(input.zoom, "crop.zoom", 1, 3)
    };
  };

  const normalizeFrame = input => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new AvatarStudioError("frame 必须是 object");
    }
    const unknown = Object.keys(input).find(field =>
      !["border", "shape", "size"].includes(field)
    );
    if (unknown) throw new AvatarStudioError(`不允许 frame 字段：${unknown}`);
    if (!AVATAR_BORDERS.includes(input.border)) {
      throw new AvatarStudioError("头像边框无效", "AVATAR_BORDER_INVALID");
    }
    if (!AVATAR_SHAPES.includes(input.shape)) {
      throw new AvatarStudioError("头像形状无效", "AVATAR_SHAPE_INVALID");
    }
    return {
      border: input.border,
      shape: input.shape,
      size: validNumber(input.size, "frame.size", 32, 256)
    };
  };

  class AvatarStudio {
    #createObjectURL;
    #revokeObjectURL;
    #ownedUrls = new Set();

    constructor({ createObjectURL, revokeObjectURL } = {}) {
      this.#createObjectURL = createObjectURL ||
        (file => URL.createObjectURL(file));
      this.#revokeObjectURL = revokeObjectURL ||
        (url => URL.revokeObjectURL(url));
      if (
        typeof this.#createObjectURL !== "function" ||
        typeof this.#revokeObjectURL !== "function"
      ) {
        throw new TypeError("Object URL interface 必填");
      }
    }

    defaultChen() {
      return cloneConfig(DEFAULT_CHEN_AVATAR);
    }

    fromUpload(file, {
      base = DEFAULT_CHEN_AVATAR,
      crop = base.crop,
      frame = base.frame
    } = {}) {
      if (
        !file ||
        typeof file !== "object" ||
        !IMAGE_TYPE_PATTERN.test(String(file.type || "")) ||
        !Number.isFinite(Number(file.size)) ||
        Number(file.size) <= 0 ||
        Number(file.size) > MAX_AVATAR_BYTES
      ) {
        throw new AvatarStudioError(
          "头像文件必须是 5MB 以内的受支持图片",
          "AVATAR_FILE_INVALID"
        );
      }
      const imageUrl = this.#createObjectURL(file);
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("blob:")) {
        throw new AvatarStudioError(
          "头像 Object URL 无效",
          "AVATAR_OBJECT_URL_INVALID"
        );
      }
      this.#ownedUrls.add(imageUrl);
      return {
        ...cloneConfig(base),
        imageUrl,
        source: "upload",
        crop: normalizeCrop(crop),
        frame: normalizeFrame(frame)
      };
    }

    setCrop(config, crop) {
      return { ...cloneConfig(config), crop: normalizeCrop(crop) };
    }

    setFrame(config, frame) {
      return { ...cloneConfig(config), frame: normalizeFrame(frame) };
    }

    render(documentRef, container, config) {
      if (!documentRef?.createElement || !container?.append) {
        throw new TypeError("Avatar render target 必填");
      }
      const value = cloneConfig(config);
      const avatar = documentRef.createElement("span");
      avatar.className = "companion-avatar";
      avatar.dataset.avatarId = value.id;
      avatar.dataset.avatarBorder = value.frame.border;
      avatar.dataset.avatarShape = value.frame.shape;
      avatar.style.setProperty("--avatar-size", `${value.frame.size}px`);
      avatar.style.setProperty("--avatar-crop-x", `${value.crop.x}%`);
      avatar.style.setProperty("--avatar-crop-y", `${value.crop.y}%`);
      avatar.style.setProperty("--avatar-zoom", String(value.crop.zoom));
      const fallback = documentRef.createElement("span");
      fallback.className = "companion-avatar__fallback";
      fallback.textContent = value.fallbackText;
      avatar.append(fallback);
      if (value.imageUrl) {
        const image = documentRef.createElement("img");
        image.src = value.imageUrl;
        image.alt = `${value.displayName}的头像`;
        avatar.append(image);
      }
      container.append(avatar);
      return avatar;
    }

    release(config) {
      const url = config?.source === "upload" ? config.imageUrl : null;
      if (!url || !this.#ownedUrls.has(url)) return false;
      this.#revokeObjectURL(url);
      this.#ownedUrls.delete(url);
      return true;
    }

    dispose() {
      for (const url of this.#ownedUrls) this.#revokeObjectURL(url);
      this.#ownedUrls.clear();
    }
  }

  return {
    AVATAR_BORDERS,
    AVATAR_SHAPES,
    AvatarStudio,
    AvatarStudioError,
    DEFAULT_CHEN_AVATAR,
    IMAGE_TYPE_PATTERN,
    MAX_AVATAR_BYTES,
    cloneConfig,
    normalizeCrop,
    normalizeFrame
  };
});
