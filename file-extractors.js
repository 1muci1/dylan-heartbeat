"use strict";

const path = require("node:path");
const zlib = require("node:zlib");

const MAX_TEXT_CHARACTERS = 20_000;
const MAX_ZIP_ENTRIES = 250;
const MAX_ZIP_UNCOMPRESSED = 30 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

class UploadParseError extends Error {
  constructor(message, statusCode = 400, code = "UPLOAD_PARSE_FAILED") {
    super(message);
    this.name = "UploadParseError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function safeZipEntryName(value) {
  const name = String(value || "").replace(/\\/g, "/");
  if (!name || name.startsWith("/") || /^[a-z]:/i.test(name)
    || name.split("/").some(part => part === "..")) {
    throw new UploadParseError("压缩包包含不安全路径", 400, "STICKER_IMPORT_INVALID");
  }
  return name;
}

function readZipEntries(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new UploadParseError("压缩文件无效");
  }
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === eocdSignature) { eocd = offset; break; }
  }
  if (eocd < 0) throw new UploadParseError("压缩文件缺少目录");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const maxEntries = Math.min(Number(options.maxEntries) || MAX_ZIP_ENTRIES, MAX_ZIP_ENTRIES);
  if (entryCount > maxEntries) throw new UploadParseError("压缩包文件数量过多", 413, "UPLOAD_TOO_LARGE");

  const entries = [];
  let totalSize = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new UploadParseError("压缩文件目录损坏");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = safeZipEntryName(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new UploadParseError("不支持加密压缩包", 415, "UPLOAD_TYPE_UNSUPPORTED");
    if (name.endsWith("/")) continue;
    totalSize += uncompressedSize;
    if (totalSize > MAX_ZIP_UNCOMPRESSED) throw new UploadParseError("压缩包解压后过大", 413, "UPLOAD_TOO_LARGE");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new UploadParseError("压缩文件条目损坏");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_UNCOMPRESSED });
    else throw new UploadParseError("压缩包使用了不支持的压缩方式", 415, "UPLOAD_TYPE_UNSUPPORTED");
    if (data.length !== uncompressedSize) throw new UploadParseError("压缩文件长度校验失败");
    entries.push({ name, data });
  }
  return entries;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<w:tab\b[^>]*\/?>/gi, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function docxRelationships(entries) {
  const relationships = entries.find(entry => entry.name === "word/_rels/document.xml.rels");
  if (!relationships) return new Map();
  const targets = new Map();
  const xml = relationships.data.toString("utf8");
  for (const match of xml.matchAll(/<Relationship\b([^>]*?)\/?>/gi)) {
    const attributes = match[1];
    const id = attributes.match(/\bId="([^"]+)"/i)?.[1];
    const target = decodeXmlText(attributes.match(/\bTarget="([^"]+)"/i)?.[1]);
    const type = attributes.match(/\bType="([^"]+)"/i)?.[1] || "";
    if (id && /^https?:\/\//i.test(target) && /\/hyperlink$/i.test(type)) targets.set(id, target);
  }
  return targets;
}

function extractDocxParagraphs(entries) {
  const document = entries.find(entry => entry.name === "word/document.xml");
  if (!document) throw new UploadParseError("DOCX 中没有可读取的正文");
  const relationships = docxRelationships(entries);
  const xml = document.data.toString("utf8");
  const paragraphs = [];
  for (const paragraphMatch of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi)) {
    const paragraph = paragraphMatch[1];
    const urls = [];
    const addUrl = value => {
      const url = decodeXmlText(value).trim();
      if (/^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
    };
    for (const instruction of paragraph.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/gi)) {
      const text = decodeXmlText(instruction[1].replace(/<[^>]+>/g, ""));
      const url = text.match(/\bHYPERLINK\s+["']([^"']+)["']/i)?.[1]
        || text.match(/\bHYPERLINK\s+(https?:\/\/\S+)/i)?.[1];
      if (url) addUrl(url);
    }
    for (const hyperlink of paragraph.matchAll(/<w:hyperlink\b([^>]*)>/gi)) {
      const id = hyperlink[1].match(/\br:id="([^"]+)"/i)?.[1];
      if (id && relationships.has(id)) addUrl(relationships.get(id));
    }
    const visibleText = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)]
      .map(match => decodeXmlText(match[1].replace(/<[^>]+>/g, "")))
      .join("");
    if (!urls.length) {
      const text = visibleText.trim();
      if (text) paragraphs.push(text);
      continue;
    }
    let description = visibleText;
    for (const url of urls) description = description.split(url).join("");
    description = description.trim();
    for (const url of urls) paragraphs.push(`${url}${description}`);
  }
  return paragraphs;
}

function extractDocxText(buffer) {
  const entries = readZipEntries(buffer);
  const paragraphs = extractDocxParagraphs(entries);
  return paragraphs.join("\n").slice(0, MAX_TEXT_CHARACTERS);
}

function extensionOf(name) {
  return path.extname(String(name || "")).toLowerCase();
}

function extractFile({ buffer, name, mime }) {
  const extension = extensionOf(name);
  let kind = "unsupported";
  let extractedText = "";
  if ([".txt", ".md", ".csv"].includes(extension)) {
    kind = "text";
    extractedText = buffer.toString("utf8").replace(/\0/g, "").slice(0, MAX_TEXT_CHARACTERS);
  } else if (extension === ".json") {
    kind = "text";
    try { extractedText = JSON.stringify(JSON.parse(buffer.toString("utf8")), null, 2).slice(0, MAX_TEXT_CHARACTERS); }
    catch { throw new UploadParseError("JSON 文件格式无效"); }
  } else if (extension === ".docx") {
    kind = "document";
    extractedText = extractDocxText(buffer);
  } else if (extension === ".pdf") {
    kind = "unsupported";
  } else if (IMAGE_EXTENSIONS.has(extension) || String(mime || "").startsWith("image/")) {
    kind = "image";
  } else if (extension === ".zip") {
    kind = "archive";
  } else {
    throw new UploadParseError("暂不支持这种文件类型", 415, "UPLOAD_TYPE_UNSUPPORTED");
  }
  const text = extractedText.trim();
  return {
    kind,
    extractedText: text,
    extractedTextLength: text.length,
    extractedTextPreview: text.slice(0, 500),
    canUseInChat: Boolean(text)
  };
}

module.exports = {
  IMAGE_EXTENSIONS,
  MAX_TEXT_CHARACTERS,
  UploadParseError,
  decodeXml,
  extractDocxParagraphs,
  extractDocxText,
  extractFile,
  extensionOf,
  readZipEntries,
  safeZipEntryName
};
