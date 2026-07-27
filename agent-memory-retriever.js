"use strict";

const { MEMORY_IMPORT_CATEGORIES, MemoryImportError } = require("./memory-import-contract");
const { categoryOfMemory } = require("./memory-import-preview");
const { extractMemoryKeywords, normalizeMemoryQuery } = require("./agent-memory-query");

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const DEFAULT_CHARACTER_BUDGET = 8000;
const MAX_CHARACTER_BUDGET = 20000;
const MAX_SCAN_ITEMS = 10000;
const COMPANION_RELATIONSHIP_RESERVE = 2;
const COMPANION_FACT_RESERVE = 2;
const IDENTITY_TITLES = new Set(["Companion名称", "用户称呼"]);
const SENSITIVE_MEMORY_PATTERN = /(?:\bapi[\s_-]*key\b|\b(?:access|bearer|device)?[\s_-]*token\b|\bpassword\b|\bpasswd\b|\bcookie\b|\bprivate[\s_-]*key\b|\botp\b|\bverification[\s_-]*code\b|API\s*密钥|访问令牌|密码|私钥|验证码|身份证|银行卡|银行账号|精确住址|门禁|医疗诊断|设备\s*token)/iu;

function categorySource(memory) {
  return /^memory-import:v1:(fact|preference|event|relationship):/.test(memory.source || "")
    ? "explicit"
    : "legacy_mapping";
}

function boundedText(value, remaining) {
  const text = typeof value === "string" ? value : "";
  return text.slice(0, Math.max(0, remaining));
}

function selectCompanionCandidates(candidates, limit) {
  const selected = [];
  const selectedIds = new Set();
  const add = memory => {
    if (!memory || selected.length >= limit || selectedIds.has(memory.id)) return;
    selected.push(memory);
    selectedIds.add(memory.id);
  };
  const categorized = candidates.map(memory => ({ memory, category: categoryOfMemory(memory) }));

  categorized
    .filter(value => value.category === "relationship")
    .slice(0, COMPANION_RELATIONSHIP_RESERVE)
    .forEach(value => add(value.memory));
  categorized
    .filter(value => value.category === "fact")
    .slice(0, COMPANION_FACT_RESERVE)
    .forEach(value => add(value.memory));
  categorized
    .filter(value => value.category === "preference" || value.category === "event")
    .forEach(value => add(value.memory));
  candidates.forEach(add);
  return selected;
}

function minimumItemCharacters(memory) {
  const title = typeof memory.title === "string" ? memory.title : "";
  const content = typeof memory.content === "string" ? memory.content : "";
  return title.length + (content.length ? 1 : 0);
}

function safeCandidate(memory) {
  if (!memory || IDENTITY_TITLES.has(memory.title)) return false;
  return !SENSITIVE_MEMORY_PATTERN.test(`${memory.title || ""}\n${memory.content || ""}`);
}

function normalizedText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase();
}

function relevanceOf(memory, normalizedQuery, keywords) {
  const title = normalizedText(memory.title);
  const content = normalizedText(memory.content);
  const titleHits = keywords.filter(keyword => title.includes(keyword));
  const contentHits = keywords.filter(keyword => content.includes(keyword));
  const uniqueHits = new Set([...titleHits, ...contentHits]);
  return {
    exactTitle: Boolean(title && title === normalizedQuery),
    titleHits: titleHits.length,
    uniqueHits: uniqueHits.size,
    contentHits: contentHits.length
  };
}

function compareRelevant(left, right) {
  const fields = ["exactTitle", "titleHits", "uniqueHits", "contentHits"];
  for (const field of fields) {
    const difference = Number(right.relevance[field]) - Number(left.relevance[field]);
    if (difference) return difference;
  }
  const importanceDifference = Number(right.memory.importance) - Number(left.memory.importance);
  if (importanceDifference) return importanceDifference;
  const updatedDifference = String(right.memory.updatedAt || "").localeCompare(String(left.memory.updatedAt || ""));
  if (updatedDifference) return updatedDifference;
  return String(right.memory.id || "").localeCompare(String(left.memory.id || ""));
}

function selectRelevantCandidates(candidates, normalizedQuery, keywords, limit, category) {
  if (!normalizedQuery || !keywords.length) return [];
  return candidates
    .filter(memory => !category || categoryOfMemory(memory) === category)
    .map(memory => ({ memory, relevance: relevanceOf(memory, normalizedQuery, keywords) }))
    .filter(value => value.relevance.uniqueHits > 0)
    .sort(compareRelevant)
    .slice(0, limit)
    .map(value => value.memory);
}

function selectWithFallback(candidates, relevant, limit) {
  const selected = [];
  const selectedIds = new Set();
  const add = memory => {
    if (!memory || selected.length >= limit || selectedIds.has(memory.id)) return;
    selected.push(memory);
    selectedIds.add(memory.id);
  };
  relevant.forEach(add);
  for (const category of ["relationship", "fact"]) {
    let count = selected.filter(memory => categoryOfMemory(memory) === category).length;
    for (const memory of candidates) {
      if (count >= 2 || selected.length >= limit) break;
      if (categoryOfMemory(memory) !== category || selectedIds.has(memory.id)) continue;
      add(memory);
      count++;
    }
  }
  candidates.forEach(add);
  return selected;
}

function listCandidates(store, keyword) {
  const candidates = [];
  let page = 1;
  while (candidates.length < MAX_SCAN_ITEMS) {
    const result = store.list({
      page,
      limit: 100,
      status: "active",
      sort: "importance",
      ...(keyword ? { keyword } : {})
    });
    candidates.push(...result.items);
    if (page >= result.meta.totalPages) break;
    page++;
  }
  return candidates.slice(0, MAX_SCAN_ITEMS);
}

function searchKeywordCandidates(store, keywords) {
  const candidates = [];
  const seen = new Set();
  for (const keyword of keywords) {
    for (const memory of listCandidates(store, keyword)) {
      if (seen.has(memory.id)) continue;
      seen.add(memory.id);
      candidates.push(memory);
      if (candidates.length >= MAX_SCAN_ITEMS) return candidates;
    }
  }
  return candidates;
}

class AgentMemoryRetriever {
  constructor({ store, defaultLimit = DEFAULT_LIMIT, defaultCharacterBudget = DEFAULT_CHARACTER_BUDGET } = {}) {
    if (!store || typeof store.list !== "function") throw new TypeError("StructuredMemoryStore 必填");
    this.store = store;
    this.defaultLimit = defaultLimit;
    this.defaultCharacterBudget = defaultCharacterBudget;
  }

  retrieve(query = {}) {
    const category = query.category == null ? null : String(query.category);
    if (category && !MEMORY_IMPORT_CATEGORIES.includes(category)) {
      throw new MemoryImportError("category 无效", "MEMORY_RUNTIME_QUERY_INVALID");
    }
    const limit = query.limit == null ? this.defaultLimit : Number(query.limit);
    const characterBudget = query.characterBudget == null ? this.defaultCharacterBudget : Number(query.characterBudget);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new MemoryImportError("limit 无效", "MEMORY_RUNTIME_QUERY_INVALID");
    }
    if (!Number.isInteger(characterBudget) || characterBudget < 1 || characterBudget > MAX_CHARACTER_BUDGET) {
      throw new MemoryImportError("characterBudget 无效", "MEMORY_RUNTIME_QUERY_INVALID");
    }
    const keyword = query.keyword == null ? undefined : String(query.keyword).trim();
    if (keyword !== undefined && (!keyword || keyword.length > 200)) {
      throw new MemoryImportError("keyword 无效", "MEMORY_RUNTIME_QUERY_INVALID");
    }
    const normalizedQuery = normalizeMemoryQuery(query.query);
    const extracted = extractMemoryKeywords(normalizedQuery);

    const candidates = listCandidates(this.store, keyword);
    const safeCandidates = candidates.filter(safeCandidate);
    const searchedCandidates = extracted.keywords.length
      ? searchKeywordCandidates(this.store, extracted.keywords).filter(safeCandidate)
      : [];

    const relevantCandidates = selectRelevantCandidates(
      searchedCandidates,
      extracted.normalized,
      extracted.keywords,
      limit,
      category
    );
    const filteredCandidates = category
      ? [
          ...relevantCandidates,
          ...safeCandidates.filter(memory =>
            categoryOfMemory(memory) === category &&
            !relevantCandidates.some(relevant => relevant.id === memory.id)
          )
        ].slice(0, limit)
      : relevantCandidates.length
        ? selectWithFallback(safeCandidates, relevantCandidates, limit)
        : selectCompanionCandidates(safeCandidates, limit);
    const items = [];
    let usedCharacters = 0;
    for (let index = 0; index < filteredCandidates.length; index++) {
      const memory = filteredCandidates[index];
      const memoryCategory = categoryOfMemory(memory);
      const remaining = characterBudget - usedCharacters;
      if (remaining <= 0 || items.length >= limit) break;
      const reservedForLater = category
        ? 0
        : filteredCandidates
          .slice(index + 1)
          .reduce((total, candidate) => total + minimumItemCharacters(candidate), 0);
      const itemBudget = Math.max(0, remaining - Math.min(remaining, reservedForLater));
      const title = boundedText(memory.title, itemBudget);
      const content = boundedText(memory.content, itemBudget - title.length);
      if (!title && !content) break;
      usedCharacters += title.length + content.length;
      items.push({
        id: memory.id,
        category: memoryCategory,
        categorySource: categorySource(memory),
        type: memory.type,
        title: title || null,
        content,
        importance: memory.importance,
        occurredAt: memory.occurredAt,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt
      });
    }
    return {
      items,
      meta: {
        limit,
        characterBudget,
        usedCharacters,
        truncated: items.length < safeCandidates.length,
        queryApplied: Boolean(extracted.normalized && extracted.keywords.length),
        keywordCount: extracted.keywords.length,
        relevantCount: relevantCandidates.length
      }
    };
  }
}

module.exports = {
  COMPANION_FACT_RESERVE,
  COMPANION_RELATIONSHIP_RESERVE,
  IDENTITY_TITLES,
  SENSITIVE_MEMORY_PATTERN,
  AgentMemoryRetriever,
  DEFAULT_CHARACTER_BUDGET,
  DEFAULT_LIMIT,
  MAX_CHARACTER_BUDGET,
  MAX_LIMIT,
  compareRelevant,
  listCandidates,
  relevanceOf,
  searchKeywordCandidates,
  selectRelevantCandidates,
  selectWithFallback
};
