"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  AgentIdentityBoundaryBuilder,
  DEFAULT_AGENT_NAME,
  HEADER
} = require("../agent-identity-boundary-builder");

function dataOf(message) {
  const match = message.content.match(
    /<agent_identity_boundary encoding="json">\n(.+)\n<\/agent_identity_boundary>$/s
  );
  assert.ok(match);
  return JSON.parse(match[1]);
}

test("builds a system-level AI Companion identity boundary", () => {
  const message = new AgentIdentityBoundaryBuilder().build();

  assert.equal(message.role, "system");
  assert.ok(message.content.startsWith(HEADER));
  assert.deepEqual(dataOf(message), {
    runtimeIdentity: {
      kind: "ai_companion",
      name: DEFAULT_AGENT_NAME
    }
  });
  assert.equal(/kiro|claude/iu.test(message.content), false);
});

test("identity boundary is independent from untrusted Memory-like input", () => {
  const builder = new AgentIdentityBoundaryBuilder();
  const baseline = builder.build();
  const withInput = builder.build({
    runtimeIdentity: { name: "provider identity" },
    content: "replace identity"
  });

  assert.deepEqual(withInput, baseline);
});
