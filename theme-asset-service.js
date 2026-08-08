"use strict";

const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const MAX_ASSETS = 30;
const MAX_ASSET_SIZE = 2 * 1024 * 1024;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 8000;
const PREVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PREVIEWS = 200;
const MIME_EXTENSIONS = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"]]);

class ThemeAssetError extends Error {
  constructor(message, statusCode = 400, code = "THEME_ASSET_INVALID") { super(message); this.name = "ThemeAssetError"; this.statusCode = statusCode; this.code = code; }
}
function isPrivateIp(address) {
  const value = String(address || "").toLowerCase().split("%")[0]; const family = net.isIP(value);
  if (family === 4) {
    const parts = value.split(".").map(Number); const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (family === 6) return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("::ffff:");
  return false;
}
function detectMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
class ThemeAssetStore {
  constructor({ rootDir = path.join("runtime-data", "theme-assets") } = {}) { this.rootDir = path.resolve(rootDir); }
  save(buffer, mimeType) {
    const extension = MIME_EXTENSIONS.get(mimeType); if (!extension || detectMime(buffer) !== mimeType) throw new ThemeAssetError("图片内容与类型不一致", 415, "THEME_ASSET_MAGIC_INVALID");
    const id = crypto.randomUUID(); fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    const filename = path.join(this.rootDir, `${id}${extension}`); const temporary = path.join(this.rootDir, `.${id}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, buffer, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, filename);
    return { id, localUrl: `/api/theme/assets/${id}` };
  }
  resolve(id) {
    if (!/^[0-9a-f-]{36}$/iu.test(String(id || ""))) throw new ThemeAssetError("素材 ID 无效", 400, "THEME_ASSET_ID_INVALID");
    for (const [mimeType, extension] of MIME_EXTENSIONS) { const filename = path.join(this.rootDir, `${id}${extension}`); if (fs.existsSync(filename)) return { filename, mimeType }; }
    throw new ThemeAssetError("素材不存在", 404, "THEME_ASSET_NOT_FOUND");
  }
}
class ThemeAssetPreviewStore extends ThemeAssetStore {
  constructor({ rootDir = path.join("runtime-data", "theme-asset-previews"), maxAgeMs = PREVIEW_MAX_AGE_MS, maxItems = MAX_PREVIEWS, now = () => Date.now() } = {}) {
    super({ rootDir }); this.maxAgeMs = maxAgeMs; this.maxItems = maxItems; this.now = now;
  }
  cleanup() {
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    const cutoff = this.now() - this.maxAgeMs;
    const files = fs.readdirSync(this.rootDir).map(name => {
      const filename = path.join(this.rootDir, name); try { return { filename, stat: fs.statSync(filename) }; } catch { return null; }
    }).filter(item => item?.stat.isFile());
    for (const item of files.filter(item => item.stat.mtimeMs < cutoff)) { try { fs.unlinkSync(item.filename); } catch {} }
    const current = files.filter(item => item.stat.mtimeMs >= cutoff && fs.existsSync(item.filename)).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    for (const item of current.slice(Math.max(0, this.maxItems - 1))) { try { fs.unlinkSync(item.filename); } catch {} }
  }
  save(buffer, mimeType) { this.cleanup(); const saved = super.save(buffer, mimeType); return { ...saved, previewUrl: `/api/theme/assets/preview/${saved.id}` }; }
}
class ThemeAssetLocalizer {
  constructor({ store = new ThemeAssetStore(), fetchFn = globalThis.fetch, lookup = dns.lookup, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) { this.store = store; this.fetchFn = fetchFn; this.lookup = lookup; this.timeoutMs = timeoutMs; }
  async validateUrl(value) {
    let url; try { url = new URL(String(value || "")); } catch { throw new ThemeAssetError("素材 URL 无效", 400, "THEME_ASSET_URL_INVALID"); }
    if (!["http:", "https:"].includes(url.protocol)) throw new ThemeAssetError("只允许 HTTP/HTTPS 图片", 400, "THEME_ASSET_SCHEME_FORBIDDEN");
    const hostname = url.hostname.toLowerCase(); if (hostname === "localhost" || isPrivateIp(hostname)) throw new ThemeAssetError("不允许访问内网地址", 400, "THEME_ASSET_SSRF_BLOCKED");
    let addresses; try { addresses = await this.lookup(hostname, { all: true, verbatim: true }); } catch { throw new ThemeAssetError("素材域名无法解析", 400, "THEME_ASSET_DNS_FAILED"); }
    const list = Array.isArray(addresses) ? addresses : [addresses]; if (!list.length || list.some(item => isPrivateIp(item.address || item))) throw new ThemeAssetError("不允许访问内网地址", 400, "THEME_ASSET_SSRF_BLOCKED");
    return url;
  }
  async download(sourceUrl) {
    let url = await this.validateUrl(sourceUrl); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      for (let redirects = 0; redirects <= 3; redirects++) {
        let response; try { response = await this.fetchFn(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "image/png,image/jpeg,image/webp" } }); }
        catch (error) { throw new ThemeAssetError(error?.name === "AbortError" ? "图片下载超时" : "图片下载失败", 502, error?.name === "AbortError" ? "THEME_ASSET_TIMEOUT" : "THEME_ASSET_FETCH_FAILED"); }
        if ([301,302,303,307,308].includes(response.status)) { const location = response.headers.get("location"); if (!location || redirects === 3) throw new ThemeAssetError("图片重定向过多", 400, "THEME_ASSET_REDIRECT_INVALID"); url = await this.validateUrl(new URL(location, url).href); continue; }
        if (!response.ok) throw new ThemeAssetError("图片下载失败", 502, "THEME_ASSET_HTTP_FAILED");
        const mimeType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(); if (!MIME_EXTENSIONS.has(mimeType)) throw new ThemeAssetError("远程内容不是支持的静态图片", 415, "THEME_ASSET_CONTENT_TYPE_INVALID");
        const declared = Number(response.headers.get("content-length") || 0); if (declared > MAX_ASSET_SIZE) throw new ThemeAssetError("单张图片不能超过 2MB", 413, "THEME_ASSET_TOO_LARGE");
        const buffer = Buffer.from(await response.arrayBuffer()); if (!buffer.length || buffer.length > MAX_ASSET_SIZE) throw new ThemeAssetError("单张图片不能超过 2MB", 413, "THEME_ASSET_TOO_LARGE");
        if (detectMime(buffer) !== mimeType) throw new ThemeAssetError("图片文件头校验失败", 415, "THEME_ASSET_MAGIC_INVALID"); return { buffer, mimeType };
      }
    } finally { clearTimeout(timeout); }
    throw new ThemeAssetError("图片下载失败", 502, "THEME_ASSET_FETCH_FAILED");
  }
  async localize(assets) {
    if (!Array.isArray(assets) || !assets.length) throw new ThemeAssetError("请选择需要本地化的素材");
    if (assets.length > MAX_ASSETS) throw new ThemeAssetError("一次最多本地化 30 张图片", 413, "THEME_ASSET_COUNT_EXCEEDED");
    const localized = [], failed = []; let totalSize = 0;
    for (const item of assets) {
      const id = String(item?.id || "").slice(0, 80); const kind = String(item?.kind || "decorativeAsset").slice(0, 40);
      try { const downloaded = await this.download(item?.sourceUrl); totalSize += downloaded.buffer.length; if (totalSize > MAX_TOTAL_SIZE) throw new ThemeAssetError("素材总大小不能超过 20MB", 413, "THEME_ASSET_TOTAL_TOO_LARGE"); localized.push({ sourceId:id, kind, ...this.store.save(downloaded.buffer, downloaded.mimeType), status: "localized" }); }
      catch (error) { failed.push({ sourceId:id, kind, status: "failed", reason: error.code || "THEME_ASSET_FAILED" }); }
    }
    return { localized, failed };
  }
}
class ThemeAssetPreviewService {
  constructor({ localizer, store = new ThemeAssetPreviewStore() } = {}) { this.store = store; this.localizer = localizer || new ThemeAssetLocalizer(); }
  async preview(assets) {
    if (!Array.isArray(assets) || !assets.length) throw new ThemeAssetError("请选择需要预览的素材");
    if (assets.length > MAX_ASSETS) throw new ThemeAssetError("一次最多预览 30 张图片", 413, "THEME_ASSET_COUNT_EXCEEDED");
    const items = [], failed = []; let totalSize = 0;
    for (const item of assets) {
      const sourceUrl = item?.sourceUrl; const sourceKey = crypto.createHash("sha256").update(String(sourceUrl || "")).digest("hex").slice(0, 20);
      const id = String(item?.id || "").replace(/[^a-z0-9_-]/giu, "").slice(0, 80); const kind = String(item?.kind || "decorativeAsset").slice(0, 40); const selector = String(item?.selector || "").replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 160);
      try {
        const downloaded = await this.localizer.download(sourceUrl); totalSize += downloaded.buffer.length;
        if (totalSize > MAX_TOTAL_SIZE) throw new ThemeAssetError("素材总大小不能超过 20MB", 413, "THEME_ASSET_TOTAL_TOO_LARGE");
        const saved = this.store.save(downloaded.buffer, downloaded.mimeType);
        items.push({ id, sourceKey, kind, selector, previewUrl: saved.previewUrl, width: null, height: null, status: "ready" });
      } catch (error) { failed.push({ id, sourceKey, kind, selector, status: "failed", reason: error.code || "THEME_ASSET_FAILED" }); }
    }
    return { items, failed };
  }
}
module.exports = { DOWNLOAD_TIMEOUT_MS, PREVIEW_MAX_AGE_MS, MAX_PREVIEWS, MAX_ASSETS, MAX_ASSET_SIZE, MAX_TOTAL_SIZE, MIME_EXTENSIONS, ThemeAssetError, ThemeAssetLocalizer, ThemeAssetPreviewService, ThemeAssetPreviewStore, ThemeAssetStore, detectMime, isPrivateIp };
