"use strict";

const {
  MAX_MESSAGES_PER_ROOM,
  MAX_MESSAGE_LENGTH
} = require("./collaboration-session-service");

const MAX_AGENT_INPUT_MESSAGES = 100;

class CollaborationRuntimeError extends Error {
  constructor(message, code = "COLLABORATION_RUNTIME_INVALID") {
    super(message);
    this.name = "CollaborationRuntimeError";
    this.code = code;
  }
}

function discussionMessages(room, pending = [], currentAgent) {
  const history = [...room.messages, ...pending].slice(-(MAX_AGENT_INPUT_MESSAGES - 1));
  return [
    { role: "user", content: `讨论主题：${room.topic}` },
    ...history.map(message => ({
      role: message.agent === currentAgent ? "assistant" : "user",
      content: `[${message.agent}] ${message.content}`
    }))
  ];
}

function validAgentResponse(response, expectedAgent) {
  if (
    !response ||
    response.agent !== expectedAgent ||
    typeof response.content !== "string" ||
    !response.content.trim() ||
    response.content.trim().length > MAX_MESSAGE_LENGTH
  ) {
    throw new CollaborationRuntimeError(
      "Agent 返回了无法保存的消息",
      "COLLABORATION_AGENT_RESPONSE_INVALID"
    );
  }
  return { agent: expectedAgent, content: response.content.trim() };
}

class CollaborationRuntime {
  #sessionService;
  #agentAdapter;
  #runningRooms = new Set();

  constructor({ sessionService, agentAdapter } = {}) {
    if (
      !sessionService ||
      typeof sessionService.createRoom !== "function" ||
      typeof sessionService.getContext !== "function" ||
      typeof sessionService.addMessage !== "function"
    ) {
      throw new TypeError("CollaborationSessionService 必填");
    }
    if (!agentAdapter || typeof agentAdapter.invoke !== "function") {
      throw new TypeError("CollaborationAgentAdapter 必填");
    }
    this.#sessionService = sessionService;
    this.#agentAdapter = agentAdapter;
  }

  createDiscussion(room) {
    if (!room || typeof room !== "object" || Array.isArray(room)) {
      throw new CollaborationRuntimeError("room 格式无效");
    }
    return this.#sessionService.createRoom(room.topic, room.participants);
  }

  async runTurn(roomId, { signal } = {}) {
    if (this.#runningRooms.has(roomId)) {
      throw new CollaborationRuntimeError(
        "房间已有讨论正在进行",
        "COLLABORATION_TURN_IN_PROGRESS"
      );
    }
    this.#runningRooms.add(roomId);
    try {
      const room = this.#sessionService.getContext(roomId);
      if (room.messages.length + room.participants.length > MAX_MESSAGES_PER_ROOM) {
        throw new CollaborationRuntimeError(
          "房间没有足够空间保存完整回合",
          "COLLABORATION_MESSAGE_LIMIT"
        );
      }

      const pending = [];
      for (const agent of room.participants) {
        const response = await this.#agentAdapter.invoke(agent, {
          messages: discussionMessages(room, pending, agent),
          signal
        });
        pending.push(validAgentResponse(response, agent));
      }

      for (const message of pending) {
        this.#sessionService.addMessage(room.id, message);
      }
      return this.#sessionService.getContext(room.id);
    } finally {
      this.#runningRooms.delete(roomId);
    }
  }
}

module.exports = {
  CollaborationRuntime,
  CollaborationRuntimeError,
  MAX_AGENT_INPUT_MESSAGES,
  discussionMessages,
  validAgentResponse
};
