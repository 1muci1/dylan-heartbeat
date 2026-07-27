"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const Store = window.CompanionUserPreferences?.UserPreferenceStore;
  if (!Store) return;
  const store = new Store();
  const shell = document.querySelector(".chat-shell");
  if (!shell) return;
  const apply = preferences => {
    const background = store.getChatBackground(preferences || store.loadSync());
    if (background.image || background.color) {
      shell.style.setProperty(
        "--chat-bg-image",
        background.image ? `url(${JSON.stringify(background.image)})` : "none"
      );
      shell.style.setProperty("--chat-bg-position", background.position);
      shell.style.setProperty("--chat-bg-size", background.size);
      shell.style.setProperty("--chat-bg-overlay", String(background.overlay));
      shell.style.setProperty("--chat-bg-blur", `${background.blur}px`);
      shell.style.setProperty("--chat-bg-opacity", String(background.opacity));
      shell.style.setProperty("--chat-bg-color", background.color || "transparent");
      shell.classList.add("has-chat-background");
      return;
    }
    [
      "--chat-bg-image",
      "--chat-bg-position",
      "--chat-bg-size",
      "--chat-bg-overlay",
      "--chat-bg-blur",
      "--chat-bg-opacity",
      "--chat-bg-color"
    ].forEach(property => shell.style.removeProperty(property));
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
