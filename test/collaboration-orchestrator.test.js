"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { AgentProfileRegistry } = require("../agent-profile-registry");
const { AgentSelector } = require("../agent-selector");
const {
  CollaborationOrchestrator,
  CollaborationOrchestratorError
} = require("../collaboration-orchestrator");
const { CollaborationHistoryService } = require("../collaboration-history-service");
const { CollaborationRuntime } = require("../collaboration-runtime");
const { CollaborationSessionService } = require("../collaboration-session-service");
const { CollaborationSummaryBuilder } = require("../collaboration-summary-builder");
const { applyMigrations } = require("../database");

function fixture() {
  let roomSequence = 0;
  const calls = [];
  const profileRegistry = new AgentProfileRegistry();
  const selector = new AgentSelector({ profileRegistry });
  const sessionService = new CollaborationSessionService({
    idFactory: () => `orchestrator-room-${++roomSequence}`,
    now: () => "2026-07-24T20:00:00.000Z"
  });
  const runtime = new CollaborationRuntime({
    sessionService,
    agentAdapter: {
      async invoke(agent, input) {
        calls.push({ agent, input });
        return { agent, content: `${agent} completed the turn` };
      }
    }
  });
  const summaryBuilder = new CollaborationSummaryBuilder();
  const historyService = new CollaborationHistoryService({
    idFactory: () => `orchestrator-history-${roomSequence}`,
    now: () => "2026-07-24T20:01:00.000Z"
  });
  return {
    calls,
    profileRegistry,
    selector,
    sessionService,
    runtime,
    summaryBuilder,
    historyService,
    orchestrator: new CollaborationOrchestrator({
      selector,
      runtime,
      summaryBuilder,
      historyService
    })
  };
}

test("creative tasks automatically select chen and create a completed room", async () => {
  const { orchestrator } = fixture();
  const result = await orchestrator.startTask({ task: "Create a companion story." });

  assert.deepEqual(result.agents, ["chen"]);
  assert.deepEqual(result.room.participants, ["chen"]);
  assert.deepEqual(result.messages.map(message => message.agent), ["chen"]);
  assert.match(result.summary, /1 条有效发言/);
  assert.equal(result.historySaved, true);
});

test("technical tasks automatically select chatgpt", async () => {
  const { orchestrator } = fixture();
  const result = await orchestrator.startTask({
    task: "Analyze the engineering architecture."
  });

  assert.deepEqual(result.agents, ["chatgpt"]);
  assert.deepEqual(result.messages.map(message => message.agent), ["chatgpt"]);
});

test("combined tasks select both Agents and Runtime invokes them in participant order", async () => {
  const { orchestrator, calls } = fixture();
  const result = await orchestrator.startTask({
    task: "Create a companion story and plan the engineering architecture."
  });

  assert.deepEqual(result.agents, ["chen", "chatgpt"]);
  assert.deepEqual(calls.map(call => call.agent), ["chen", "chatgpt"]);
  assert.deepEqual(result.messages.map(message => message.agent), ["chen", "chatgpt"]);
  assert.equal(calls[1].input.messages.some(message => message.content.includes("chen completed")), true);
});

test("Orchestrator calls Selector, room creation, Runtime, Summary Builder, and History in order", async () => {
  const order = [];
  const orchestrator = new CollaborationOrchestrator({
    selector: {
      select() {
        order.push("select");
        return { agents: ["chen"], reasons: ["test"] };
      }
    },
    runtime: {
      createDiscussion() {
        order.push("create");
        return { id: "ordered-room" };
      },
      async runTurn() {
        order.push("run");
        return {
          id: "ordered-room",
          topic: "creative",
          participants: ["chen"],
          messages: []
        };
      }
    },
    summaryBuilder: {
      build() {
        order.push("build-summary");
        return {
          topic: "creative",
          participants: ["chen"],
          summary: "ordered summary"
        };
      }
    },
    historyService: {
      save() {
        order.push("save-history");
      }
    }
  });

  await orchestrator.startTask({ task: "creative" });
  assert.deepEqual(order, ["select", "create", "run", "build-summary", "save-history"]);
});

test("Memory count and Agent Profiles remain unchanged", async t => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  t.after(() => database.close());
  const beforeMemory = Number(
    database.prepare("SELECT COUNT(*) count FROM memory_items").get().count
  );
  const { orchestrator, profileRegistry } = fixture();
  const beforeProfiles = profileRegistry.list();

  await orchestrator.startTask({ task: "memory architecture" });

  const afterMemory = Number(
    database.prepare("SELECT COUNT(*) count FROM memory_items").get().count
  );
  assert.equal(afterMemory, beforeMemory);
  assert.deepEqual(profileRegistry.list(), beforeProfiles);
});

test("Selector, Room creation, and Agent failures map to stable errors", async () => {
  const stages = [
    {
      expected: ["selector", "COLLABORATION_SELECTOR_FAILED"],
      selector: { select() { throw Object.assign(new Error("private"), { code: "PRIVATE_SELECTOR" }); } },
      runtime: { createDiscussion() {}, async runTurn() {} }
    },
    {
      expected: ["room", "COLLABORATION_ROOM_CREATE_FAILED"],
      selector: { select() { return { agents: ["chen"] }; } },
      runtime: { createDiscussion() { throw new Error("private"); }, async runTurn() {} }
    },
    {
      expected: ["agent", "COLLABORATION_AGENT_RUN_FAILED"],
      selector: { select() { return { agents: ["chen"] }; } },
      runtime: { createDiscussion() { return { id: "room" }; }, async runTurn() { throw new Error("private"); } }
    }
  ];
  for (const value of stages) {
    const orchestrator = new CollaborationOrchestrator({
      selector: value.selector,
      runtime: value.runtime,
      summaryBuilder: { build() { return { topic: "task", participants: ["chen"], summary: "summary" }; } },
      historyService: { save() {} }
    });
    await assert.rejects(
      orchestrator.startTask({ task: "task" }),
      error => error instanceof CollaborationOrchestratorError &&
        error.stage === value.expected[0] &&
        error.code === value.expected[1] &&
        !error.message.includes("private")
    );
  }
});

test("Orchestrator owns no Memory, Writer, Identity, Chat, network, or database integration", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "collaboration-orchestrator.js"),
    "utf8"
  );

  assert.doesNotMatch(
    source,
    /StructuredMemoryStore|MemoryWriter|IdentityBoundary|ChatRuntime|EventStore|fetch\s*\(|database|migration/i
  );
  assert.doesNotMatch(source, /\.(?:register|update|delete|archive)\s*\(/);
});
