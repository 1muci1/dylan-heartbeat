"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const Fastify = require("fastify");
const { createMemoryStore, registerMemoryAdmin } = require("../memory-admin");

const tempDirs = [];

async function fixture(initial = [{ content: "existing", time: "2026-07-14" }]) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-"));
  tempDirs.push(dir);
  const memoryFile = path.join(dir, "memory.json");
  const backupDir = path.join(dir, "backups");
  await fs.promises.writeFile(memoryFile, JSON.stringify({ memories: initial }, null, 2));
  const app = Fastify({ logger: false });
  registerMemoryAdmin(app, { memoryFile, backupDir, apiKey: "test-token" });
  await app.ready();
  return { app, dir, memoryFile, backupDir };
}

function auth() {
  return { authorization: "Bearer test-token" };
}

async function readLegacyProductionMemories(memoryFile) {
  const document = JSON.parse(await fs.promises.readFile(memoryFile, "utf8"));
  return document.memories;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.promises.rm(dir, { recursive: true, force: true })));
});

test("merge accepts common containers/body keys, trims blanks, and deduplicates", async t => {
  const { app, memoryFile } = await fixture();
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/admin/memory/import",
    headers: auth(),
    payload: {
      mode: "merge",
      data: { items: [{ text: " new memory " }, { summary: "existing" }, { title: "  " }, null] }
    }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    importedCount: 1,
    totalCount: 2,
    skippedCount: 3,
    backupFile: response.json().backupFile
  });
  assert.match(response.json().backupFile, /^memory-.*\.json$/);
  const saved = JSON.parse(await fs.promises.readFile(memoryFile, "utf8"));
  assert.deepEqual(saved.memories.map(item => item.content), ["existing", "new memory"]);
});

test("replace accepts an array and creates a backup of the previous data", async t => {
  const { app, backupDir } = await fixture();
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/admin/memory/import",
    headers: auth(),
    payload: { mode: "replace", data: ["first", { content: "second" }, "first"] }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().importedCount, 2);
  assert.equal(response.json().skippedCount, 1);
  const backup = JSON.parse(await fs.promises.readFile(path.join(backupDir, response.json().backupFile), "utf8"));
  assert.equal(backup.memories[0].content, "existing");
});

test("rejects invalid JSON, empty data, excessive strings, and excessive body size", async t => {
  const { app } = await fixture();
  t.after(() => app.close());
  const invalidJson = await app.inject({
    method: "POST",
    url: "/admin/memory/import",
    headers: { ...auth(), "content-type": "application/json" },
    payload: "{broken"
  });
  assert.equal(invalidJson.statusCode, 400);

  const empty = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "merge", data: [] }
  });
  assert.equal(empty.statusCode, 400);

  const long = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "merge", data: ["x".repeat(20001)] }
  });
  assert.equal(long.statusCode, 400);

  const huge = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "merge", data: ["x".repeat(2 * 1024 * 1024)] }
  });
  assert.equal(huge.statusCode, 413);
});

test("all memory endpoints reject missing and incorrect Bearer tokens", async t => {
  const { app } = await fixture();
  t.after(() => app.close());
  for (const authorization of [undefined, "Bearer wrong-token"]) {
    const headers = authorization ? { authorization } : {};
    const response = await app.inject({ method: "GET", url: "/admin/memory/export", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["www-authenticate"], "Bearer");
  }
});

test("export has the public schema and backup listing excludes invalid filenames", async t => {
  const { app, backupDir } = await fixture();
  t.after(() => app.close());
  const imported = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "merge", data: ["new"] }
  });
  await fs.promises.writeFile(path.join(backupDir, "untrusted.json"), "{}");

  const exported = await app.inject({ method: "GET", url: "/admin/memory/export", headers: auth() });
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.json().schemaVersion, 1);
  assert.equal(exported.json().count, 2);
  assert.ok(Date.parse(exported.json().exportedAt));
  assert.equal(JSON.stringify(exported.json()).includes("TARGET_API_KEY"), false);

  const listed = await app.inject({ method: "GET", url: "/admin/memory/backups", headers: auth() });
  assert.deepEqual(listed.json().backups.map(item => item.id), [imported.json().backupFile]);
});

test("an existing empty memory file can receive its first import", async t => {
  const { app } = await fixture([]);
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "merge", data: { memories: [{ content: "first" }] } }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().totalCount, 1);
});

test("merge and replace preserve the production memory.json shape for legacy readers", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-production-shape-"));
  tempDirs.push(dir);
  const memoryFile = path.join(dir, "memory.json");
  const backupDir = path.join(dir, "backups");
  await fs.promises.copyFile(path.join(__dirname, "..", "memory.json"), memoryFile);
  const productionDocument = JSON.parse(await fs.promises.readFile(memoryFile, "utf8"));
  assert.equal(Array.isArray(productionDocument), false);
  assert.ok(Array.isArray(productionDocument.memories));

  const app = Fastify({ logger: false });
  registerMemoryAdmin(app, { memoryFile, backupDir, apiKey: "test-token" });
  await app.ready();
  t.after(() => app.close());

  const merged = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "merge", data: [{ text: "compatibility merge" }] }
  });
  assert.equal(merged.statusCode, 200);
  const afterMerge = await readLegacyProductionMemories(memoryFile);
  assert.ok(Array.isArray(afterMerge));
  assert.equal(afterMerge.at(-1).content, "compatibility merge");

  const replaced = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "replace", data: [{ summary: "compatibility replace" }] }
  });
  assert.equal(replaced.statusCode, 200);
  const afterReplace = await readLegacyProductionMemories(memoryFile);
  assert.deepEqual(afterReplace.map(item => item.content), ["compatibility replace"]);
});

test("an original top-level array remains a top-level array", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-array-shape-"));
  tempDirs.push(dir);
  const memoryFile = path.join(dir, "memory.json");
  await fs.promises.writeFile(memoryFile, JSON.stringify([{ content: "array item" }]));
  const app = Fastify({ logger: false });
  registerMemoryAdmin(app, { memoryFile, backupDir: path.join(dir, "backups"), apiKey: "test-token" });
  await app.ready();
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "merge", data: ["another"] }
  });
  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(await fs.promises.readFile(memoryFile, "utf8"))));
});

test("restore validates ids, backs up current data, and atomically restores", async t => {
  const { app } = await fixture([{ content: "original" }]);
  t.after(() => app.close());
  const replaced = await app.inject({
    method: "POST", url: "/admin/memory/import", headers: auth(),
    payload: { mode: "replace", data: ["replacement"] }
  });
  const traversal = await app.inject({
    method: "POST", url: "/admin/memory/backups/..%2Fmemory.json/restore", headers: auth()
  });
  assert.ok([400, 404].includes(traversal.statusCode));

  const restored = await app.inject({
    method: "POST",
    url: `/admin/memory/backups/${replaced.json().backupFile}/restore`,
    headers: auth()
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().totalCount, 1);
  assert.notEqual(restored.json().backupFile, replaced.json().backupFile);
  const exported = await app.inject({ method: "GET", url: "/admin/memory/export", headers: auth() });
  assert.equal(exported.json().items[0].content, "original");
});

test("a failed atomic rename preserves the original memory file", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-rollback-"));
  tempDirs.push(dir);
  const memoryFile = path.join(dir, "memory.json");
  await fs.promises.writeFile(memoryFile, JSON.stringify({ memories: [{ content: "safe" }] }, null, 2));
  const fileOps = Object.create(fs.promises);
  fileOps.rename = async () => { throw new Error("simulated rename failure"); };
  const store = createMemoryStore({ memoryFile, backupDir: path.join(dir, "backups"), fileOps });
  await assert.rejects(store.importItems("replace", ["unsafe"]), /simulated rename failure/);
  const unchanged = JSON.parse(await fs.promises.readFile(memoryFile, "utf8"));
  assert.equal(unchanged.memories[0].content, "safe");
  const leftovers = (await fs.promises.readdir(dir)).filter(name => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});
