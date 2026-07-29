"use strict";

const { MEMORY_IMPORT_CATEGORIES, MemoryImportError } = require("./memory-import-contract");
const { categoryOfMemory } = require("./memory-import-preview");
const { detectMemoryIntent, extractMemoryKeywords, normalizeMemoryQuery } = require("./agent-memory-query");

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const DEFAULT_CHARACTER_BUDGET = 8000;
const MAX_CHARACTER_BUDGET = 20000;
const MAX_SCAN_ITEMS = 10000;
const COMPANION_RELATIONSHIP_RESERVE = 2;
const COMPANION_FACT_RESERVE = 2;
const DEFAULT_CORE_LIMIT = 8;
const DEFAULT_RECENT_LIMIT = 2;
const DEFAULT_OVERVIEW_PER_GROUP_LIMIT = 4;
const OVERVIEW_GROUP_ORDER = Object.freeze([
  "identityRelationship",
  "academicLife",
  "projectTechnology",
  "emotionPreferences",
  "peopleDailyLife",
  "recentChanges"
]);
const OVERVIEW_GROUPS = Object.freeze({
  identityRelationship: {
    label: "核心身份与关系",
    pattern: /(?:昵称|称呼|身份|关系|相遇|认识|AI\s*Companion|陪伴|沉的小世界|项目意义)/iu
  },
  academicLife: {
    label: "学业与现实生活",
    pattern: /(?:专业|数字媒体|年级|大四|毕设|毕业|学校|宿舍|作息|生活节奏|培训|模特|课程|实习|AIGC|游戏行业)/iu
  },
  projectTechnology: {
    label: "项目与技术上下文",
    pattern: /(?:dylan-heartbeat|小窝|聊天页|记忆库|议事厅|VPS|Gateway|前端|后端|部署|Service Worker|Session|Chat Sync|项目|修复|测试)/iu
  },
  emotionPreferences: {
    label: "情绪与互动偏好",
    pattern: /(?:情绪|焦虑|沮丧|害怕|担心|难过|压力|语气|说法|互动|偏好|喜欢|不喜欢|讨厌|情感边界|关系边界|情感|主动联系)/iu
  },
  peopleDailyLife: {
    label: "人际与生活细节",
    pattern: /(?:闺蜜|朋友|家人|家庭|社交|日常|习惯|饮食|爱好|生活|室友|同学|宠物|猫|游戏|穿搭)/iu
  },
  recentChanges: {
    label: "近期变化",
    pattern: /(?:最近|近期|当前|这几天|刚刚|进展|变化|完成|修复|部署|强调|更新)/iu
  }
});
const IDENTITY_TITLES = new Set(["Companion名称", "用户称呼"]);
const CORE_MEMORY_PATTERN = /(?:用户画像|基本资料|学习专业|专业|学校|学历|年级|学校阶段|生活节奏|作息|关系设定|相遇与关系|AI\s*Companion|沉的小世界|重要偏好|长期偏好|主动联系偏好|毕设方向|当前项目)/iu;
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

function safeCandidate(memory, options = {}) {
  if (!memory || (!options.includeIdentity && IDENTITY_TITLES.has(memory.title))) return false;
  return !SENSITIVE_MEMORY_PATTERN.test(`${memory.title || ""}\n${memory.content || ""}`);
}

function isCoreMemory(memory) {
  if (!memory || Number(memory.importance) < 4) return false;
  return CORE_MEMORY_PATTERN.test(memory.title || "");
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

function selectCoreCandidates(candidates, limit = DEFAULT_CORE_LIMIT) {
  return candidates
    .filter(isCoreMemory)
    .sort((left, right) => (
      Number(right.importance) - Number(left.importance)
      || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
      || String(left.id || "").localeCompare(String(right.id || ""))
    ))
    .slice(0, limit);
}

function selectRecentImportantCandidates(store, excludedIds, limit = DEFAULT_RECENT_LIMIT) {
  return listCandidates(store)
    .filter(memory => safeCandidate(memory) && Number(memory.importance) >= 4 && !excludedIds.has(memory.id))
    .sort((left, right) => (
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
      || Number(right.importance) - Number(left.importance)
    ))
    .slice(0, limit);
}

function overviewScore(memory, pattern) {
  const title = String(memory.title || "");
  const content = String(memory.content || "");
  const titleMatch = pattern.test(title) ? 4 : 0;
  const contentMatch = pattern.test(content) ? 2 : 0;
  return titleMatch + contentMatch + Number(memory.importance || 0);
}

function selectOverviewCandidates(candidates, perGroupLimit = DEFAULT_OVERVIEW_PER_GROUP_LIMIT) {
  const groups = Object.fromEntries(OVERVIEW_GROUP_ORDER.map(group => [group, []]));
  const selectedIds = new Set();

  for (const group of OVERVIEW_GROUP_ORDER) {
    const definition = OVERVIEW_GROUPS[group];
    let matches = candidates
      .filter(memory => !selectedIds.has(memory.id) && definition.pattern.test(
        `${memory.title || ""}\n${memory.content || ""}\n${memory.source || ""}`
      ));
    if (group === "recentChanges") {
      matches = candidates.filter(memory => !selectedIds.has(memory.id));
    }
    matches.sort((left, right) => (
      (group === "recentChanges"
        ? String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""))
        : overviewScore(right, definition.pattern) - overviewScore(left, definition.pattern))
      || Number(right.importance) - Number(left.importance)
      || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
    ));
    for (const memory of matches.slice(0, perGroupLimit)) {
      groups[group].push(memory);
      selectedIds.add(memory.id);
    }
  }

  return groups;
}

function overviewItems(groups, limit, characterBudget) {
  const selected = [];
  for (const group of OVERVIEW_GROUP_ORDER) {
    for (const memory of groups[group]) {
      if (selected.length >= limit) break;
      selected.push({ memory, group });
    }
  }

  const items = [];
  let usedCharacters = 0;
  for (const { memory, group } of selected) {
    const title = boundedText(memory.title, 160) || null;
    let content = boundedText(memory.content, 420);
    const base = {
      id: memory.id,
      layer: "overview",
      category: categoryOfMemory(memory),
      categorySource: categorySource(memory),
      type: memory.type,
      title,
      content,
      importance: memory.importance,
      occurredAt: memory.occurredAt,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      sourceGroup: group,
      whySelected: `代表“${OVERVIEW_GROUPS[group].label}”的记忆`
    };
    let cost = JSON.stringify(base).length;
    const remaining = characterBudget - usedCharacters;
    if (remaining <= 0) break;
    if (cost > remaining) {
      content = content.slice(0, Math.max(0, content.length - (cost - remaining)));
      base.content = content;
      cost = JSON.stringify(base).length;
    }
    if (!content || cost > remaining) break;
    items.push(base);
    usedCharacters += cost;
  }
  return { items, usedCharacters };
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
    const memoryIntent = query.memoryIntent === "overview" || query.memoryIntent === "normal"
      ? query.memoryIntent
      : detectMemoryIntent(normalizedQuery);
    const extracted = extractMemoryKeywords(normalizedQuery);

    const candidates = listCandidates(this.store, keyword);
    const safeCandidates = candidates.filter(safeCandidate);
    if (memoryIntent === "overview") {
      const overviewSafeCandidates = candidates.filter(memory => safeCandidate(memory, { includeIdentity: true }));
      const requestedPerGroup = Number(query.perGroupLimit ?? DEFAULT_OVERVIEW_PER_GROUP_LIMIT);
      const perGroupLimit = Number.isInteger(requestedPerGroup)
        ? Math.max(1, Math.min(6, requestedPerGroup))
        : DEFAULT_OVERVIEW_PER_GROUP_LIMIT;
      const groups = selectOverviewCandidates(overviewSafeCandidates, perGroupLimit);
      const bounded = overviewItems(groups, limit, characterBudget);
      const perGroupCount = Object.fromEntries(OVERVIEW_GROUP_ORDER.map(group => [
        group,
        bounded.items.filter(item => item.sourceGroup === group).length
      ]));
      return {
        items: bounded.items,
        meta: {
          limit,
          characterBudget,
          usedCharacters: bounded.usedCharacters,
          truncated: bounded.items.length < overviewSafeCandidates.length,
          memoryIntent,
          queryApplied: false,
          keywordCount: extracted.keywords.length,
          relevantCount: 0,
          candidateCount: candidates.length,
          safeCandidateCount: overviewSafeCandidates.length,
          rejectedCount: candidates.length - overviewSafeCandidates.length,
          rejectedReasons: {
            sensitive: candidates.length - overviewSafeCandidates.length,
            notSelectedByOverviewGroup: Math.max(0, overviewSafeCandidates.length - bounded.items.length)
          },
          selectedAlwaysOn: 0,
          selectedRelevant: 0,
          selectedRecent: 0,
          selectedGroups: OVERVIEW_GROUP_ORDER.filter(group => perGroupCount[group] > 0),
          perGroupCount,
          normalizedQuery: extracted.normalized
        }
      };
    }
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
    const querySelected = category
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
    const coreCandidates = category ? [] : selectCoreCandidates(safeCandidates);
    const selectedIds = new Set(coreCandidates.map(memory => memory.id));
    const relevantLimit = Math.max(0, limit - coreCandidates.length - DEFAULT_RECENT_LIMIT);
    const relevantLayer = querySelected
      .filter(memory => !selectedIds.has(memory.id))
      .slice(0, relevantLimit);
    relevantLayer.forEach(memory => selectedIds.add(memory.id));
    const recentCandidates = category
      ? []
      : selectRecentImportantCandidates(this.store, selectedIds);
    const layeredCandidates = category
      ? querySelected.map(memory => ({ memory, layer: "relevant" }))
      : [
          ...coreCandidates.map(memory => ({ memory, layer: "core" })),
          ...relevantLayer.map(memory => ({ memory, layer: "relevant" })),
          ...recentCandidates.map(memory => ({ memory, layer: "recent" }))
        ];
    const items = [];
    let usedCharacters = 0;
    for (let index = 0; index < layeredCandidates.length; index++) {
      const { memory, layer } = layeredCandidates[index];
      const memoryCategory = categoryOfMemory(memory);
      const remaining = characterBudget - usedCharacters;
      if (remaining <= 0 || items.length >= limit) break;
      const reservedForLater = category
        ? 0
        : layeredCandidates
          .slice(index + 1)
          .reduce((total, candidate) => total + minimumItemCharacters(candidate.memory), 0);
      const itemBudget = Math.max(0, remaining - Math.min(remaining, reservedForLater));
      const title = boundedText(memory.title, itemBudget);
      const content = boundedText(memory.content, itemBudget - title.length);
      if (!title && !content) break;
      usedCharacters += title.length + content.length;
      items.push({
        id: memory.id,
        layer,
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
        relevantCount: relevantCandidates.length,
        candidateCount: candidates.length,
        safeCandidateCount: safeCandidates.length,
        rejectedCount: candidates.length - safeCandidates.length,
        rejectedReasons: {
          identityOrSensitive: candidates.length - safeCandidates.length
        },
        memoryIntent,
        selectedGroups: [],
        perGroupCount: {},
        selectedAlwaysOn: items.filter(item => item.layer === "core").length,
        selectedRelevant: items.filter(item => item.layer === "relevant").length,
        selectedRecent: items.filter(item => item.layer === "recent").length,
        normalizedQuery: extracted.normalized
      }
    };
  }
}

module.exports = {
  COMPANION_FACT_RESERVE,
  COMPANION_RELATIONSHIP_RESERVE,
  CORE_MEMORY_PATTERN,
  DEFAULT_CORE_LIMIT,
  DEFAULT_OVERVIEW_PER_GROUP_LIMIT,
  DEFAULT_RECENT_LIMIT,
  IDENTITY_TITLES,
  SENSITIVE_MEMORY_PATTERN,
  AgentMemoryRetriever,
  DEFAULT_CHARACTER_BUDGET,
  DEFAULT_LIMIT,
  MAX_CHARACTER_BUDGET,
  MAX_LIMIT,
  OVERVIEW_GROUP_ORDER,
  OVERVIEW_GROUPS,
  compareRelevant,
  isCoreMemory,
  listCandidates,
  relevanceOf,
  searchKeywordCandidates,
  selectCoreCandidates,
  selectOverviewCandidates,
  selectRecentImportantCandidates,
  selectRelevantCandidates,
  selectWithFallback
};
