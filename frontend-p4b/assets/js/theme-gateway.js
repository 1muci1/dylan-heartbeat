"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XinbanThemeGateway = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const normalizePath = value => {
    const path = String(value || "").trim();
    if (!path.startsWith("/api/")) throw new TypeError("Gateway path 必须以 /api/ 开头");
    return path;
  };
  const resolveGatewayUrl = (pathname, { baseUrl = "", locationRef = typeof location !== "undefined" ? location : null } = {}) => {
    const path = normalizePath(pathname); const configured = String(baseUrl || "").trim();
    if (configured) {
      const url = new URL(configured); url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "") || "/";
      url.search = ""; url.hash = ""; return `${url.origin}${url.pathname === "/" ? "" : url.pathname}${path}`;
    }
    const hostname = String(locationRef?.hostname || "").toLowerCase();
    if (hostname === "chat.xiaowo.homes") return `https://api.xiaowo.homes${path}`;
    return `${String(locationRef?.origin || "").replace(/\/+$/u, "")}${path}`;
  };
  return { resolveGatewayUrl };
});
