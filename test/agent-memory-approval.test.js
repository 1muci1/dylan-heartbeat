"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  AgentMemoryApproval,
  AgentMemoryApprovalError
} = require("../agent-memory-approval");

function proposal(overrides = {}) {
  return {
    proposalId: "proposal-1",
    category: "fact",
    title: "长期事实",
    content: "用户明确表示：我的专业是数字媒体艺术。",
    importance: 3,
    ...overrides
  };
}

test("clear preference is automatically approved", () => {
  const approval = new AgentMemoryApproval();
  const input = proposal({
    category: "preference",
    title: "长期偏好",
    content: "用户明确表示：我一直喜欢简洁直接的回复。"
  });

  assert.deepEqual(approval.evaluate(input), {
    status: "approved",
    proposal: input
  });
});

test("completed important event is automatically approved", () => {
  const approval = new AgentMemoryApproval();
  const input = proposal({
    category: "event",
    title: "重要事件",
    content: "用户明确表示：我完成了毕业项目的重要里程碑。",
    importance: 4
  });

  assert.equal(approval.evaluate(input).status, "approved");
});

test("relationship and identity proposals require review", () => {
  const approval = new AgentMemoryApproval();

  assert.equal(approval.evaluate(proposal({
    category: "relationship",
    title: "互动关系",
    content: "用户明确确认了一项长期互动规则。",
    importance: 4
  })).status, "needs_review");
  assert.equal(approval.evaluate(proposal({
    category: "fact",
    title: "Agent身份",
    content: "用户明确表示当前 Agent 有一个身份名称。",
    importance: 5
  })).status, "needs_review");
});

test("explicit user nickname is automatically approved without changing identity", () => {
  const approval = new AgentMemoryApproval();
  assert.equal(approval.evaluate(proposal({
    category: "relationship",
    title: "用户称呼",
    content: "用户明确表示：请叫我辞辞。",
    importance: 4
  })).status, "approved");
});

test("clear long-term project fact is automatically approved", () => {
  const approval = new AgentMemoryApproval();
  assert.equal(approval.evaluate(proposal({
    category: "fact",
    title: "长期项目",
    content: "用户明确表示：我正在长期维护 AI Companion 项目。",
    importance: 4
  })).status, "approved");
});

test("sensitive, inferred, temporary, and emotional judgments are rejected", () => {
  const approval = new AgentMemoryApproval();
  for (const content of [
    "用户明确表示：Bearer token 是 secret。",
    "模型推断用户可能喜欢被频繁提醒。",
    "用户现在有点累。",
    "用户对 AI 产生情感依赖。"
  ]) {
    assert.equal(approval.evaluate(proposal({
      category: "preference",
      title: "候选",
      content
    })).status, "rejected");
  }
});

test("rejected proposal never enters Writer", () => {
  let writerCalls = 0;
  const writer = {
    create() {
      writerCalls++;
    }
  };
  const approval = new AgentMemoryApproval();
  const decision = approval.evaluate(proposal({
    category: "fact",
    title: "敏感候选",
    content: "用户的银行卡是 123456。"
  }));

  assert.equal(decision.status, "rejected");
  assert.equal(writerCalls, 0);
  assert.equal(typeof writer.create, "function");
});

test("Approval owns no create, update, delete, or archive capability", () => {
  const approval = new AgentMemoryApproval();
  assert.equal(approval.create, undefined);
  assert.equal(approval.update, undefined);
  assert.equal(approval.delete, undefined);
  assert.equal(approval.archive, undefined);
});

test("invalid proposals fail with stable errors", () => {
  const approval = new AgentMemoryApproval();
  assert.throws(
    () => approval.evaluate(proposal({ proposalId: "invalid id" })),
    error => error instanceof AgentMemoryApprovalError &&
      error.code === "AGENT_MEMORY_APPROVAL_INPUT_INVALID"
  );
  assert.throws(
    () => approval.evaluate({ ...proposal(), source: "forbidden" }),
    error => error instanceof AgentMemoryApprovalError &&
      error.code === "AGENT_MEMORY_APPROVAL_FIELD_FORBIDDEN"
  );
});
