"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const Store = window.CompanionUserPreferences?.UserPreferenceStore;
  if (!Store) return;
  const preferences = new Store().loadSync();
  const background = preferences.chatBackground;
  if (!background?.imageData) return;
  const shell = document.querySelector(".chat-shell");
  if (!shell) return;
  shell.style.setProperty("--chat-background-image", `url(${JSON.stringify(background.imageData)})`);
  shell.style.setProperty("--chat-background-overlay", String(background.overlay ?? .35));
  shell.classList.add("has-chat-background");
});
