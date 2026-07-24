"use strict";

const { MEMORY_IMPORT_CATEGORIES, MemoryImportError } = require("./memory-import-contract");
const { categoryOfMemory } = require("./memory-import-preview");

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const DEFAULT_CHARACTER_BUDGET = 8000;
const MAX_CHARACTER_BUDGET = 20000;
const MAX_SCAN_ITEMS = 10000;
const COMPANION_RELATIONSHIP_RESERVE = 2;
const COMPANION_FACT_RESERVE = 2;

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

    const candidates = [];
    let page = 1;
    while (candidates.length < MAX_SCAN_ITEMS) {
      const result = this.store.list({
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

    const filteredCandidates = category
      ? candidates.filter(memory => categoryOfMemory(memory) === category).slice(0, limit)
      : selectCompanionCandidates(candidates, limit);
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
    return { items, meta: { limit, characterBudget, usedCharacters, truncated: items.length < candidates.length } };
  }
}

module.exports = {
  COMPANION_FACT_RESERVE,
  COMPANION_RELATIONSHIP_RESERVE,
  AgentMemoryRetriever,
  DEFAULT_CHARACTER_BUDGET,
  DEFAULT_LIMIT,
  MAX_CHARACTER_BUDGET,
  MAX_LIMIT
};
