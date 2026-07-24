"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  ChatGptCollaborationAgentAdapter,
  ChenCollaborationAgentAdapter,
  CollaborationAgentAdapter
} = require("../collaboration-agent-adapter");
const { CollaborationRuntime } = require("../collaboration-runtime");
const { CollaborationSessionService } = require("../collaboration-session-service");

function fixture({ failAgent = null } = {}) {
  let roomSequence = 0;
  const calls = { chen: [], chatgpt: [], memoryReads: 0 };
  const sessionService = new CollaborationSessionService({
    idFactory: () => `runtime-room-${++roomSequence}`,
    now: () => "2026-07-24T15:00:00.000Z"
  });
  const chen = new ChenCollaborationAgentAdapter({
    gateway: {
      async generate(input) {
        calls.chen.push(input);
        if (failAgent === "chen") throw new Error("fake chen failure");
        return { content: `chen-turn-${calls.chen.length}` };
      }
    },
    memoryReader: {
      retrieve() {
        calls.memoryReads++;
        return { items: [{ category: "fact", content: "private-memory-reference" }] };
      }
    },
    memoryContextBuilder: {
      build() {
        return {
          role: "system",
          content: "<memory_reference_data>private-memory-reference</memory_reference_data>"
        };
      }
    }
  });
  const chatgpt = new ChatGptCollaborationAgentAdapter({
    adapter: {
      async generate(input) {
        calls.chatgpt.push(input);
        if (failAgent === "chatgpt") throw new Error("fake chatgpt failure");
        return { content: `chatgpt-turn-${calls.chatgpt.length}` };
      }
    }
  });
  const agentAdapter = new CollaborationAgentAdapter({ chen, chatgpt });
  return {
    calls,
    sessionService,
    runtime: new CollaborationRuntime({ sessionService, agentAdapter })
  };
}

test("both Agents participate in participant order and messages are saved in that order", async () => {
  const { runtime } = fixture();
  const room = runtime.createDiscussion({
    topic: "如何建设一个圆桌？",
    participants: ["chen", "chatgpt"]
  });

  const state = await runtime.runTurn(room.id);

  assert.deepEqual(state.messages.map(message => [message.agent, message.content]), [
    ["chen", "chen-turn-1"],
    ["chatgpt", "chatgpt-turn-1"]
  ]);
});

test("chen receives Memory Context while chatgpt receives only discussion context", async () => {
  const { runtime, calls } = fixture();
  const room = runtime.createDiscussion({
    topic: "隔离上下文",
    participants: ["chen", "chatgpt"]
  });

  await runtime.runTurn(room.id);

  assert.equal(calls.memoryReads, 1);
  assert.match(JSON.stringify(calls.chen[0]), /memory_reference_data/);
  assert.doesNotMatch(JSON.stringify(calls.chatgpt[0]), /memory_reference_data|private-memory-reference/);
  assert.match(JSON.stringify(calls.chatgpt[0]), /chen-turn-1/);
});

test("rooms remain isolated across turns", async () => {
  const { runtime } = fixture();
  const first = runtime.createDiscussion({ topic: "房间一", participants: ["chen"] });
  const second = runtime.createDiscussion({ topic: "房间二", participants: ["chatgpt"] });

  await runtime.runTurn(first.id);
  const secondState = await runtime.runTurn(second.id);

  assert.equal(secondState.topic, "房间二");
  assert.deepEqual(secondState.messages.map(message => message.agent), ["chatgpt"]);
  assert.doesNotMatch(JSON.stringify(secondState), /chen-turn/);
});

test("a failed Agent leaves the room unchanged", async () => {
  const { runtime, sessionService, calls } = fixture({ failAgent: "chatgpt" });
  const room = runtime.createDiscussion({
    topic: "失败原子性",
    participants: ["chen", "chatgpt"]
  });

  await assert.rejects(runtime.runTurn(room.id), /fake chatgpt failure/);

  assert.equal(calls.chen.length, 1);
  assert.equal(calls.chatgpt.length, 1);
  assert.deepEqual(sessionService.getContext(room.id).messages, []);
});

test("runtime has no Memory Writer, persistence, Chat, Proactive, or Wake integration", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "collaboration-runtime.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /StructuredMemoryStore|MemoryWriter|EventStore|Proactive|Wake|fetch\s*\(/);
  assert.doesNotMatch(source, /sessionService\.(?:update|delete|archive)|memory\.(?:create|update|delete|archive)/);
});
