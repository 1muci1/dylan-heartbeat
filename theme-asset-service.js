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
const MAX_ASSET_EDGE = 8192;
const MAX_ASSET_PIXELS = 32 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"]]);
const ASSET_CATEGORIES = new Set(["background", "bubble", "avatar", "header", "composer", "card", "decoration", "nav", "other"]);

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
function imageDimensions(buffer, mimeType = detectMime(buffer)) {
  if (mimeType === "image/png" && buffer.length >= 24 && buffer.subarray(12, 16).toString("ascii") === "IHDR") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg") {
    for (let offset = 2; offset + 9 < buffer.length;) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      if ([0xd8, 0xd9].includes(marker)) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > buffer.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  if (mimeType === "image/webp" && buffer.length >= 30) {
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}
function validateDimensions(dimensions) {
  if (!dimensions || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1) throw new ThemeAssetError("图片文件损坏", 415, "THEME_ASSET_DIMENSIONS_INVALID");
  if (dimensions.width > MAX_ASSET_EDGE || dimensions.height > MAX_ASSET_EDGE || dimensions.width * dimensions.height > MAX_ASSET_PIXELS) throw new ThemeAssetError("图片尺寸过大", 413, "THEME_ASSET_DIMENSIONS_TOO_LARGE");
  return dimensions;
}
function validateImageStructure(buffer, mimeType) {
  if (mimeType === "image/png") {
    if (buffer.length < 45 || buffer.readUInt32BE(8) !== 13 || buffer.subarray(12,16).toString("ascii") !== "IHDR" || !buffer.includes(Buffer.from("IEND", "ascii"))) throw new ThemeAssetError("图片文件损坏",415,"THEME_ASSET_STRUCTURE_INVALID");
  } else if (mimeType === "image/jpeg") {
    if (buffer.length < 16 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9 || !imageDimensions(buffer,mimeType)) throw new ThemeAssetError("图片文件损坏",415,"THEME_ASSET_STRUCTURE_INVALID");
  } else if (mimeType === "image/webp") {
    if (buffer.length < 30 || buffer.readUInt32LE(4) + 8 > buffer.length || !imageDimensions(buffer,mimeType)) throw new ThemeAssetError("图片文件损坏",415,"THEME_ASSET_STRUCTURE_INVALID");
  }
}
function safeLabel(value, fallback = "未命名素材") {
  const label = String(value || fallback).trim();
  if (!label || label.length > 80 || /[<>\u0000-\u001f\u007f]/u.test(label)) throw new ThemeAssetError("素材名称无效", 400, "THEME_ASSET_LABEL_INVALID");
  return label;
}
function safeCategory(value, fallback = "other") {
  const category = String(value || fallback); if (!ASSET_CATEGORIES.has(category)) throw new ThemeAssetError("素材分类无效", 400, "THEME_ASSET_CATEGORY_INVALID"); return category;
}
function categoryFromKind(kind) {
  const value = String(kind || "").toLowerCase();
  if (value.includes("background")) return "background"; if (value.includes("bubble")) return "bubble"; if (value.includes("avatar")) return "avatar";
  if (value.includes("header")) return "header"; if (value.includes("input") || value.includes("composer")) return "composer"; if (value.includes("card")) return "card"; if (value.includes("nav")) return "nav"; if (value.includes("decor")) return "decoration"; return "other";
}
class ThemeAssetStore {
  constructor({ rootDir = path.join("runtime-data", "theme-assets"), trashDir, eventStore = null, clock = () => new Date() } = {}) {
    this.rootDir = path.resolve(rootDir); this.trashDir = path.resolve(trashDir || path.join(path.dirname(this.rootDir), `${path.basename(this.rootDir)}-trash`)); this.metadataFile = path.join(this.rootDir, "library.json"); this.eventStore = eventStore; this.clock = clock;
  }
  ensureDirectories() { fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 }); fs.chmodSync(this.rootDir, 0o700); fs.mkdirSync(this.trashDir, { recursive: true, mode: 0o700 }); fs.chmodSync(this.trashDir, 0o700); }
  readMetadata() {
    this.ensureDirectories();
    try { const value = JSON.parse(fs.readFileSync(this.metadataFile, "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
  }
  writeMetadata(metadata) {
    this.ensureDirectories(); const temporary = path.join(this.rootDir, `.library.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(metadata, null, 2), { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, this.metadataFile); fs.chmodSync(this.metadataFile, 0o600);
  }
  record(eventType, metadata) {
    if (!this.eventStore) return;
    const payload = eventType === "theme_asset.favorite_changed" ? { assetId:metadata.id, favorite:metadata.favorite === true, timestamp:this.clock().toISOString() }
      : eventType === "theme_asset.restored" ? { assetId:metadata.id, timestamp:this.clock().toISOString() }
      : { source:metadata.source, mime:metadata.mime, bytes:metadata.bytes, width:metadata.width, height:metadata.height, ...(eventType === "theme_asset.renamed" ? { label:metadata.label, category:metadata.category } : {}) };
    this.eventStore.create({ eventType, subjectType:"theme_asset", subjectId:metadata.id, payload }, { source:"theme-asset-store" });
  }
  publicMetadata(metadata, { includeDeleted = false } = {}) { return { id:metadata.id, url:`/api/theme/assets/${metadata.id}`, source:metadata.source, label:metadata.label, category:metadata.category, favorite:metadata.favorite === true, mime:metadata.mime, width:metadata.width, height:metadata.height, bytes:metadata.bytes, createdAt:metadata.createdAt, ...(includeDeleted ? { deletedAt:metadata.deletedAt || null } : {}) }; }
  metadataForFile(id, filename, mimeType, current = {}) {
    const stat = fs.statSync(filename), buffer = fs.readFileSync(filename), dimensions = imageDimensions(buffer, mimeType);
    return { id, source:current.source || "history", label:current.label || "未命名素材", category:ASSET_CATEGORIES.has(current.category) ? current.category : "other", favorite:current.favorite === true, mime:mimeType, width:current.width || dimensions?.width || null, height:current.height || dimensions?.height || null, bytes:stat.size, createdAt:current.createdAt || stat.birthtime.toISOString(), deletedAt:current.deletedAt || null };
  }
  list({ view = "active" } = {}) {
    if (!["active","trash","all"].includes(view)) throw new ThemeAssetError("素材库视图无效",400,"THEME_ASSET_LIBRARY_VIEW_INVALID");
    const metadata = this.readMetadata(); let changed = false;
    for (const name of fs.readdirSync(this.rootDir)) {
      const match = name.match(/^([0-9a-f-]{36})(\.png|\.jpg|\.webp)$/iu); if (!match) continue;
      const mimeType = [...MIME_EXTENSIONS].find(([, extension]) => extension === match[2].toLowerCase())?.[0]; if (!mimeType) continue;
      const filename = path.join(this.rootDir, name), current = metadata[match[1]], stat = fs.statSync(filename);
      if (current && !current.deletedAt && current.mime === mimeType && current.bytes === stat.size && current.createdAt) continue;
      const next = this.metadataForFile(match[1], filename, mimeType, current); if (JSON.stringify(next) !== JSON.stringify(current)) { metadata[match[1]] = next; changed = true; }
    }
    if (changed) this.writeMetadata(metadata);
    const hasFile = item => fs.existsSync(path.join(item.deletedAt ? this.trashDir : this.rootDir, `${item.id}${MIME_EXTENSIONS.get(item.mime)}`));
    return Object.values(metadata).filter(item => (view === "all" || (view === "trash" ? item.deletedAt : !item.deletedAt)) && hasFile(item)).map(item => this.publicMetadata(item,{includeDeleted:view!=="active"})).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")) || String(a.id).localeCompare(String(b.id)));
  }
  save(buffer, mimeType, { source = "localized", label = "未命名素材", category = "other", requireDimensions = false } = {}) {
    const extension = MIME_EXTENSIONS.get(mimeType); if (!extension || detectMime(buffer) !== mimeType) throw new ThemeAssetError("图片内容与类型不一致", 415, "THEME_ASSET_MAGIC_INVALID");
    if (!buffer.length || buffer.length > MAX_ASSET_SIZE) throw new ThemeAssetError("单张图片不能超过 2MB", 413, "THEME_ASSET_TOO_LARGE");
    const dimensions = imageDimensions(buffer, mimeType); if (requireDimensions) validateDimensions(dimensions); else if (dimensions) validateDimensions(dimensions);
    const id = crypto.randomUUID(); this.ensureDirectories();
    const filename = path.join(this.rootDir, `${id}${extension}`); const temporary = path.join(this.rootDir, `.${id}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, buffer, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, filename);
    const metadata = this.readMetadata(), item = { id, source:["upload","localized"].includes(source) ? source : "localized", label:safeLabel(label), category:safeCategory(category), favorite:false, mime:mimeType, width:dimensions?.width || null, height:dimensions?.height || null, bytes:buffer.length, createdAt:this.clock().toISOString(), deletedAt:null };
    metadata[id] = item; this.writeMetadata(metadata); this.record(source === "upload" ? "theme_asset.uploaded" : "theme_asset.localized", item);
    return { ...this.publicMetadata(item), localUrl:`/api/theme/assets/${id}` };
  }
  upload(buffer, { mimeType, filename, category = "other" } = {}) { const original=String(filename||"");if(!original||path.basename(original)!==original||/[\\/\u0000-\u001f\u007f]/u.test(original))throw new ThemeAssetError("文件名无效",400,"THEME_ASSET_FILENAME_INVALID");validateImageStructure(buffer,mimeType); return this.save(buffer, mimeType, { source:"upload", label:safeLabel(original.replace(/\.[^.]+$/u, "") || "未命名素材"), category, requireDimensions:true }); }
  update(id, changes) {
    this.resolve(id); if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new ThemeAssetError("素材 metadata 无效");
    const unknown = Object.keys(changes).find(key => !["label","category","favorite"].includes(key)); if (unknown) throw new ThemeAssetError(`不允许修改字段：${unknown}`, 400, "THEME_ASSET_METADATA_FIELD_INVALID");
    if (!Object.keys(changes).length) throw new ThemeAssetError("请选择需要修改的字段");
    let metadata = this.readMetadata(); if (!metadata[id]) { this.list(); metadata = this.readMetadata(); } const item = metadata[id]; if (!item) throw new ThemeAssetError("素材不存在",404,"THEME_ASSET_NOT_FOUND");
    if (Object.hasOwn(changes,"label")) item.label = safeLabel(changes.label); if (Object.hasOwn(changes,"category")) item.category = safeCategory(changes.category);
    if (Object.hasOwn(changes,"favorite")) { if (typeof changes.favorite !== "boolean") throw new ThemeAssetError("收藏状态必须是 boolean",400,"THEME_ASSET_FAVORITE_INVALID"); item.favorite=changes.favorite; }
    metadata[id] = item; this.writeMetadata(metadata); if (Object.hasOwn(changes,"label") || Object.hasOwn(changes,"category")) this.record("theme_asset.renamed", item); if (Object.hasOwn(changes,"favorite")) this.record("theme_asset.favorite_changed",item); return this.publicMetadata(item);
  }
  delete(id) {
    const file = this.resolve(id), metadata = this.readMetadata(), item = metadata[id] || this.metadataForFile(id, file.filename, file.mimeType); this.ensureDirectories();
    const target = path.join(this.trashDir, path.basename(file.filename)); fs.renameSync(file.filename, target); fs.chmodSync(target, 0o600); item.deletedAt = this.clock().toISOString(); metadata[id] = item; this.writeMetadata(metadata); this.record("theme_asset.deleted", item); return { id, deleted:true };
  }
  restore(id) {
    if (!/^[0-9a-f-]{36}$/iu.test(String(id || ""))) throw new ThemeAssetError("素材 ID 无效",400,"THEME_ASSET_ID_INVALID");
    const metadata=this.readMetadata(),item=metadata[id]; if (!item) throw new ThemeAssetError("素材不存在",404,"THEME_ASSET_NOT_FOUND");
    if (!item.deletedAt) throw new ThemeAssetError("素材不在回收站",409,"THEME_ASSET_NOT_DELETED");
    const extension=MIME_EXTENSIONS.get(item.mime); if (!extension) throw new ThemeAssetError("素材类型无效",400,"THEME_ASSET_MIME_INVALID");
    this.ensureDirectories(); const source=path.join(this.trashDir,`${id}${extension}`),target=path.join(this.rootDir,`${id}${extension}`);
    if (!fs.existsSync(source)) throw new ThemeAssetError("回收站素材不存在",404,"THEME_ASSET_TRASH_FILE_NOT_FOUND"); if (fs.existsSync(target)) throw new ThemeAssetError("素材恢复冲突",409,"THEME_ASSET_RESTORE_CONFLICT");
    fs.renameSync(source,target); fs.chmodSync(target,0o600); item.deletedAt=null; item.favorite=item.favorite===true; metadata[id]=item; this.writeMetadata(metadata); this.record("theme_asset.restored",item); return this.publicMetadata(item);
  }
  resolveTrash(id) {
    if (!/^[0-9a-f-]{36}$/iu.test(String(id || ""))) throw new ThemeAssetError("素材 ID 无效",400,"THEME_ASSET_ID_INVALID");
    const item=this.readMetadata()[id]; if (!item?.deletedAt) throw new ThemeAssetError("回收站素材不存在",404,"THEME_ASSET_NOT_FOUND");
    const extension=MIME_EXTENSIONS.get(item.mime),filename=extension?path.join(this.trashDir,`${id}${extension}`):""; if (!filename || !fs.existsSync(filename)) throw new ThemeAssetError("回收站素材不存在",404,"THEME_ASSET_NOT_FOUND"); return {filename,mimeType:item.mime};
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
  save(buffer, mimeType) {
    this.cleanup(); const extension = MIME_EXTENSIONS.get(mimeType); if (!extension || detectMime(buffer) !== mimeType) throw new ThemeAssetError("图片内容与类型不一致", 415, "THEME_ASSET_MAGIC_INVALID");
    const id = crypto.randomUUID(), filename = path.join(this.rootDir, `${id}${extension}`), temporary = path.join(this.rootDir, `.${id}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, buffer, { flag:"wx", mode:0o600 }); fs.renameSync(temporary, filename); return { id, localUrl:`/api/theme/assets/${id}`, previewUrl:`/api/theme/assets/preview/${id}` };
  }
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
      try { const downloaded = await this.download(item?.sourceUrl); totalSize += downloaded.buffer.length; if (totalSize > MAX_TOTAL_SIZE) throw new ThemeAssetError("素材总大小不能超过 20MB", 413, "THEME_ASSET_TOTAL_TOO_LARGE"); localized.push({ sourceId:id, kind, ...this.store.save(downloaded.buffer, downloaded.mimeType, { source:"localized", category:categoryFromKind(kind) }), status: "localized" }); }
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
module.exports = { DOWNLOAD_TIMEOUT_MS, PREVIEW_MAX_AGE_MS, MAX_PREVIEWS, MAX_ASSETS, MAX_ASSET_SIZE, MAX_TOTAL_SIZE, MAX_ASSET_EDGE, MAX_ASSET_PIXELS, MIME_EXTENSIONS, ASSET_CATEGORIES, ThemeAssetError, ThemeAssetLocalizer, ThemeAssetPreviewService, ThemeAssetPreviewStore, ThemeAssetStore, detectMime, imageDimensions, isPrivateIp };
