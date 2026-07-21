"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { ToolProvider, assertToolProvider } = require("../tool-provider");
const { ToolProviderRegistry } = require("../tool-provider-registry");

class FakeProvider extends ToolProvider {
  constructor(name = "fake_provider") {
    super({ name });
    this.calls = [];
  }

  getMetadata() {
    return { name: this.name, type: "fake", version: "1" };
  }

  listTools() {
    return [this.name === "fake_provider" ? "fake.echo.run" : `${this.name}.echo_run`];
  }

  async execute(toolName, input) {
    this.calls.push({ toolName, input });
    if (!this.listTools().includes(toolName)) throw new Error("FAKE_TOOL_NOT_FOUND");
    return { echoed: input.value };
  }
}

test("fake Provider implements name, metadata, Tool discovery, and execution contract", async () => {
  const provider = new FakeProvider();
  assert.equal(assertToolProvider(provider), provider);
  assert.equal(provider.name, "fake_provider");
  assert.deepEqual(provider.getMetadata(), { name: "fake_provider", type: "fake", version: "1" });
  assert.deepEqual(provider.listTools(), ["fake.echo.run"]);
  assert.deepEqual(await provider.execute("fake.echo.run", { value: "safe" }), { echoed: "safe" });
  assert.deepEqual(provider.calls, [{ toolName: "fake.echo.run", input: { value: "safe" } }]);
});

test("base Provider defines an explicit unimplemented interface", async () => {
  const provider = new ToolProvider({ name: "base_provider" });
  assert.throws(() => provider.getMetadata(), error => error.code === "TOOL_PROVIDER_NOT_IMPLEMENTED");
  assert.throws(() => provider.listTools(), error => error.code === "TOOL_PROVIDER_NOT_IMPLEMENTED");
  await assert.rejects(provider.execute("fake.echo.run", {}), error => error.code === "TOOL_PROVIDER_NOT_IMPLEMENTED");
  assertToolProvider(provider);
});

test("Provider Registry registers, gets, and lists fake Providers without executing them", () => {
  const one = new FakeProvider("fake_one"), two = new FakeProvider("fake_two");
  const registry = new ToolProviderRegistry({ providers: [one] });
  assert.equal(registry.register(two), two);
  assert.equal(registry.get("fake_one"), one);
  assert.equal(registry.get("missing"), null);
  assert.deepEqual(registry.list(), [one, two]);
  assert.equal(one.calls.length, 0); assert.equal(two.calls.length, 0);
});

test("Provider Registry rejects duplicate, malformed, and incomplete Providers", () => {
  const registry = new ToolProviderRegistry();
  registry.register(new FakeProvider());
  assert.throws(() => registry.register(new FakeProvider()), error => error.code === "TOOL_PROVIDER_ALREADY_REGISTERED");
  for (const provider of [
    null,
    {},
    { name: "Bad Name", getMetadata() {}, listTools() {}, execute() {} },
    { name: "missing_execute", getMetadata() {}, listTools() {} },
    { name: "missing_list", getMetadata() {}, execute() {} },
    { name: "missing_metadata", listTools() {}, execute() {} }
  ]) assert.throws(() => assertToolProvider(provider), error => error.code === "TOOL_PROVIDER_INVALID");
  assert.throws(() => registry.get("Bad Name"));
});

test("Registry preserves Provider identity for future controlled dispatch", () => {
  const provider = new FakeProvider();
  const registry = new ToolProviderRegistry();
  registry.register(provider);
  assert.equal(registry.get(provider.name), provider);
  assert.equal(registry.list()[0], provider);
});

test("Provider abstraction has no Event, Memory, State, Gateway, Approval, model, MCP, device, network, or migration dependency", () => {
  const source = ["tool-provider.js", "tool-provider-registry.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /EventStore|memory|StateStore|execution-gateway|approval|model|MCP|mobile|phone|device|fetch\(|https?:|migration/i);
  assert.doesNotMatch(source, /eventStore\.create|memoryStore\.|stateStore\.|\.write\(/i);
  const registrySource = fs.readFileSync(path.join(__dirname, "..", "tool-provider-registry.js"), "utf8");
  assert.doesNotMatch(registrySource, /\.execute\(/);
});
