"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root?.document) return;
  const start = () => api.mount(root);
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(typeof window !== "undefined" ? window : null, () => {
  // Historical Home date; no new setting or relationship state is written.
  const RELATIONSHIP_START_DATE = "2026-07-01";
  const DAY_MS = 86400000;
  const BEIJING_OFFSET_MS = 8 * 3600000;
  const START_DAY = Date.UTC(2026, 6, 1) / DAY_MS;
  const relationshipDays = (date = new Date()) => {
    const instant = date.getTime();
    if (!Number.isFinite(instant)) return null;
    // UTC+8 calendar day ordinals, independent of host timezone and DST.
    return Math.max(1, Math.floor((instant + BEIJING_OFFSET_MS) / DAY_MS) - START_DAY + 1);
  };

  function mount(windowRef) {
    const documentRef = windowRef.document;
    const hero = documentRef.querySelector(".relationship-hero");
    if (!hero) return null;
    const clock = () => new windowRef.Date();
    const renderDays = () => {
      const days = relationshipDays(clock());
      if (days !== null) hero.querySelector("[data-relationship-days]").textContent = `今天陪伴第 ${days} 天`;
    };
    renderDays();
    const timer = windowRef.setInterval(renderDays, 60000);
    documentRef.addEventListener("visibilitychange", renderDays);
    windowRef.addEventListener("pageshow", renderDays);

    const Store = windowRef.CompanionUserPreferences?.UserPreferenceStore;
    const store = Store ? new Store() : null;
    let revision = 0;
    const renderAvatars = (preferences = store?.loadSync()) => {
      const current = ++revision;
      for (const kind of ["user", "chen"]) {
        const node = hero.querySelector(`[data-relationship-avatar="${kind}"]`);
        const avatar = preferences?.avatar || {};
        const config = kind === "user" ? avatar.userAvatar || avatar.meAvatar || avatar.ownerAvatar || {} : avatar.chenAvatar || avatar;
        const source = kind === "user" ? store?.getUserAvatarImage(preferences) : store?.getChenAvatarImage(preferences);
        node.classList.remove("has-avatar-image");
        node.style.removeProperty("background-image");
        node.style.removeProperty("background-position");
        node.style.removeProperty("background-size");
        if (!source) continue;
        const image = new windowRef.Image();
        image.onload = () => {
          if (revision !== current) return;
          node.style.backgroundImage = `url(${JSON.stringify(source)})`;
          node.style.backgroundPosition = `${config.crop?.x ?? 50}% ${config.crop?.y ?? 50}%`;
          node.style.backgroundSize = `${Math.max(1, Number(config.scale) || 1) * 100}%`;
          node.classList.add("has-avatar-image");
        };
        image.onerror = () => {}; // Existing text fallback remains visible.
        image.src = source;
      }
    };
    renderAvatars();
    const unsubscribe = store?.subscribe(renderAvatars);
    // Avoid an older async load replacing a newer preference update.
    const initialRevision = revision;
    store?.load().then(value => {
      if (revision === initialRevision) renderAvatars(value);
    }).catch(() => {});
    return { renderDays, destroy() {
      revision++;
      windowRef.clearInterval(timer);
      documentRef.removeEventListener("visibilitychange", renderDays);
      windowRef.removeEventListener("pageshow", renderDays);
      unsubscribe?.();
    } };
  }
  return Object.freeze({ RELATIONSHIP_START_DATE, relationshipDays, mount });
});
