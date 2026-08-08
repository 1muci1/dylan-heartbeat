"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { resolveGatewayUrl } = require("../frontend-p4b/assets/js/theme-gateway.js");

test("theme Gateway paths resolve against configured API origin without trailing v1", () => {
  assert.equal(resolveGatewayUrl("/api/theme/assets/localize", { baseUrl:"https://api.xiaowo.homes/v1" }), "https://api.xiaowo.homes/api/theme/assets/localize");
  assert.equal(resolveGatewayUrl("/api/theme/import/extract", { baseUrl:"https://api.xiaowo.homes" }), "https://api.xiaowo.homes/api/theme/import/extract");
  assert.equal(resolveGatewayUrl("/api/theme/assets/localize", { baseUrl:"http://localhost:3000/v1" }), "http://localhost:3000/api/theme/assets/localize");
});

test("theme Gateway fallback uses API in production and current origin locally", () => {
  assert.equal(resolveGatewayUrl("/api/theme/assets/localize", { locationRef:{hostname:"chat.xiaowo.homes",origin:"https://chat.xiaowo.homes"} }), "https://api.xiaowo.homes/api/theme/assets/localize");
  assert.equal(resolveGatewayUrl("/api/theme/import/extract", { locationRef:{hostname:"localhost",origin:"http://localhost:8080"} }), "http://localhost:8080/api/theme/import/extract");
});

test("workshop resolves both theme routes before fetch", () => {
  const source=fs.readFileSync(path.join(__dirname,"..","frontend-p4b/assets/js/theme-workshop.js"),"utf8");
  assert.match(source,/gateway\.resolveGatewayUrl\(path/u); assert.doesNotMatch(source,/fetch\(\s*path/u);
  assert.match(source,/gatewayRequest\("\/api\/theme\/import\/extract"/u); assert.match(source,/gatewayRequest\("\/api\/theme\/assets\/localize"/u);
});
