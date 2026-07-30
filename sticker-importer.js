"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { IMAGE_EXTENSIONS, readZipEntries } = require("./file-extractors");
const { UploadError, atomicJson } = require("./upload-store");

const KEYWORDS = [
  "红包", "偷看", "咪", "思考", "略", "开心", "不屑", "不爽", "哭", "无语", "生气",
  "问号", "恨", "虚汗", "爱心", "角落", "跺脚", "玫瑰", "不对劲", "睡觉", "咬",
  "委屈", "收到", "猫饼"
];
const IMAGE_URL_RE = /https?:\/\/[^\s<>"'（）()]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>"'（）()]*)?/ig;

function tagsFor(description, title = "") {
  const tags = new Set();
  const source = `${description} ${title}`;
  if (/猫|喵/i.test(source)) tags.add("小猫");
  if (/小白猫/.test(source)) tags.add("小白猫");
  if (/呆猫/i.test(source) || /\bdaimao\b/i.test(source)) tags.add("呆猫");
  for (const keyword of KEYWORDS) if (description.includes(keyword)) tags.add(keyword);
  const titleTag = String(title || "").replace(/\.[^.]+$/, "").trim().slice(0, 20);
  if (titleTag) tags.add(titleTag);
  return [...tags];
}

function cleanDescription(value) {
  let description = String(value || "").trim()
    .replace(/^["']+\s*/, "")
    .replace(/\s*["']+$/, "")
    .trim();
  const wrapped = description.match(/^[（(]\s*([\s\S]*?)\s*[）)]$/);
  if (wrapped) description = wrapped[1].trim();
  return description;
}

function parseUrlDescriptionText(text, title = "") {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const items = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const matches = [...line.matchAll(IMAGE_URL_RE)];
    for (const match of matches) {
      let tail = line.slice((match.index || 0) + match[0].length).trim();
      tail = tail.replace(/^["']+\s*/, "").trim();
      const wrapped = tail.match(/^[（(]\s*([^）)]+)\s*[）)]/);
      let description = cleanDescription(wrapped?.[1] || tail);
      if (!description && lines[index + 1] && !/https?:\/\/[^\s]+/i.test(lines[index + 1])) {
        description = cleanDescription(lines[index + 1]);
      }
      IMAGE_URL_RE.lastIndex = 0;
      items.push({
        imageUrl: match[0], description,
        tags: tagsFor(description, title), needsReview: !description
      });
    }
  }
  return items;
}

function parseJson(buffer, title) {
  let value;
  try { value = JSON.parse(buffer.toString("utf8")); }
  catch { throw new UploadError("JSON 表情包格式无效", 400, "STICKER_IMPORT_INVALID"); }
  if (!Array.isArray(value)) throw new UploadError("JSON 表情包必须是数组", 400, "STICKER_IMPORT_INVALID");
  return value.map(item => {
    const imageUrl = String(item?.url || item?.imageUrl || "").trim();
    const description = String(item?.description || "").trim();
    return {
      imageUrl, description,
      tags: Array.isArray(item?.tags) ? item.tags.map(String).filter(Boolean).slice(0, 20) : tagsFor(description, title),
      needsReview: !description
    };
  }).filter(item => /^https?:\/\//i.test(item.imageUrl));
}

function parseCsv(buffer, title) {
  const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines.shift().split(",").map(value => value.trim().toLowerCase());
  const urlIndex = headers.indexOf("url");
  const descriptionIndex = headers.indexOf("description");
  const tagsIndex = headers.indexOf("tags");
  if (urlIndex < 0) throw new UploadError("CSV 缺少 url 列", 400, "STICKER_IMPORT_INVALID");
  return lines.map(line => {
    const fields = line.split(",").map(value => value.trim().replace(/^"|"$/g, ""));
    const description = fields[descriptionIndex] || "";
    return {
      imageUrl: fields[urlIndex] || "", description,
      tags: tagsIndex >= 0 && fields[tagsIndex]
        ? fields[tagsIndex].split(/[|;，\s]+/).filter(Boolean)
        : tagsFor(description, title),
      needsReview: !description
    };
  }).filter(item => /^https?:\/\//i.test(item.imageUrl));
}

class StickerImporter {
  constructor(options = {}) {
    this.uploadStore = options.uploadStore;
    this.packFile = path.resolve(options.packFile || process.env.STICKER_PACK_FILE || "runtime-data/sticker-packs.json");
  }

  readPacks() {
    try {
      const data = JSON.parse(fs.readFileSync(this.packFile, "utf8"));
      return data && Array.isArray(data.packs) ? data : { version: 1, packs: [] };
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, packs: [] };
      throw new UploadError("表情包目录暂时不可用", 500, "STICKER_IMPORT_FAILED");
    }
  }

  candidates(fileId) {
    const { record, buffer } = this.uploadStore.readBuffer(fileId);
    const extension = path.extname(record.safeName).toLowerCase();
    let items;
    if (extension === ".json") items = parseJson(buffer, record.safeName);
    else if (extension === ".csv") items = parseCsv(buffer, record.safeName);
    else if (IMAGE_EXTENSIONS.has(extension)) {
      const description = path.basename(record.safeName, extension);
      items = [{
        imageUrl: "", uploadFile: true, description,
        tags: tagsFor(description, record.safeName), needsReview: !description
      }];
    }
    else if (extension === ".zip") {
      items = readZipEntries(buffer, { maxEntries: 100 })
        .filter(entry => IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map(entry => ({
          imageUrl: "", zipEntry: entry.name,
          description: path.basename(entry.name, path.extname(entry.name)),
          tags: tagsFor(path.basename(entry.name), record.safeName), needsReview: false
        }));
    } else {
      items = parseUrlDescriptionText(record.extractedText, record.safeName);
    }
    if (!items.length) throw new UploadError("没有识别到可导入的表情", 400, "STICKER_IMPORT_EMPTY");
    return items.slice(0, 100);
  }

  preview(fileId) {
    return { ok: true, fileId, items: this.candidates(fileId).map((item, index) => ({ ...item, index })) };
  }

  confirm(fileId, selectedIndexes) {
    const candidates = this.candidates(fileId);
    const selected = new Set((Array.isArray(selectedIndexes) ? selectedIndexes : candidates.map((_, index) => index))
      .map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < candidates.length));
    if (!selected.size) throw new UploadError("请选择至少一个表情", 400, "STICKER_IMPORT_EMPTY");
    const source = this.uploadStore.readBuffer(fileId);
    const zipEntries = path.extname(source.record.safeName).toLowerCase() === ".zip"
      ? new Map(readZipEntries(source.buffer, { maxEntries: 100 }).map(entry => [entry.name, entry.data]))
      : null;
    const items = candidates.filter((_, index) => selected.has(index)).map(item => {
      let imageUrl = item.imageUrl;
      if (item.zipEntry || item.uploadFile) {
        const data = item.uploadFile ? source.buffer : zipEntries?.get(item.zipEntry);
        if (!data) throw new UploadError("压缩包图片已失效", 400, "STICKER_IMPORT_INVALID");
        const saved = this.uploadStore.saveAsset(data, item.uploadFile
          ? path.extname(source.record.safeName)
          : path.extname(item.zipEntry));
        imageUrl = `/api/v1/sticker-imports/assets/${saved.storageName}`;
      }
      return {
        id: crypto.randomUUID(), imageUrl, description: item.description,
        tags: item.tags, needsReview: item.needsReview === true
      };
    });
    const packs = this.readPacks();
    const pack = {
      id: crypto.randomUUID(), sourceFileId: fileId,
      createdAt: new Date().toISOString(), items
    };
    packs.packs.unshift(pack);
    atomicJson(this.packFile, packs);
    return { ok: true, packId: pack.id, importedCount: items.length, items };
  }

  list() {
    return this.readPacks().packs.flatMap(pack => pack.items.map(item => ({
      id: item.id, url: item.imageUrl, label: item.description || "待补充描述",
      tags: item.tags.join(" "), status: "active", imported: true
    }))).filter(item => item.url);
  }
}

module.exports = {
  IMAGE_URL_RE,
  KEYWORDS,
  StickerImporter,
  parseCsv,
  parseJson,
  parseUrlDescriptionText,
  tagsFor
};
