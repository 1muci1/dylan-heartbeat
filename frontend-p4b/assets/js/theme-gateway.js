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
  const request = async (path, options = {}, windowRef = window) => { const config = windowRef.AppConfig?.getProviderConfig?.() || {}; const url = resolveGatewayUrl(path, { baseUrl: config.baseUrl, locationRef: windowRef.location }); const response = await windowRef.fetch(url, { ...options, headers: { ...(config.auth?.token ? { Authorization: `Bearer ${config.auth.token}` } : {}), ...(options.headers || {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok) { const error=new Error(response.status===401?"主题素材接口认证失败，请检查当前 Gateway 配置。":payload.error?.message||`请求失败（${response.status}）`);error.status=response.status;error.code=payload.error?.code;throw error; } return payload; };
  return { resolveGatewayUrl, request };
});
