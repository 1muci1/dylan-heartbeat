"use strict";

const { NAME_PATTERN } = require("./tool-registry");

const MAX_OUTPUT_BYTES = 10 * 1024;
const MAX_DEPTH = 20;
const MAX_COLLECTION_ITEMS = 1000;
const FORBIDDEN_KEY = /(token|secret|password|credential|api.?key|stack|debug|internal)/i;

class ToolResultNormalizerError extends Error {
  constructor(message, code = "TOOL_RESULT_INVALID") {
    super(message);
    this.name = "ToolResultNormalizerError";
    this.code = code;
  }
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function supportedPrimitive(value) {
  return typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function sanitize(value, state, depth = 0) {
  if (supportedPrimitive(value)) return value;
  if (value && typeof value === "object") {
    if (state.seen.has(value)) throw new ToolResultNormalizerError("result 不能包含循环引用");
    state.seen.add(value);
  }
  if (depth >= MAX_DEPTH) {
    state.truncated = true;
    if (value && typeof value === "object") state.seen.delete(value);
    return null;
  }
  if (Array.isArray(value)) {
    const output = [];
    const count = Math.min(value.length, MAX_COLLECTION_ITEMS);
    if (value.length > count) state.truncated = true;
    for (let index = 0; index < count; index++) {
      const item = value[index];
      if (item === null) output.push(null);
      else if (supportedPrimitive(item) || Array.isArray(item) || plainObject(item)) output.push(sanitize(item, state, depth + 1));
      else { output.push(null); state.truncated = true; }
    }
    state.seen.delete(value);
    return output;
  }
  if (plainObject(value)) {
    const output = {};
    const entries = Object.entries(value);
    if (entries.length > MAX_COLLECTION_ITEMS) state.truncated = true;
    for (const [key, item] of entries.slice(0, MAX_COLLECTION_ITEMS)) {
      if (FORBIDDEN_KEY.test(key)) continue;
      if (item === null) output[key] = null;
      else if (supportedPrimitive(item) || Array.isArray(item) || plainObject(item)) output[key] = sanitize(item, state, depth + 1);
      else state.truncated = true;
    }
    state.seen.delete(value);
    return output;
  }
  if (value && typeof value === "object") state.seen.delete(value);
  throw new ToolResultNormalizerError("result 只支持 JSON object、array、string、number 或 boolean");
}

function envelope(data, truncated) {
  return { success: true, data, metadata: { truncated } };
}

function sizeOf(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function fitString(value) {
  let low = 0, high = value.length, best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = value.slice(0, middle);
    if (sizeOf(envelope(candidate, true)) <= MAX_OUTPUT_BYTES) {
      best = candidate; low = middle + 1;
    } else high = middle - 1;
  }
  return best;
}

function fitCollection(value) {
  if (Array.isArray(value)) {
    const output = [];
    for (const item of value) {
      output.push(item);
      if (sizeOf(envelope(output, true)) > MAX_OUTPUT_BYTES) { output.pop(); break; }
    }
    return output;
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = item;
    if (sizeOf(envelope(output, true)) > MAX_OUTPUT_BYTES) delete output[key];
  }
  return output;
}

function normalizeToolResult({ toolName, result } = {}) {
  if (typeof toolName !== "string" || !NAME_PATTERN.test(toolName)) throw new ToolResultNormalizerError("toolName 格式无效");
  if (!(supportedPrimitive(result) || Array.isArray(result) || plainObject(result))) {
    throw new ToolResultNormalizerError("result 只支持 JSON object、array、string、number 或 boolean");
  }
  const state = { truncated: false, seen: new WeakSet() };
  const clean = sanitize(result, state);
  let output = envelope(clean, state.truncated);
  if (sizeOf(output) <= MAX_OUTPUT_BYTES) return output;
  const fitted = typeof clean === "string" ? fitString(clean) : fitCollection(clean);
  output = envelope(fitted, true);
  if (sizeOf(output) > MAX_OUTPUT_BYTES) return envelope(null, true);
  return output;
}

module.exports = {
  FORBIDDEN_KEY,
  MAX_COLLECTION_ITEMS,
  MAX_DEPTH,
  MAX_OUTPUT_BYTES,
  ToolResultNormalizerError,
  normalizeToolResult,
  sanitize,
  sizeOf
};
