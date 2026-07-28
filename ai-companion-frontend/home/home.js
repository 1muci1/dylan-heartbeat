"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionSpaceHome = Object.freeze(api);
  if (typeof document !== "undefined") {
    const start = () => api.boot(document, root);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})(typeof window !== "undefined" ? window : null, () => {
  const THEME_NAMES = Object.freeze({
    purple: "紫月",
    rose: "雾粉",
    blue: "星蓝",
    beige: "暖米"
  });

  const MOMENT_LABELS = Object.freeze({
    day: { label: "白昼", icon: "🌤️", atmosphere: "晨雾氛围" },
    sunset: { label: "黄昏", icon: "🌇", atmosphere: "暮色氛围" },
    night: { label: "夜晚", icon: "🌙", atmosphere: "月光氛围" }
  });
  const RELATIONSHIP_START_DATE = "2026-07-01";

  const clone = value => structuredClone(value);

  const overlayFor = profile => profile.theme.mode === "day"
    ? `rgba(255, 252, 255, ${profile.background.opacity})`
    : `rgba(5, 5, 8, ${profile.background.opacity})`;

  const pad = value => String(value).padStart(2, "0");

  const formatClock = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const formatDate = date => `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`;

  const relationshipDays = (date, startDate = RELATIONSHIP_START_DATE) => {
    const start = String(startDate).split("-").map(Number);
    const begin = new Date(start[0], start[1] - 1, start[2]);
    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.max(1, Math.floor((today - begin) / 86400000) + 1);
  };

  const resolveMoment = date => {
    const hour = date.getHours();
    if (hour >= 16 && hour < 18) return Object.freeze({ key: "sunset", ...MOMENT_LABELS.sunset });
    if (hour >= 6 && hour < 16) return Object.freeze({ key: "day", ...MOMENT_LABELS.day });
    return Object.freeze({ key: "night", ...MOMENT_LABELS.night });
  };

  const describeAtmosphere = atmosphere => {
    if (!atmosphere) return "月光氛围";
    if (atmosphere.animation === "morning-mist") return "晨雾氛围";
    if (atmosphere.animation === "slow-sunset") return "暮色氛围";
    return "月光氛围";
  };

  const buildThemeName = profile => `${THEME_NAMES[profile.theme.color] || profile.theme.color} · ${profile.theme.mode}`;

  const buildHeroTitle = (profile, moment) => `${moment.icon} ${profile.name}`;

  class SpaceHomeController {
    #profiles;
    #theme;
    #avatars;
    #atmosphere;
    #presets;
    #avatar;
    #clock;

    constructor({
      profileManager,
      themeEngine,
      avatarStudio,
      atmosphereEngine,
      presetManager,
      clock = () => new Date()
    } = {}) {
      if (!profileManager?.snapshot) throw new TypeError("Space Profile Manager 必填");
      if (!themeEngine?.setMode || !themeEngine?.setAccent) {
        throw new TypeError("Theme Engine 必填");
      }
      if (!avatarStudio?.defaultChen || !avatarStudio?.setCrop) {
        throw new TypeError("Avatar Studio 必填");
      }
      if (!atmosphereEngine?.setMode || !atmosphereEngine?.apply) {
        throw new TypeError("Atmosphere Engine 必填");
      }
      if (!presetManager?.list) throw new TypeError("Space Preset Manager 必填");
      if (typeof clock !== "function") throw new TypeError("clock 必填");
      this.#profiles = profileManager;
      this.#theme = themeEngine;
      this.#avatars = avatarStudio;
      this.#atmosphere = atmosphereEngine;
      this.#presets = presetManager;
      this.#clock = clock;
      this.#avatar = avatarStudio.defaultChen();
    }

    load() {
      const profile = this.#profiles.snapshot();
      const now = this.#clock();
      const moment = resolveMoment(now);
      this.#theme.setMode(profile.theme.mode);
      this.#theme.setAccent(profile.theme.color);
      if (profile.font.url) {
        const loading = this.#theme.loadFont({ ...profile.font });
        loading?.catch?.(() => {});
      } else {
        this.#theme.setFontFamily(profile.font.family);
      }
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
      this.#avatar = this.#avatars.setCrop(this.#avatars.defaultChen(), {
        x: profile.avatar.crop.x,
        y: profile.avatar.crop.y,
        zoom: profile.avatar.scale
      });
      this.#avatar = this.#avatars.setFrame(this.#avatar, {
        border: profile.avatar.frame,
        shape: profile.avatar.shape,
        size: profile.avatar.size
      });
      this.#atmosphere.setMode(
        profile.atmosphere.autoDayNight ? "auto" : profile.theme.mode
      );
      const atmosphere = this.#atmosphere.apply(profile, { time: now });
      const preset = this.#presets.list().find(item => item.name === profile.name) || null;
      return clone({
        profile,
        atmosphere,
        preset: preset
          ? { id: preset.id, name: preset.name, description: preset.description }
          : { id: null, name: "自定义空间", description: "当前配置不属于内置预设。" },
        themeName: buildThemeName(profile),
        heroTitle: buildHeroTitle(profile, moment),
        heroPresence: "沉正在这里",
        relationshipDays: relationshipDays(now),
        heroAtmosphere: `${moment.label} · ${describeAtmosphere(atmosphere)}`,
        moment: {
          key: moment.key,
          label: moment.label,
          icon: moment.icon,
          clock: formatClock(now),
          date: formatDate(now)
        }
      });
    }

    renderAvatar(documentRef, container) {
      return this.#avatars.render(documentRef, container, this.#avatar);
    }

    dispose() {
      this.#avatars.dispose?.();
      this.#theme.dispose?.();
    }
  }

  const renderUserAvatar = (documentRef, container, config = null, image = null) => {
    if (!documentRef?.createElement || !container?.replaceChildren) {
      return null;
    }
    const avatar = documentRef.createElement("div");
    avatar.className = "home-user-avatar";
    avatar.setAttribute("aria-label", "用户头像");
    const glyph = documentRef.createElement("span");
    glyph.className = "home-user-avatar__glyph";
    glyph.textContent = "你";
    if (image) {
      glyph.style.backgroundImage = `url(${JSON.stringify(image)})`;
      glyph.style.backgroundPosition = `${config.crop?.x ?? 50}% ${config.crop?.y ?? 50}%`;
      glyph.style.backgroundSize = `${Math.max(1, Number(config.scale) || 1) * 100}%`;
      glyph.textContent = "";
      avatar.classList.add("has-avatar-image");
    }
    const label = documentRef.createElement("span");
    label.className = "home-user-avatar__label";
    label.textContent = "用户头像";
    avatar.append(glyph, label);
    container.replaceChildren(avatar);
    return avatar;
  };

  const mountFallbackUserAvatarPicker = ({ documentRef, windowRef, store } = {}) => {
    const trigger = documentRef?.querySelector?.("[data-home-user-avatar]");
    if (!trigger || !documentRef?.createElement || !documentRef?.body || !store?.saveAvatar) return null;
    if (trigger.dataset.avatarPickerFallback === "bound") return null;
    const fileInput = documentRef.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/webp";
    fileInput.hidden = true;
    fileInput.setAttribute("data-home-user-avatar-file", "");
    documentRef.body.append(fileInput);
    trigger.dataset.avatarPickerFallback = "bound";
    trigger.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file || !/^image\/(?:png|jpeg|webp)$/iu.test(file.type) || file.size > 2 * 1024 * 1024) return;
      const Reader = windowRef?.FileReader;
      if (!Reader) return;
      const reader = new Reader();
      reader.onload = () => {
        const imageData = String(reader.result || "");
        if (!imageData.startsWith("data:image/") || imageData.startsWith("blob:")) return;
        store.saveAvatar({
          source: "upload",
          imageData,
          crop: { x: 50, y: 50 },
          scale: 1,
          border: "moon"
        }, "user");
      };
      reader.readAsDataURL(file);
    });
    return Object.freeze({ fileInput, trigger });
  };

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
    const controller = new SpaceHomeController({
      profileManager: new SpaceProfileManager({ persistenceAdapter: preferences?.adapter?.() }),
      themeEngine,
      avatarStudio,
      atmosphereEngine: new AtmosphereEngine(),
      presetManager: new SpacePresetManager(),
      clock: () => new windowRef.Date()
    });
    const state = controller.load();
    documentRef.body.classList.add("is-home-ready");
    const setText = (selector, value) => {
      const node = documentRef.querySelector(selector);
      if (node) node.textContent = value;
    };
    setText("[data-home-date]", state.moment.date);
    setText("[data-home-clock]", state.moment.clock);
    setText("[data-home-profile]", state.profile.name);
    setText("[data-home-space-title]", state.heroTitle);
    setText("[data-home-presence]", state.heroPresence);
    setText("[data-home-days]", state.relationshipDays);
    setText("[data-home-companionship-days]", state.relationshipDays);
    setText("[data-home-atmosphere]", state.heroAtmosphere);
    setText("[data-home-preset]", state.preset.name);
    setText("[data-home-preset-name]", state.preset.name);
    setText("[data-home-preset-description]", state.preset.description);
    setText("[data-home-theme]", state.themeName);
    setText("[data-home-moment]", state.moment.label);
    const renderPreferenceAvatars = preferenceValue => {
      const preferenceAvatar = preferenceValue?.avatar || preferences?.loadSync?.().avatar || {};
      const avatar = documentRef.querySelector("[data-home-avatar]");
      if (avatar) {
        avatar.replaceChildren();
        avatarStudio.render(documentRef, avatar, avatarStudio.defaultChen());
      }
      const userAvatar = documentRef.querySelector("[data-home-user-avatar]");
      if (userAvatar) {
        renderUserAvatar(
          documentRef,
          userAvatar,
          preferenceAvatar.userAvatar,
          preferences?.getUserAvatarImage?.(preferenceValue)
        );
      }
    };
    renderPreferenceAvatars(preferences?.loadSync?.());
    preferences?.subscribe?.(renderPreferenceAvatars);
    preferences?.load?.().then(renderPreferenceAvatars).catch(() => {
      // 保留同步读取后已呈现的头像，恢复失败时不回退默认。
    });
    let avatarPicker = null;
    try {
      avatarPicker = windowRef?.CompanionAvatarPicker?.mount({
        documentRef,
        windowRef,
        store: preferences,
        selector: "[data-home-user-avatar]"
      });
    } catch {
      avatarPicker = null;
    }
    if (!avatarPicker) mountFallbackUserAvatarPicker({ documentRef, windowRef, store: preferences });
    const hero = documentRef.querySelector("[data-home-hero]");
    if (hero) {
      hero.classList.add("is-home-hero-animated");
      hero.dataset.homeMoment = state.moment.key;
      hero.dataset.homeAnimation = state.atmosphere.animation;
      hero.dataset.homeTint = state.atmosphere.lighting.tint;
      hero.style.setProperty("--home-atmosphere-overlay", state.atmosphere.backgroundOverlay);
      hero.style.setProperty("--home-atmosphere-brightness", state.atmosphere.lighting.brightness);
      hero.style.setProperty("--home-atmosphere-contrast", state.atmosphere.lighting.contrast);
      hero.style.setProperty("--home-atmosphere-tint", state.atmosphere.lighting.tint);
    }
    const shell = documentRef.querySelector("[data-home-shell]");
    if (shell) {
      shell.dataset.homeMoment = state.moment.key;
    }
    const animatedNodes = [
      "[data-home-user-avatar]",
      "[data-home-avatar]",
      "[data-home-space-title]",
      "[data-home-atmosphere]",
      "[data-home-preset-name]",
      "[data-home-preset-description]",
      "[data-home-theme]",
      ".home-card"
    ];
    animatedNodes.forEach(selector => {
      documentRef.querySelectorAll(selector).forEach((node, index) => {
        const target = node.closest?.(".home-stat") || node;
        target.classList.add("is-home-entering");
        target.style.setProperty("--home-stagger-index", String(index));
      });
    });
    return controller;
  };

  const boot = (documentRef, windowRef) => {
    try {
      const controller = mount(documentRef, windowRef);
      if (controller) return controller;
    } catch {
      // 主页其他模块初始化失败时，仍保留用户头像的直接选择入口。
    }
    const PreferenceStore = windowRef?.CompanionUserPreferences?.UserPreferenceStore;
    const preferences = PreferenceStore ? new PreferenceStore() : null;
    return mountFallbackUserAvatarPicker({ documentRef, windowRef, store: preferences });
  };

  return {
    boot,
    SpaceHomeController,
    THEME_NAMES,
    buildHeroTitle,
    buildThemeName,
    describeAtmosphere,
    formatClock,
    formatDate,
    mount,
    mountFallbackUserAvatarPicker,
    overlayFor,
    resolveMoment,
    relationshipDays,
    RELATIONSHIP_START_DATE
  };
});
