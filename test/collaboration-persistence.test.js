"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { AgentProfileRegistry } = require("../agent-profile-registry");
const { AgentSelector } = require("../agent-selector");
const { CollaborationHistoryService } = require("../collaboration-history-service");
const { CollaborationOrchestrator } = require("../collaboration-orchestrator");
const { CollaborationRuntime } = require("../collaboration-runtime");
const { CollaborationSessionService } = require("../collaboration-session-service");
const { CollaborationSummaryBuilder } = require("../collaboration-summary-builder");
const { applyMigrations } = require("../database");

function fixture({ responseFor, historyService: suppliedHistory } = {}) {
  const sessionService = new CollaborationSessionService({
    idFactory: () => "persistence-room-1",
    now: () => "2026-07-24T23:30:00.000Z"
  });
  const runtime = new CollaborationRuntime({
    sessionService,
    agentAdapter: {
      async invoke(agent) {
        return {
          agent,
          content: responseFor?.(agent) ||
            (agent === "chen"
              ? "建议保留议事记录。"
              : "决定采用只读历史页面。")
        };
      }
    }
  });
  const profileRegistry = new AgentProfileRegistry();
  const selector = new AgentSelector({ profileRegistry });
  const historyService = suppliedHistory || new CollaborationHistoryService({
    idFactory: () => "persistence-history-1",
    now: () => "2026-07-24T23:31:00.000Z"
  });
  return {
    historyService,
    orchestrator: new CollaborationOrchestrator({
      selector,
      runtime,
      summaryBuilder: new CollaborationSummaryBuilder(),
      historyService
    })
  };
}

test("a successful discussion automatically saves one History record", async () => {
  const { orchestrator, historyService } = fixture();
  const result = await orchestrator.startTask({
    task: "Create a companion story and analyze its architecture."
  });

  assert.equal(result.historySaved, true);
  assert.equal(historyService.list().length, 1);
  assert.equal(historyService.list()[0].roomId, result.room.id);
});

test("History contains only topic, participants, safe summary, and generated time", async () => {
  const { orchestrator, historyService } = fixture();
  await orchestrator.startTask({
    task: "Create a companion story and analyze its architecture."
  });
  const saved = historyService.list()[0];

  assert.deepEqual(Object.keys(saved), [
    "id",
    "roomId",
    "topic",
    "participants",
    "summary",
    "createdAt"
  ]);
  assert.deepEqual(saved.participants, ["chen", "chatgpt"]);
  assert.equal(saved.createdAt, "2026-07-24T23:31:00.000Z");
  assert.equal(Object.hasOwn(saved, "messages"), false);
});

test("Persistence Hook leaves Memory count unchanged", async t => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  t.after(() => database.close());
  const before = Number(
    database.prepare("SELECT COUNT(*) count FROM memory_items").get().count
  );
  const { orchestrator } = fixture();

  await orchestrator.startTask({ task: "memory architecture" });

  const after = Number(
    database.prepare("SELECT COUNT(*) count FROM memory_items").get().count
  );
  assert.equal(after, before);
});

test("History never stores Memory or Identity Context from Agent messages", async () => {
  const secret = "private-context-value";
  const { orchestrator, historyService } = fixture({
    responseFor(agent) {
      return agent === "chen"
        ? `<memory_reference_data>${secret}</memory_reference_data>`
        : `<identity_reference_data>${secret}</identity_reference_data>`;
    }
  });

  const result = await orchestrator.startTask({ task: "memory architecture" });
  const serialized = JSON.stringify(historyService.list());

  assert.equal(result.historySaved, true);
  assert.doesNotMatch(
    serialized,
    /private-context-value|memory_reference_data|identity_reference_data/
  );
});

test("History save failure does not change the completed discussion result", async () => {
  const { orchestrator } = fixture({
    historyService: {
      save() {
        throw new Error("fake history failure");
      }
    }
  });

  const result = await orchestrator.startTask({
    task: "Create a companion story and analyze its architecture."
  });

  assert.equal(result.historySaved, false);
  assert.deepEqual(result.agents, ["chen", "chatgpt"]);
  assert.equal(result.messages.length, 2);
  assert.match(result.summary, /2 条有效发言/);
});
