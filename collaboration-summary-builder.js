"use strict";

const MAX_RECORDS_PER_SECTION = 20;
const MAX_RECORD_TEXT_LENGTH = 500;
const CONTEXT_MARKER_PATTERN = /(?:<memory_reference_data|<identity_reference_data|<agent_identity_boundary|\bmemory\s+context\b|只读的长期记忆参考)/iu;
const DECISION_PATTERN = /(?:决定|共识|确定|结论|采纳|\bdecid(?:e|ed)\b|\bconsensus\b|\bagreed?\b)/iu;
const ACTION_PATTERN = /(?:下一步|行动项|待办|需要完成|负责|\btodo\b|\bnext\s+step\b|\baction\s+item\b|\bimplement\b)/iu;
const SUGGESTION_PATTERN = /(?:建议|提议|可以考虑|推荐|\bsuggest(?:ion|ed)?\b|\brecommend(?:ation|ed)?\b|\bshould\b|\bcould\b)/iu;

class CollaborationSummaryBuilderError extends Error {
  constructor(message, code = "COLLABORATION_SUMMARY_INVALID") {
    super(message);
    this.name = "CollaborationSummaryBuilderError";
    this.code = code;
  }
}

function cleanText(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, MAX_RECORD_TEXT_LENGTH)
    : "";
}

function sentences(content) {
  return String(content || "")
    .split(/(?<=[。！？.!?；;])|\n+/u)
    .map(cleanText)
    .filter(Boolean);
}

function addUnique(target, seen, entry) {
  const key = `${entry.agent}\u0000${entry.text.toLocaleLowerCase()}`;
  if (seen.has(key) || target.length >= MAX_RECORDS_PER_SECTION) return;
  seen.add(key);
  target.push(entry);
}

function validateRoom(room) {
  if (!room || typeof room !== "object" || Array.isArray(room)) {
    throw new CollaborationSummaryBuilderError("Room 必须是 object");
  }
  const topic = cleanText(room.topic);
  if (!topic) throw new CollaborationSummaryBuilderError("Room topic 无效");
  const participants = Array.isArray(room.participants)
    ? [...new Set(room.participants.filter(value => typeof value === "string" && value.trim())
      .map(value => value.trim()))]
    : [];
  if (!participants.length) {
    throw new CollaborationSummaryBuilderError("Room participants 无效");
  }
  if (!Array.isArray(room.messages)) {
    throw new CollaborationSummaryBuilderError("Room messages 无效");
  }
  return { topic, participants };
}

class CollaborationSummaryBuilder {
  build(room) {
    const { topic, participants } = validateRoom(room);
    const decisions = [];
    const suggestions = [];
    const actionItems = [];
    const seen = {
      decisions: new Set(),
      suggestions: new Set(),
      actionItems: new Set()
    };
    let includedMessages = 0;

    for (const message of room.messages) {
      const agent = typeof message?.agent === "string" ? message.agent.trim() : "";
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      if (!participants.includes(agent) || !content || CONTEXT_MARKER_PATTERN.test(content)) continue;
      includedMessages++;
      for (const text of sentences(content)) {
        const entry = Object.freeze({ agent, text });
        if (DECISION_PATTERN.test(text)) {
          addUnique(decisions, seen.decisions, entry);
        } else if (ACTION_PATTERN.test(text)) {
          addUnique(actionItems, seen.actionItems, Object.freeze({
            agent,
            text,
            status: "proposed"
          }));
        } else if (SUGGESTION_PATTERN.test(text)) {
          addUnique(suggestions, seen.suggestions, entry);
        }
      }
    }

    const activeParticipants = participants.filter(agent =>
      room.messages.some(message =>
        message?.agent === agent &&
        typeof message.content === "string" &&
        message.content.trim() &&
        !CONTEXT_MARKER_PATTERN.test(message.content)
      )
    );
    const summary = includedMessages === 0
      ? `议题“${topic}”暂无可记录的讨论内容。`
      : `议题“${topic}”共有 ${includedMessages} 条有效发言；参与发言：${activeParticipants.join("、")}。记录了 ${decisions.length} 项决定、${suggestions.length} 项建议和 ${actionItems.length} 项待办建议。`;

    return {
      topic,
      participants: [...participants],
      summary,
      decisions: decisions.map(entry => ({ ...entry })),
      suggestions: suggestions.map(entry => ({ ...entry })),
      actionItems: actionItems.map(entry => ({ ...entry }))
    };
  }
}

module.exports = {
  ACTION_PATTERN,
  CollaborationSummaryBuilder,
  CollaborationSummaryBuilderError,
  CONTEXT_MARKER_PATTERN,
  DECISION_PATTERN,
  MAX_RECORDS_PER_SECTION,
  SUGGESTION_PATTERN,
  cleanText,
  sentences,
  validateRoom
};
