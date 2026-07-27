"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { relationshipDays, RELATIONSHIP_START_DATE } = require("../ai-companion-frontend/home/home");

test("relationship days uses the shared start date inclusively", () => {
  assert.equal(RELATIONSHIP_START_DATE, "2026-07-01");
  assert.equal(relationshipDays(new Date("2026-07-24T12:00:00")), 24);
});

test("relationship days follows the calendar date", () => {
  assert.equal(relationshipDays(new Date("2026-07-25T00:01:00")), 25);
  assert.equal(relationshipDays(new Date("2026-08-01T00:01:00")), 32);
});

test("relationship calculation does not mutate a Space Profile", () => {
  const profile = { id: "default-space", name: "紫月小屋", theme: { mode: "night" } };
  const before = structuredClone(profile);
  relationshipDays(new Date("2026-07-24T12:00:00"));
  assert.deepEqual(profile, before);
});
