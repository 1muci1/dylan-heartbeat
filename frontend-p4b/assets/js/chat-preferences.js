"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const Store = window.CompanionUserPreferences?.UserPreferenceStore;
  if (!Store) return;
  const store = new Store();
  const shell = document.querySelector(".chat-shell");
  if (!shell) return;
  const apply = preferences => {
    const background = preferences?.chatBackground;
    if (background?.imageData) {
      shell.style.setProperty("--chat-background-image", `url(${JSON.stringify(background.imageData)})`);
      shell.style.setProperty("--chat-background-position", background.position || "center");
      shell.style.setProperty("--chat-background-size", background.size || "cover");
      shell.style.setProperty("--chat-background-overlay", String(background.overlay ?? .35));
      shell.classList.add("has-chat-background");
      return;
    }
    shell.style.removeProperty("--chat-background-image");
    shell.style.removeProperty("--chat-background-position");
    shell.style.removeProperty("--chat-background-size");
    shell.style.removeProperty("--chat-background-overlay");
    shell.classList.remove("has-chat-background");
  };
  window.CompanionChatPreferences = Object.freeze({
    apply: preferences => apply(preferences || store.loadSync())
  });
  apply(store.loadSync());
  store.subscribe(apply);
  store.load().then(apply).catch(() => {
    // 保留当前已经呈现的背景，异步恢复失败时不回退默认。
  });
});
