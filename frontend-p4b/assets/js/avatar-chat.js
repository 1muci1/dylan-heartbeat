"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const Store = window.CompanionUserPreferences?.UserPreferenceStore;
  if (!Store) return;
  const store = new Store();
  const applyAvatar = (node, image, avatar = {}, fallback = "沉") => {
    if (!node) return false;
    if (image) {
      node.style.backgroundImage = `url(${JSON.stringify(image)})`;
      node.style.backgroundPosition = `${avatar.crop?.x ?? 50}% ${avatar.crop?.y ?? 50}%`;
      node.style.backgroundSize = `${Math.max(1, Number(avatar.scale) || 1) * 100}%`;
      node.classList.add("has-avatar-image");
      return true;
    }
    node.style.removeProperty("background-image");
    node.style.removeProperty("background-position");
    node.style.removeProperty("background-size");
    node.classList.remove("has-avatar-image");
    if (node.classList.contains("message-avatar")) node.textContent = fallback;
    return false;
  };
  const avatarConfig = (preferences, kind) => {
    const avatar = preferences.avatar;
    if (kind === "user") return avatar.userAvatar || avatar.meAvatar || avatar.ownerAvatar || {};
    return avatar.chenAvatar || avatar;
  };
  const getImage = (kind = "chen", preferences = store.loadSync()) => kind === "user"
    ? store.getUserAvatarImage(preferences)
    : store.getChenAvatarImage(preferences);
  const applyAvatars = preferences => {
    const value = preferences || store.loadSync();
    const chen = avatarConfig(value, "chen");
    const user = avatarConfig(value, "user");
    document.querySelectorAll(".chat-avatar, .message-avatar--assistant")
      .forEach(node => applyAvatar(node, getImage("chen", value), chen, "沉"));
    document.querySelectorAll(".message-avatar--user")
      .forEach(node => applyAvatar(node, getImage("user", value), user, "我"));
  };
  const applyTo = (node, kind = "chen", image = getImage(kind)) => {
    const preferences = store.loadSync();
    return applyAvatar(
      node,
      image,
      avatarConfig(preferences, kind),
      kind === "user" ? "我" : "沉"
    );
  };
  window.CompanionChatAvatars = Object.freeze({ apply: applyAvatars, applyTo, getImage });
  applyAvatars(store.loadSync());
  store.subscribe(applyAvatars);
  store.load().then(applyAvatars).catch(() => {
    // 保留当前头像，异步恢复失败时不回退默认。
  });
  window.CompanionAvatarPicker?.mount({
    documentRef: document,
    windowRef: window,
    store
  });
});
