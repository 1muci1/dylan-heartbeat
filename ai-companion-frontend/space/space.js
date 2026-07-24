"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionSpace = Object.freeze(api);
  if (typeof document !== "undefined") api.mount(document, root);
})(typeof window !== "undefined" ? window : null, () => {
  const overlayFor = profile => profile.theme.mode === "day"
    ? `rgba(255, 252, 255, ${profile.background.opacity})`
    : `rgba(18, 11, 27, ${profile.background.opacity})`;

  const mount = (documentRef, windowRef) => {
    const ThemeEngine = windowRef?.CompanionTheme?.ThemeEngine;
    const AvatarStudio = windowRef?.AvatarStudio?.AvatarStudio;
    const SpaceProfileManager = windowRef?.CompanionSpaceProfile?.SpaceProfileManager;
    if (!ThemeEngine || !AvatarStudio || !SpaceProfileManager) return null;

    const theme = new ThemeEngine({
      documentRef,
      matchMedia: windowRef.matchMedia?.bind(windowRef),
      fontFaceFactory: windowRef.FontFace
        ? (family, source, descriptors) => new windowRef.FontFace(family, source, descriptors)
        : undefined
    });
    const avatarStudio = new AvatarStudio({
      createObjectURL: windowRef.URL.createObjectURL.bind(windowRef.URL),
      revokeObjectURL: windowRef.URL.revokeObjectURL.bind(windowRef.URL)
    });
    const profileManager = new SpaceProfileManager();
    let profile = profileManager.snapshot();
    let avatar = avatarStudio.defaultChen();

    const select = selector => documentRef.querySelector(selector);
    const setStatus = (message, error = false) => {
      const target = select("[data-space-status]");
      if (!target) return;
      target.textContent = message;
      target.classList.toggle("is-error", error);
    };
    const renderAvatar = () => {
      const stage = select("[data-avatar-stage]");
      if (!stage) return;
      stage.replaceChildren();
      avatarStudio.render(documentRef, stage, avatar);
    };
    const syncControls = () => {
      documentRef.querySelectorAll("[data-theme-mode]").forEach(button => {
        button.classList.toggle("is-active", button.dataset.themeMode === profile.theme.mode);
      });
      const modeLabel = select("[data-space-mode]");
      if (modeLabel) {
        modeLabel.textContent = profile.theme.mode === "night"
          ? "紫月夜"
          : profile.theme.mode === "day" ? "柔光白昼" : "跟随系统";
      }
      const values = [
        ["[data-avatar-zoom]", profile.avatar.scale],
        ["[data-avatar-x]", profile.avatar.crop.x],
        ["[data-avatar-y]", profile.avatar.crop.y],
        ["[data-avatar-border]", profile.avatar.frame],
        ["[data-background-url]", profile.background.url || ""],
        ["[data-font-family]", profile.font.family === "default" ? "" : profile.font.family],
        ["[data-font-url]", profile.font.url || ""]
      ];
      values.forEach(([selector, value]) => {
        const target = select(selector);
        if (target) target.value = String(value);
      });
    };
    const applyAvatarConfig = () => {
      avatar = avatarStudio.setCrop(avatar, {
        x: profile.avatar.crop.x,
        y: profile.avatar.crop.y,
        zoom: profile.avatar.scale
      });
      avatar = avatarStudio.setFrame(avatar, {
        border: profile.avatar.frame,
        shape: profile.avatar.shape,
        size: profile.avatar.size
      });
      renderAvatar();
    };
    const resetProfile = () => {
      profile = profileManager.reset();
      theme.setMode(profile.theme.mode);
      theme.setAccent(profile.theme.color);
      theme.clearBackground();
      if (avatar.source === "upload") avatarStudio.release(avatar);
      avatar = avatarStudio.defaultChen();
      applyAvatarConfig();
      syncControls();
      setStatus("已恢复紫月小屋默认配置");
    };

    documentRef.querySelectorAll("[data-theme-mode]").forEach(button => {
      button.addEventListener("click", () => {
        profile = profileManager.update(profile.id, {
          theme: { mode: button.dataset.themeMode }
        });
        theme.setMode(profile.theme.mode);
        theme.setAccent(profile.theme.color);
        syncControls();
      });
    });

    select("[data-avatar-upload]")?.addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (avatar.source === "upload") avatarStudio.release(avatar);
        avatar = avatarStudio.fromUpload(file, {
          base: avatarStudio.defaultChen(),
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
        profile = profileManager.update(profile.id, {
          avatar: { type: "upload" }
        });
        renderAvatar();
        setStatus("头像已载入当前空间");
      } catch (error) {
        setStatus(error.message, true);
      }
    });

    const updateCrop = () => {
      profile = profileManager.update(profile.id, {
        avatar: {
          scale: Number(select("[data-avatar-zoom]")?.value),
          crop: {
            x: Number(select("[data-avatar-x]")?.value),
            y: Number(select("[data-avatar-y]")?.value)
          }
        }
      });
      try { applyAvatarConfig(); } catch (error) { setStatus(error.message, true); }
    };
    ["[data-avatar-x]", "[data-avatar-y]", "[data-avatar-zoom]"].forEach(selector => {
      select(selector)?.addEventListener("input", updateCrop);
    });
    select("[data-avatar-border]")?.addEventListener("change", event => {
      profile = profileManager.update(profile.id, {
        avatar: { frame: event.target.value }
      });
      try { applyAvatarConfig(); } catch (error) { setStatus(error.message, true); }
    });

    select("[data-apply-background]")?.addEventListener("click", () => {
      const imageUrl = select("[data-background-url]")?.value.trim();
      try {
        const result = theme.setBackground({
          imageUrl,
          position: profile.background.position,
          size: profile.background.size,
          overlay: overlayFor(profile),
          blur: profile.background.blur
        });
        profile = profileManager.update(profile.id, {
          background: {
            url: result.imageUrl,
            position: result.position,
            size: result.size
          }
        });
        setStatus("背景已应用到当前空间");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
    select("[data-clear-background]")?.addEventListener("click", () => {
      theme.clearBackground();
      profile = profileManager.update(profile.id, {
        background: { url: null }
      });
      const input = select("[data-background-url]");
      if (input) input.value = "";
      setStatus("已清除自定义背景");
    });

    select("[data-load-font]")?.addEventListener("click", async () => {
      const family = select("[data-font-family]")?.value.trim();
      const url = select("[data-font-url]")?.value.trim();
      try {
        const result = await theme.loadFont({ family, url });
        profile = profileManager.update(profile.id, {
          font: {
            family: result.family,
            url,
            weight: result.weight,
            style: result.style
          }
        });
        setStatus("字体已加载并应用");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
    select("[data-reset-space]")?.addEventListener("click", resetProfile);

    theme.setMode(profile.theme.mode);
    theme.setAccent(profile.theme.color);
    applyAvatarConfig();
    syncControls();

    return Object.freeze({
      getSnapshot() { return profileManager.snapshot(); },
      profileManager,
      dispose() {
        avatarStudio.dispose();
        theme.dispose();
      }
    });
  };

  return {
    overlayFor,
    mount
  };
});
