"use strict";

const crypto = require("node:crypto");

const COLLABORATION_AGENTS = Object.freeze(["chen", "chatgpt"]);
const AGENT_SET = new Set(COLLABORATION_AGENTS);
const MAX_TOPIC_LENGTH = 240;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES_PER_ROOM = 200;

class CollaborationSessionError extends Error {
  constructor(message, code = "COLLABORATION_SESSION_INVALID") {
    super(message);
    this.name = "CollaborationSessionError";
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new CollaborationSessionError(`${field} 格式无效`);
  }
  return value.trim();
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new CollaborationSessionError("participants 至少包含一个 Agent");
  }
  const normalized = [...new Set(participants)];
  if (normalized.some(agent => !AGENT_SET.has(agent))) {
    throw new CollaborationSessionError(
      "participants 包含不支持的 Agent",
      "COLLABORATION_AGENT_UNSUPPORTED"
    );
  }
  return normalized;
}

function cloneRoom(room) {
  return {
    id: room.id,
    topic: room.topic,
    participants: [...room.participants],
    createdAt: room.createdAt,
    messages: room.messages.map(message => ({ ...message })),
    summary: room.summary
  };
}

class CollaborationSessionService {
  #rooms = new Map();
  #idFactory;
  #now;

  constructor({
    idFactory = () => `collaboration-${crypto.randomUUID()}`,
    now = () => new Date().toISOString()
  } = {}) {
    if (typeof idFactory !== "function" || typeof now !== "function") {
      throw new TypeError("idFactory 和 now 必须是函数");
    }
    this.#idFactory = idFactory;
    this.#now = now;
  }

  #room(roomId) {
    if (typeof roomId !== "string" || !roomId.trim()) {
      throw new CollaborationSessionError("roomId 格式无效");
    }
    const room = this.#rooms.get(roomId.trim());
    if (!room) {
      throw new CollaborationSessionError(
        "讨论房间不存在",
        "COLLABORATION_ROOM_NOT_FOUND"
      );
    }
    return room;
  }

  createRoom(topic, participants) {
    const room = {
      id: requiredText(this.#idFactory(), "roomId", 160),
      topic: requiredText(topic, "topic", MAX_TOPIC_LENGTH),
      participants: normalizeParticipants(participants),
      createdAt: this.#now(),
      messages: [],
      summary: null
    };
    if (this.#rooms.has(room.id)) {
      throw new CollaborationSessionError(
        "roomId 已存在",
        "COLLABORATION_ROOM_CONFLICT"
      );
    }
    this.#rooms.set(room.id, room);
    return cloneRoom(room);
  }

  addMessage(roomId, message) {
    const room = this.#room(roomId);
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new CollaborationSessionError("message 格式无效");
    }
    const unknown = Object.keys(message).find(field => !["agent", "content"].includes(field));
    if (unknown) throw new CollaborationSessionError(`message 不允许字段：${unknown}`);
    const agent = requiredText(message.agent, "agent", 20);
    if (!AGENT_SET.has(agent) || !room.participants.includes(agent)) {
      throw new CollaborationSessionError(
        "Agent 不属于此房间",
        "COLLABORATION_AGENT_FORBIDDEN"
      );
    }
    if (room.messages.length >= MAX_MESSAGES_PER_ROOM) {
      throw new CollaborationSessionError(
        "房间消息数量已达上限",
        "COLLABORATION_MESSAGE_LIMIT"
      );
    }
    const stored = {
      id: `message-${room.messages.length + 1}`,
      agent,
      content: requiredText(message.content, "content", MAX_MESSAGE_LENGTH),
      createdAt: this.#now()
    };
    room.messages.push(stored);
    room.summary = null;
    return { ...stored };
  }

  getContext(roomId) {
    return cloneRoom(this.#room(roomId));
  }

  generateSummary(roomId) {
    const room = this.#room(roomId);
    const counts = Object.fromEntries(
      room.participants.map(agent => [
        agent,
        room.messages.filter(message => message.agent === agent).length
      ])
    );
    const activeAgents = room.participants.filter(agent => counts[agent] > 0);
    room.summary = room.messages.length === 0
      ? `“${room.topic}”尚未开始讨论。`
      : `“${room.topic}”已完成 ${room.messages.length} 条讨论消息，参与发言：${activeAgents.join("、")}。`;
    return {
      roomId: room.id,
      topic: room.topic,
      messageCount: room.messages.length,
      participantMessageCounts: { ...counts },
      summary: room.summary,
      generatedAt: this.#now()
    };
  }
}

module.exports = {
  COLLABORATION_AGENTS,
  CollaborationSessionError,
  CollaborationSessionService,
  MAX_MESSAGES_PER_ROOM,
  MAX_MESSAGE_LENGTH,
  MAX_TOPIC_LENGTH
};
