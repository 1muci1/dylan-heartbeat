"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionSpaceStudio = Object.freeze(api);
  if (typeof document !== "undefined") api.mount(document, root);
})(typeof window !== "undefined" ? window : null, () => {
  const IMAGE_TYPE_PATTERN = /^image\/(?:png|jpeg|webp|gif|avif)$/iu;
  const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
  const readFileDataUrl = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });

  const overlayFor = profile => profile.theme.mode === "day"
    ? `rgba(255, 252, 255, ${profile.background.opacity})`
    : `rgba(18, 11, 27, ${profile.background.opacity})`;

  class SpaceStudioController {
    #profiles;
    #theme;
    #avatars;
    #presets;
    #atmosphere;
    #createObjectURL;
    #revokeObjectURL;
    #avatar;
    #backgroundUrl = null;
    #preferences;

    constructor({
      profileManager,
      themeEngine,
      avatarStudio,
      presetManager = null,
      atmosphereEngine = null,
      createObjectURL,
      revokeObjectURL,
      persistenceAdapter = null
    } = {}) {
      if (!profileManager?.snapshot || !profileManager?.update || !profileManager?.reset) {
        throw new TypeError("Space Profile Manager 必填");
      }
      if (!themeEngine?.setMode || !themeEngine?.setAccent) {
        throw new TypeError("Theme Engine 必填");
      }
      if (!avatarStudio?.defaultChen || !avatarStudio?.setCrop) {
        throw new TypeError("Avatar Studio 必填");
      }
      this.#profiles = profileManager;
      this.#theme = themeEngine;
      this.#avatars = avatarStudio;
      this.#presets = presetManager;
      this.#atmosphere = atmosphereEngine;
      this.#createObjectURL = createObjectURL;
      this.#revokeObjectURL = revokeObjectURL;
      this.#preferences = persistenceAdapter;
      this.#avatar = avatarStudio.defaultChen();
      this.applyProfile();
    }

    snapshot() {
      return this.#profiles.snapshot();
    }

    getAvatar() {
      return {
        ...this.#avatar,
        crop: { ...this.#avatar.crop },
        frame: { ...this.#avatar.frame }
      };
    }

    listPresets() {
      return this.#presets?.list?.() || [];
    }

    getPreset(id) {
      return this.#presets?.get?.(id) || null;
    }

    setAtmosphereMode(mode) {
      if (!this.#atmosphere?.setMode) throw new TypeError("Atmosphere Engine 必填");
      this.#atmosphere.setMode(mode);
      return this.#atmosphere.apply(this.snapshot());
    }

    getAtmosphere() {
      return this.#atmosphere?.apply?.(this.snapshot()) || null;
    }

    async save() {
      return this.#profiles.save();
    }

    async persistAvatarUpload(file) {
      const dataUrl = await readFileDataUrl(file);
      this.#avatars.save(this.#avatar, { imageData: dataUrl });
      return dataUrl;
    }

    applyPreset(id) {
      if (!this.#presets?.apply) throw new TypeError("Space Preset Manager 必填");
      if (this.#avatar.source === "upload") this.#avatars.release(this.#avatar);
      if (this.#backgroundUrl) this.#revokeObjectURL?.(this.#backgroundUrl);
      this.#backgroundUrl = null;
      const profile = this.#presets.apply(id, this.#profiles);
      this.#avatar = this.#avatars.defaultChen();
      this.#avatar = this.#avatars.setCrop(this.#avatar, {
        x: profile.avatar.crop.x,
        y: profile.avatar.crop.y,
        zoom: profile.avatar.scale
      });
      this.#avatar = this.#avatars.setFrame(this.#avatar, {
        border: profile.avatar.frame,
        shape: profile.avatar.shape,
        size: profile.avatar.size
      });
      this.applyProfile();
      return profile;
    }

    applyProfile() {
      const profile = this.snapshot();
      this.#theme.setMode(profile.theme.mode);
      this.#theme.setAccent(profile.theme.color);
      this.#atmosphere?.apply?.(profile);
      if (profile.background.url) {
        this.#theme.setBackground({
          imageUrl: profile.background.url,
          position: profile.background.position,
          size: profile.background.size,
          overlay: overlayFor(profile),
          blur: profile.background.blur
        });
      } else {
        this.#theme.clearBackground();
      }
      if (profile.font.url) {
        return this.#theme.loadFont({ ...profile.font });
      }
      this.#theme.setFontFamily(profile.font.family);
      return profile;
    }

    setTheme({ mode, color }) {
      const current = this.snapshot();
      const profile = this.#profiles.update(current.id, {
        theme: {
          mode: mode ?? current.theme.mode,
          color: color ?? current.theme.color
        },
        atmosphere: {
          autoDayNight: (mode ?? current.theme.mode) === "auto"
        }
      });
      this.#theme.setMode(profile.theme.mode);
      this.#theme.setAccent(profile.theme.color);
      return profile;
    }

    setAvatarFile(file) {
      if (this.#avatar.source === "upload") this.#avatars.release(this.#avatar);
      const profile = this.snapshot();
      this.#avatar = this.#avatars.fromUpload(file, {
        base: this.#avatars.defaultChen(),
        crop: {
          x: profile.avatar.crop.x,
          y: profile.avatar.crop.y,
          zoom: profile.avatar.scale
        },
        frame: {
          border: profile.avatar.frame,
          shape: profile.avatar.shape,
          size: profile.avatar.size
        }
      });
      return this.#profiles.update(profile.id, { avatar: { type: "upload" } });
    }

    setAvatarAppearance({ scale, x, y, frame }) {
      const current = this.snapshot();
      const profile = this.#profiles.update(current.id, {
        avatar: {
          scale: scale ?? current.avatar.scale,
          frame: frame ?? current.avatar.frame,
          crop: {
            x: x ?? current.avatar.crop.x,
            y: y ?? current.avatar.crop.y
          }
        }
      });
      this.#avatar = this.#avatars.setCrop(this.#avatar, {
        x: profile.avatar.crop.x,
        y: profile.avatar.crop.y,
        zoom: profile.avatar.scale
      });
      this.#avatar = this.#avatars.setFrame(this.#avatar, {
        border: profile.avatar.frame,
        shape: profile.avatar.shape,
        size: profile.avatar.size
      });
      return profile;
    }

    setBackgroundFile(file) {
      if (!file || !IMAGE_TYPE_PATTERN.test(String(file.type || "")) ||
          !Number.isFinite(Number(file.size)) || Number(file.size) <= 0 ||
          Number(file.size) > MAX_BACKGROUND_BYTES ||
          typeof this.#createObjectURL !== "function") {
        throw new TypeError("背景文件必须是 10MB 以内的受支持图片");
      }
      const url = this.#createObjectURL(file);
      if (typeof url !== "string" || !url.startsWith("blob:")) {
        throw new TypeError("背景 Object URL 无效");
      }
      if (this.#backgroundUrl) this.#revokeObjectURL?.(this.#backgroundUrl);
      this.#backgroundUrl = url;
      const current = this.snapshot();
      const profile = this.#profiles.update(current.id, { background: { url } });
      this.#applyBackground(profile);
      return profile;
    }

    async persistBackgroundUpload(file) {
      const dataUrl = await readFileDataUrl(file);
      this.#preferences?.saveBackground?.({ url: dataUrl });
      return dataUrl;
    }

    setBackgroundAppearance({ opacity, blur }) {
      const current = this.snapshot();
      const profile = this.#profiles.update(current.id, {
        background: {
          opacity: opacity ?? current.background.opacity,
          blur: blur ?? current.background.blur
        }
      });
      if (profile.background.url) this.#applyBackground(profile);
      return profile;
    }

    clearBackground() {
      if (this.#backgroundUrl) this.#revokeObjectURL?.(this.#backgroundUrl);
      this.#backgroundUrl = null;
      const current = this.snapshot();
      const profile = this.#profiles.update(current.id, { background: { url: null } });
      this.#theme.clearBackground();
      return profile;
    }

    async setFont({ family, url = null }) {
      const current = this.snapshot();
      const nextFamily = family || "default";
      let result;
      if (url) {
        result = await this.#theme.loadFont({ family: nextFamily, url });
      } else {
        result = this.#theme.setFontFamily(nextFamily);
      }
      return this.#profiles.update(current.id, {
        font: {
          family: result.family,
          url,
          weight: result.weight || "400",
          style: result.style || "normal"
        }
      });
    }

    reset() {
      if (this.#avatar.source === "upload") this.#avatars.release(this.#avatar);
      if (this.#backgroundUrl) this.#revokeObjectURL?.(this.#backgroundUrl);
      this.#backgroundUrl = null;
      this.#avatar = this.#avatars.defaultChen();
      const profile = this.#profiles.reset();
      this.applyProfile();
      return profile;
    }

    #applyBackground(profile) {
      this.#theme.setBackground({
        imageUrl: profile.background.url,
        position: profile.background.position,
        size: profile.background.size,
        overlay: overlayFor(profile),
        blur: profile.background.blur
      });
    }

    dispose() {
      if (this.#backgroundUrl) this.#revokeObjectURL?.(this.#backgroundUrl);
      this.#backgroundUrl = null;
      this.#avatars.dispose?.();
      this.#theme.dispose?.();
    }
  }

  const mount = (documentRef, windowRef) => {
    const ThemeEngine = windowRef?.CompanionTheme?.ThemeEngine;
    const AvatarStudio = windowRef?.AvatarStudio?.AvatarStudio;
    const SpaceProfileManager = windowRef?.CompanionSpaceProfile?.SpaceProfileManager;
    const SpacePresetManager =
      windowRef?.CompanionSpacePresetManager?.SpacePresetManager;
    const AtmosphereEngine = windowRef?.CompanionAtmosphere?.AtmosphereEngine;
    const PreferenceStore = windowRef?.CompanionUserPreferences?.UserPreferenceStore;
    if (!ThemeEngine || !AvatarStudio || !SpaceProfileManager ||
        !SpacePresetManager || !AtmosphereEngine) return null;

    const preferences = PreferenceStore ? new PreferenceStore() : null;
    const themeEngine = new ThemeEngine({
      documentRef,
      persistenceAdapter: preferences,
      matchMedia: windowRef.matchMedia?.bind(windowRef),
      fontFaceFactory: windowRef.FontFace
        ? (family, source, descriptors) => new windowRef.FontFace(family, source, descriptors)
        : undefined
    });
    const avatarStudio = new AvatarStudio({
      persistenceAdapter: preferences,
      createObjectURL: windowRef.URL.createObjectURL.bind(windowRef.URL),
      revokeObjectURL: windowRef.URL.revokeObjectURL.bind(windowRef.URL)
    });
    const controller = new SpaceStudioController({
      profileManager: new SpaceProfileManager({ persistenceAdapter: preferences?.adapter?.() }),
      presetManager: new SpacePresetManager(),
      atmosphereEngine: new AtmosphereEngine(),
      themeEngine,
      avatarStudio,
      persistenceAdapter: preferences,
      createObjectURL: windowRef.URL.createObjectURL.bind(windowRef.URL),
      revokeObjectURL: windowRef.URL.revokeObjectURL.bind(windowRef.URL)
    });
    const select = selector => documentRef.querySelector(selector);
    const status = (message, error = false) => {
      const node = select("[data-studio-status]");
      if (!node) return;
      node.textContent = message;
      node.classList.toggle("is-error", error);
    };
    const render = () => {
      const profile = controller.snapshot();
      const fields = {
        "[data-profile-name]": profile.name,
        "[data-profile-theme]": `${profile.theme.mode} · ${profile.theme.color}`,
        "[data-profile-avatar]": `${profile.avatar.type} · ${profile.avatar.frame}`,
        "[data-profile-background]": profile.background.url ? "已设置" : "默认",
        "[data-profile-font]": profile.font.family
      };
      for (const [selector, value] of Object.entries(fields)) {
        const node = select(selector);
        if (node) node.textContent = value;
      }
      const controls = {
        "[data-theme-mode]": profile.theme.mode,
        "[data-theme-color]": profile.theme.color,
        "[data-background-opacity]": profile.background.opacity,
        "[data-background-blur]": profile.background.blur,
        "[data-avatar-scale]": profile.avatar.scale,
        "[data-avatar-x]": profile.avatar.crop.x,
        "[data-avatar-y]": profile.avatar.crop.y,
        "[data-avatar-frame]": profile.avatar.frame,
        "[data-font-family]": profile.font.family
      };
      for (const [selector, value] of Object.entries(controls)) {
        const node = select(selector);
        if (node) node.value = String(value);
      }
      const stage = select("[data-avatar-preview]");
      if (stage) {
        stage.replaceChildren();
        avatarStudio.render(documentRef, stage, controller.getAvatar());
      }
      const atmosphere = controller.getAtmosphere();
      const atmosphereStatus = select("[data-atmosphere-status]");
      if (atmosphereStatus) atmosphereStatus.textContent = atmosphere?.description || "";
      const atmospherePreview = select("[data-space-preview]");
      if (atmospherePreview && atmosphere) {
        atmospherePreview.dataset.avatarEffect = atmosphere.avatarEffect;
        atmospherePreview.dataset.atmosphereAnimation = atmosphere.animation;
        atmospherePreview.style.setProperty(
          "--studio-atmosphere-overlay",
          atmosphere.backgroundOverlay
        );
        atmospherePreview.style.setProperty(
          "--studio-atmosphere-brightness",
          String(atmosphere.lighting.brightness)
        );
        atmospherePreview.style.setProperty(
          "--studio-atmosphere-contrast",
          String(atmosphere.lighting.contrast)
        );
      }
      const presetId = select("[data-preset-select]")?.value;
      const preset = controller.getPreset(presetId);
      const description = select("[data-preset-description]");
      if (description) description.textContent = preset?.description || "";
      const preview = select("[data-preset-preview]");
      if (preview) {
        preview.replaceChildren();
        if (preset) {
          [
            preset.profile.theme.mode,
            preset.profile.theme.color,
            preset.profile.avatar.frame,
            preset.profile.font.family
          ].forEach(value => {
            const badge = documentRef.createElement("span");
            badge.textContent = value;
            preview.append(badge);
          });
        }
      }
    };
    const safely = action => {
      try {
        const result = action();
        if (result?.then) {
          result.then(() => controller.save()).then(() => { render(); status("空间配置已更新"); })
            .catch(error => status(error.message, true));
        } else {
          controller.save().catch(error => status(error.message, true));
          render();
          status("空间配置已更新");
        }
      } catch (error) {
        status(error.message, true);
      }
    };

    select("[data-theme-mode]")?.addEventListener("change", event =>
      safely(() => controller.setTheme({ mode: event.target.value })));
    select("[data-theme-color]")?.addEventListener("change", event =>
      safely(() => controller.setTheme({ color: event.target.value })));
    select("[data-background-upload]")?.addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (file) safely(async () => { controller.setBackgroundFile(file); await controller.persistBackgroundUpload(file); });
    });
    select("[data-background-clear]")?.addEventListener("click", () =>
      safely(() => controller.clearBackground()));
    const updateBackground = () => safely(() => controller.setBackgroundAppearance({
      opacity: Number(select("[data-background-opacity]")?.value),
      blur: Number(select("[data-background-blur]")?.value)
    }));
    select("[data-background-opacity]")?.addEventListener("input", updateBackground);
    select("[data-background-blur]")?.addEventListener("input", updateBackground);
    select("[data-avatar-upload]")?.addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (file) safely(async () => { controller.setAvatarFile(file); await controller.persistAvatarUpload(file); });
    });
    const updateAvatar = () => safely(() => controller.setAvatarAppearance({
      scale: Number(select("[data-avatar-scale]")?.value),
      x: Number(select("[data-avatar-x]")?.value),
      y: Number(select("[data-avatar-y]")?.value),
      frame: select("[data-avatar-frame]")?.value
    }));
    ["[data-avatar-scale]", "[data-avatar-x]", "[data-avatar-y]"].forEach(selector =>
      select(selector)?.addEventListener("input", updateAvatar));
    select("[data-avatar-frame]")?.addEventListener("change", updateAvatar);
    select("[data-font-apply]")?.addEventListener("click", () => safely(() => {
      const customFamily = select("[data-font-custom-family]")?.value.trim();
      const customUrl = select("[data-font-custom-url]")?.value.trim();
      const family = customFamily || select("[data-font-family]")?.value;
      return controller.setFont({ family, url: customUrl || null });
    }));
    select("[data-profile-reset]")?.addEventListener("click", () =>
      safely(() => controller.reset()));
    select("[data-atmosphere-mode]")?.addEventListener("change", event =>
      safely(() => controller.setAtmosphereMode(event.target.value)));

    const presetSelect = select("[data-preset-select]");
    controller.listPresets().forEach(preset => {
      const option = documentRef.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      presetSelect?.append(option);
    });
    presetSelect?.addEventListener("change", render);
    select("[data-preset-apply]")?.addEventListener("click", () =>
      safely(() => controller.applyPreset(presetSelect?.value)));

    render();
    return controller;
  };

  return {
    IMAGE_TYPE_PATTERN,
    MAX_BACKGROUND_BYTES,
    SpaceStudioController,
    mount,
    overlayFor
  };
});
