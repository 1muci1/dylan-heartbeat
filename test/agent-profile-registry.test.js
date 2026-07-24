"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  AgentProfileRegistry,
  BUILT_IN_AGENT_PROFILES,
  validateAgentProfile
} = require("../agent-profile-registry");

function customProfile(overrides = {}) {
  return {
    id: "reviewer",
    name: "Reviewer",
    role: "Review Agent",
    description: "Reviews a discussion without changing runtime state.",
    capabilities: ["discussion", "summary"],
    memoryAccess: false,
    ...overrides
  };
}

test("default Registry exposes the chen profile with read-only Memory access capability", () => {
  const profile = new AgentProfileRegistry().get("chen");

  assert.equal(profile.id, "chen");
  assert.equal(profile.name, "沉");
  assert.equal(profile.memoryAccess, true);
  assert.ok(profile.capabilities.includes("memory_context"));
});

test("default Registry exposes an isolated chatgpt profile without Memory access", () => {
  const profile = new AgentProfileRegistry().get("chatgpt");

  assert.equal(profile.id, "chatgpt");
  assert.equal(profile.memoryAccess, false);
  assert.ok(profile.capabilities.includes("independent_context"));
  assert.equal(profile.capabilities.includes("memory_context"), false);
});

test("validate rejects malformed, unknown, unsafe, and reserved-boundary profiles", () => {
  const invalid = [
    null,
    customProfile({ id: "Invalid Agent" }),
    customProfile({ name: "" }),
    customProfile({ role: "" }),
    customProfile({ description: "" }),
    customProfile({ capabilities: [] }),
    customProfile({ capabilities: ["discussion", "discussion"] }),
    customProfile({ capabilities: ["Memory Write"] }),
    customProfile({ memoryAccess: "yes" }),
    customProfile({ prompt: "forbidden" }),
    { ...BUILT_IN_AGENT_PROFILES[0], memoryAccess: false },
    { ...BUILT_IN_AGENT_PROFILES[1], memoryAccess: true }
  ];
  for (const profile of invalid) assert.throws(() => validateAgentProfile(profile));

  const registry = new AgentProfileRegistry({ profiles: [] });
  assert.deepEqual(registry.validate(customProfile()), customProfile());
});

test("Registry rejects duplicate Agent ids", () => {
  const registry = new AgentProfileRegistry({ profiles: [] });
  registry.register(customProfile());

  assert.throws(
    () => registry.register(customProfile({ name: "Another Reviewer" })),
    error => error.code === "AGENT_PROFILE_ALREADY_REGISTERED"
  );
});

test("list, get, validate, and register return isolated copies", () => {
  const registry = new AgentProfileRegistry();
  const listed = registry.list();
  listed[0].name = "changed";
  listed[0].capabilities.push("injected");
  listed.length = 0;
  const fetched = registry.get("chen");
  fetched.description = "changed";

  assert.equal(registry.list().length, 2);
  assert.equal(registry.get("chen").name, "沉");
  assert.equal(registry.get("chen").capabilities.includes("injected"), false);
  assert.notEqual(registry.get("chen").description, "changed");
});

test("Profile Registry has no Memory mutation, Selector, Identity, Chat, network, or database integration", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "agent-profile-registry.js"),
    "utf8"
  );

  assert.doesNotMatch(
    source,
    /StructuredMemoryStore|MemoryWriter|EventStore|Selector|IdentityBoundary|ChatRuntime|fetch\s*\(|database|migration/i
  );
  assert.doesNotMatch(source, /\.(?:create|update|delete|archive)\s*\(/);
});
