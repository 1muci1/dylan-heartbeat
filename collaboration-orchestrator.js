"use strict";

const ERROR_DEFINITIONS = Object.freeze({
  selector: Object.freeze({
    code: "COLLABORATION_SELECTOR_FAILED",
    message: "无法为任务选择 Collaboration Agent"
  }),
  room: Object.freeze({
    code: "COLLABORATION_ROOM_CREATE_FAILED",
    message: "无法创建 Collaboration Room"
  }),
  agent: Object.freeze({
    code: "COLLABORATION_AGENT_RUN_FAILED",
    message: "Collaboration Agent 讨论失败"
  }),
  summary: Object.freeze({
    code: "COLLABORATION_SUMMARY_FAILED",
    message: "无法生成 Collaboration 总结"
  })
});

class CollaborationOrchestratorError extends Error {
  constructor(stage, originalCode = null) {
    const definition = ERROR_DEFINITIONS[stage] || ERROR_DEFINITIONS.agent;
    super(definition.message);
    this.name = "CollaborationOrchestratorError";
    this.code = definition.code;
    this.stage = stage;
    this.originalCode = typeof originalCode === "string" ? originalCode : null;
  }
}

function stableError(stage, error) {
  if (error instanceof CollaborationOrchestratorError) return error;
  return new CollaborationOrchestratorError(stage, error?.code);
}

class CollaborationOrchestrator {
  #selector;
  #runtime;
  #summaryBuilder;
  #historyService;

  constructor({ selector, runtime, summaryBuilder, historyService } = {}) {
    if (!selector || typeof selector.select !== "function") {
      throw new TypeError("AgentSelector 必填");
    }
    if (
      !runtime ||
      typeof runtime.createDiscussion !== "function" ||
      typeof runtime.runTurn !== "function"
    ) {
      throw new TypeError("CollaborationRuntime 必填");
    }
    if (!summaryBuilder || typeof summaryBuilder.build !== "function") {
      throw new TypeError("CollaborationSummaryBuilder 必填");
    }
    if (!historyService || typeof historyService.save !== "function") {
      throw new TypeError("CollaborationHistoryService 必填");
    }
    this.#selector = selector;
    this.#runtime = runtime;
    this.#summaryBuilder = summaryBuilder;
    this.#historyService = historyService;
  }

  async startTask({ task } = {}) {
    let selection;
    try {
      selection = this.#selector.select({ task });
      if (!Array.isArray(selection?.agents) || selection.agents.length === 0) {
        throw new Error("empty selection");
      }
    } catch (error) {
      throw stableError("selector", error);
    }

    let room;
    try {
      room = this.#runtime.createDiscussion({
        topic: task,
        participants: [...selection.agents]
      });
    } catch (error) {
      throw stableError("room", error);
    }

    let discussionRoom;
    try {
      discussionRoom = await this.#runtime.runTurn(room.id);
    } catch (error) {
      throw stableError("agent", error);
    }

    let councilRecord;
    try {
      councilRecord = this.#summaryBuilder.build(discussionRoom);
    } catch (error) {
      throw stableError("summary", error);
    }

    let historySaved = false;
    try {
      this.#historyService.save({
        roomId: discussionRoom.id,
        topic: councilRecord.topic,
        participants: [...councilRecord.participants],
        summary: councilRecord.summary
      });
      historySaved = true;
    } catch {
      historySaved = false;
    }

    const finalRoom = {
      ...discussionRoom,
      participants: [...discussionRoom.participants],
      messages: discussionRoom.messages.map(message => ({ ...message })),
      summary: councilRecord.summary
    };
    return {
      room: finalRoom,
      agents: [...selection.agents],
      messages: finalRoom.messages.map(message => ({ ...message })),
      summary: councilRecord.summary,
      historySaved
    };
  }
}

module.exports = {
  CollaborationOrchestrator,
  CollaborationOrchestratorError,
  ERROR_DEFINITIONS,
  stableError
};
