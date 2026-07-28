"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionSettingsSection = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const resolve = hash => hash === "#model" ? "model" : hash === "#appearance" ? "appearance" : "all";
  const titles = Object.freeze({
    model: "模型设置",
    appearance: "小世界美化",
    all: "Dylan Gateway"
  });
  const apply = (documentRef, hash) => {
    const section = resolve(hash);
    if (documentRef?.body) documentRef.body.dataset.settingsSection = section;
    const title = documentRef?.querySelector?.("[data-settings-page-title]");
    if (title) title.textContent = titles[section];
    return section;
  };
  return { apply, resolve, titles };
});
