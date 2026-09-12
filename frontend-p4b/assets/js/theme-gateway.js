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
  const canonicalUrl = (path, w) => resolveGatewayUrl(path, { locationRef: w.location });
  const isGatewayConfig = (config, w) => {
    try { return Boolean(config?.baseUrl) && resolveGatewayUrl("/api/personalization", { baseUrl: config.baseUrl, locationRef: w.location }) === canonicalUrl("/api/personalization", w); }
    catch { return false; }
  };
  const firstPartyConfig = w => {
    const config = w.AppConfig?.getGatewayConnection?.();
    return isGatewayConfig(config, w) ? config : {};
  };
  const connect = async (config, w = window) => {
    if (!isGatewayConfig(config, w) || !config.auth?.token) throw Object.assign(new Error("请填写映我 Gateway 连接凭据。"), { code: "GATEWAY_NOT_CONNECTED" });
    // Validate the existing credential with a read, before replacing the saved connection.
    const payload = await requestFirstParty("/api/personalization", {}, { location: w.location, fetch: w.fetch.bind(w), AppConfig: { getGatewayConnection: () => config } });
    w.AppConfig.saveGatewayConnection({ baseUrl: new URL(canonicalUrl("/api/personalization", w)).origin, auth: { type: "bearer", token: config.auth.token } });
    return payload;
  };
  const ensureConnection = async (w = window) => {
    if (firstPartyConfig(w).auth?.token || w.AppConfig?.isGatewayDisconnected?.()) return;
    const legacy = w.AppConfig?.getProviderConfig?.();
    if (isGatewayConfig(legacy, w) && legacy.auth?.token) await connect(legacy, w);
  };
  const disconnect = (w = window) => w.AppConfig?.saveGatewayConnection?.(null);
  const request = async (path, options = {}, w = window) => {
    await ensureConnection(w);
    return requestFirstParty(path, options, w);
  };
  const requestFirstParty = async (path, options = {}, windowRef = window) => {
    const url = resolveGatewayUrl(path, { locationRef: windowRef.location });
    const config = firstPartyConfig(windowRef);
    if (!config.auth?.token) throw Object.assign(new Error("Gateway not connected"), { code: "GATEWAY_NOT_CONNECTED" });
    const headers = new Headers(options.headers || {});
    headers.delete("Authorization");
    if (config.auth?.token) headers.set("Authorization", `Bearer ${config.auth.token}`);
    let response;
    try { response = await windowRef.fetch(url, { ...options, headers, cache: "no-store", redirect: "error" }); }
    catch (cause) { throw Object.assign(new Error("Sync request failed"), { code: cause?.name === "TypeError" ? "SYNC_NETWORK" : "SYNC_REQUEST_FAILED" }); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(response.status===401?"主题素材接口认证失败，请连接映我 Gateway。":"服务请求失败，请稍后重试。"), { status: response.status, code: payload?.error?.code || payload?.code, data: payload?.data });
    if (!payload || payload.ok !== true || !payload.data) throw Object.assign(new Error("Invalid sync response"), { status: response.status, code: "SYNC_RESPONSE_INVALID" });
    if (path === "/api/personalization" || path === "/api/personalization/bootstrap") {
      const { initialized, state } = payload.data;
      if (typeof initialized !== "boolean" || (!initialized && state !== null) ||
          (initialized && (!state || !Number.isInteger(state.revision) || !["identity", "appearance", "voicePortable"].every(section => Number.isInteger(state.sections?.[section]?.revision) && state.sections[section].data)))) {
        throw Object.assign(new Error("Invalid sync response"), { status: response.status, code: "SYNC_RESPONSE_INVALID" });
      }
    }
    return payload;
  };
  const imageTypes = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });
  const assetError = code => Object.assign(new Error(({LOCAL_ASSET_TYPE_UNSUPPORTED:"仅支持 PNG、JPEG、WebP 图片。",THEME_ASSET_TOO_LARGE:"图片大小不符合上传限制。",LOCAL_ASSET_MALFORMED:"本地图片编码无效。",LOCAL_ASSET_UNREADABLE:"本地图片已无法读取，请重新选择。",LOCAL_ASSET_UNSUPPORTED:"请先通过素材库安全导入此图片。"})[code] || "图片上传响应异常。"), { code });
  // Shared with Workshop: one multipart contract, with browser-generated boundary.
  const readLocalImage = async (source, w) => {
    let file = source;
    if (typeof source === "string") {
      if (source.startsWith("blob:")) {
        let url;try { url = new URL(source); } catch { throw assetError("LOCAL_ASSET_UNREADABLE"); }
        if (url.origin !== w.location.origin) throw assetError("LOCAL_ASSET_UNREADABLE");
        try { const response = await w.fetch(source, { credentials: "omit", redirect: "error" });if (!response.ok) throw Error();file = await response.blob(); }
        catch { throw assetError("LOCAL_ASSET_UNREADABLE"); }
      } else {
        if (!source.startsWith("data:")) throw assetError("LOCAL_ASSET_UNSUPPORTED");
        const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]*={0,2})$/iu.exec(source);
        if (!match || !match[2] || match[2].length % 4 !== 0) throw assetError("LOCAL_ASSET_MALFORMED");
        const mime = match[1].toLowerCase();
        if (!imageTypes[mime]) throw assetError("LOCAL_ASSET_TYPE_UNSUPPORTED");
        if (match[2].length > Math.ceil(2 * 1024 * 1024 / 3) * 4) throw assetError("THEME_ASSET_TOO_LARGE");
        let bytes;try { bytes = Uint8Array.from(w.atob(match[2]), char => char.charCodeAt(0)); } catch { throw assetError("LOCAL_ASSET_MALFORMED"); }
        file = new w.File([bytes], `personalization.${imageTypes[mime]}`, { type: mime });
      }
    }
    if (!(file instanceof w.Blob)) throw assetError("LOCAL_ASSET_UNREADABLE");
    if (!imageTypes[file.type]) throw assetError("LOCAL_ASSET_TYPE_UNSUPPORTED");
    if (!file.size || file.size > 2 * 1024 * 1024) throw assetError("THEME_ASSET_TOO_LARGE");
    return file;
  };
  const uploadThemeAsset = async (source, w = window) => {
    let file;try { file = await readLocalImage(source, w); } catch(error) { error.stage="asset-read";throw error; }
    const body = new w.FormData();
    body.append("file", file, file.name || `personalization.${imageTypes[file.type]}`);
    let payload;try { payload = await request("/api/theme/assets/upload", { method: "POST", body }, w); } catch(error) { error.stage="asset-upload";throw error; }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(payload.data.id || "")) throw assetError("SYNC_RESPONSE_INVALID");
    return payload;
  };
  return { resolveGatewayUrl, request, requestFirstParty, firstPartyConfig, isGatewayConfig, connect, ensureConnection, disconnect, readLocalImage, uploadThemeAsset };
});
