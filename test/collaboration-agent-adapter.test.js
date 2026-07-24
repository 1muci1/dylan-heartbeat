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

function fixture() {
  const calls = { chen: [], chatgpt: [], memory: 0 };
  const memoryContext = {
    role: "system",
    content: "<memory_reference_data>safe-reference</memory_reference_data>"
  };
  const chen = new ChenCollaborationAgentAdapter({
    gateway: {
      async generate(input) {
        calls.chen.push(input);
        return { content: "沉的回答" };
      }
    },
    memoryReader: {
      retrieve(query) {
        calls.memory++;
        assert.deepEqual(query, { limit: 8, characterBudget: 3000 });
        return { items: [{ category: "fact", content: "safe-reference" }] };
      }
    },
    memoryContextBuilder: {
      build(output) {
        assert.equal(output.items.length, 1);
        return memoryContext;
      }
    }
  });
  const chatgpt = new ChatGptCollaborationAgentAdapter({
    adapter: {
      async generate(input) {
        calls.chatgpt.push(input);
        return { content: "ChatGPT 的回答" };
      }
    }
  });
  return {
    calls,
    chen,
    chatgpt,
    adapter: new CollaborationAgentAdapter({ chen, chatgpt }),
    memoryContext
  };
}

test("chen invokes only the Gateway transport with read-only Memory Context", async () => {
  const { adapter, calls, memoryContext } = fixture();
  const result = await adapter.invoke("chen", {
    messages: [
      { role: "system", content: "room context" },
      { role: "user", content: "讨论主题" }
    ]
  });

  assert.deepEqual(result, { agent: "chen", content: "沉的回答" });
  assert.equal(calls.chen.length, 1);
  assert.equal(calls.chatgpt.length, 0);
  assert.equal(calls.memory, 1);
  assert.deepEqual(calls.chen[0].messages.map(message =>
    message.content === memoryContext.content ? "memory" : message.role
  ), ["system", "memory", "user"]);
});

test("chatgpt invokes its independent adapter without reading Memory", async () => {
  const { adapter, calls } = fixture();
  const messages = [{ role: "user", content: "独立讨论" }];
  const result = await adapter.invoke("chatgpt", { messages });

  assert.deepEqual(result, { agent: "chatgpt", content: "ChatGPT 的回答" });
  assert.equal(calls.chatgpt.length, 1);
  assert.equal(calls.chen.length, 0);
  assert.equal(calls.memory, 0);
  assert.deepEqual(calls.chatgpt[0].messages, messages);
});

test("both adapters return the same public message shape", async () => {
  const { adapter } = fixture();
  const input = { messages: [{ role: "user", content: "同一主题" }] };

  assert.deepEqual(Object.keys(await adapter.invoke("chen", input)), ["agent", "content"]);
  assert.deepEqual(Object.keys(await adapter.invoke("chatgpt", input)), ["agent", "content"]);
});

test("chen Memory Context cannot leak into a later chatgpt call", async () => {
  const { adapter, calls, memoryContext } = fixture();
  const sharedMessages = [{ role: "user", content: "共享圆桌消息" }];

  await adapter.invoke("chen", { messages: sharedMessages });
  await adapter.invoke("chatgpt", { messages: sharedMessages });

  assert.deepEqual(sharedMessages, [{ role: "user", content: "共享圆桌消息" }]);
  assert.equal(JSON.stringify(calls.chatgpt[0]).includes(memoryContext.content), false);
  assert.equal(calls.chatgpt[0].memoryContext, undefined);
});

test("adapter owns no persistence, Memory Writer, Identity, Wake, or Chat Runtime integration", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "collaboration-agent-adapter.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /StructuredMemoryStore|MemoryWriter|EventStore|IdentityBoundary|Wake/);
  assert.doesNotMatch(source, /\.(?:create|update|delete|archive)\s*\(/);
});
