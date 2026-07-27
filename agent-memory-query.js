"use strict";

const DEFAULT_MAX_KEYWORDS = 6;
const MAX_QUERY_CHARACTERS = 500;
const STOP_WORDS = Object.freeze([
  "什么时候", "为什么", "怎么样", "怎么", "什么", "哪些", "哪个", "是不是",
  "可以", "能够", "知道", "记得", "觉得", "告诉", "一下", "关于",
  "我们", "你们", "他们", "她们", "自己", "这个", "那个", "现在",
  "的", "了", "吗", "呢", "呀", "啊", "吧", "我", "你", "她", "他"
]);

const QUERY_EXPANSIONS = Object.freeze([
  {
    pattern: /(?:什么时候.*(?:认识|相识|相遇|遇见))|(?:(?:认识|相识|相遇|遇见).*什么时候)/u,
    keywords: ["相遇", "认识", "日期"]
  },
  {
    pattern: /(?:喜欢|偏好|爱好)/u,
    keywords: ["喜欢", "偏好"]
  }
]);

function normalizeMemoryQuery(value) {
  if (value == null) return "";
  return String(value)
    .normalize("NFKC")
    .trim()
    .slice(0, MAX_QUERY_CHARACTERS)
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ");
}

function extractMemoryKeywords(value, options = {}) {
  const normalized = normalizeMemoryQuery(value);
  const requestedLimit = Number(options.maxKeywords ?? DEFAULT_MAX_KEYWORDS);
  const maxKeywords = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 12)
    : DEFAULT_MAX_KEYWORDS;
  if (!normalized) return Object.freeze({ normalized, keywords: Object.freeze([]) });

  const keywords = [];
  const seen = new Set();
  const add = keyword => {
    const clean = String(keyword || "").trim().toLocaleLowerCase();
    if (keywords.length >= maxKeywords || clean.length < 2 || STOP_WORDS.includes(clean) || seen.has(clean)) return;
    seen.add(clean);
    keywords.push(clean);
  };

  for (const expansion of QUERY_EXPANSIONS) {
    if (expansion.pattern.test(normalized)) expansion.keywords.forEach(add);
  }

  const segments = normalized.match(/[\p{Script=Han}]+|[\p{Letter}\p{Number}][\p{Letter}\p{Number}._-]*/gu) || [];
  for (const segment of segments) {
    if (keywords.length >= maxKeywords) break;
    if (!/^\p{Script=Han}+$/u.test(segment)) {
      add(segment);
      continue;
    }
    let meaningful = segment;
    for (const stopWord of STOP_WORDS) meaningful = meaningful.split(stopWord).join(" ");
    for (const part of meaningful.split(/\s+/u).filter(Boolean)) {
      add(part);
      if (part.length > 2) {
        for (let index = 0; index < part.length - 1 && keywords.length < maxKeywords; index++) {
          add(part.slice(index, index + 2));
        }
      }
    }
  }

  return Object.freeze({ normalized, keywords: Object.freeze(keywords) });
}

module.exports = {
  DEFAULT_MAX_KEYWORDS,
  MAX_QUERY_CHARACTERS,
  QUERY_EXPANSIONS,
  STOP_WORDS,
  extractMemoryKeywords,
  normalizeMemoryQuery
};
