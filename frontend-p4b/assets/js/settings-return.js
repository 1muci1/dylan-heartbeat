"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionSettingsReturn = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const safeInternalPath = (value, { origin, settingsPath } = {}) => {
    if (typeof value !== "string" || !value.trim() || !origin) return null;
    try {
      const base = new URL(origin);
      const target = new URL(value, base);
      if (target.origin !== base.origin || !target.pathname.startsWith("/")) return null;
      const settings = new URL(settingsPath || "/settings.html", base);
      if (target.pathname === settings.pathname) return null;
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return null;
    }
  };

  const resolveReturnTarget = ({
    returnTo,
    referrer,
    origin,
    settingsPath,
    fallback = "/index.html"
  } = {}) => safeInternalPath(returnTo, { origin, settingsPath })
    || safeInternalPath(referrer, { origin, settingsPath })
    || fallback;

  return { safeInternalPath, resolveReturnTarget };
});
