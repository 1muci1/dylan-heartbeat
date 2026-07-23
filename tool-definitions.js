"use strict";

const {
  PROACTIVE_EXPLANATION_INPUT_SCHEMA,
  PROACTIVE_EXPLANATION_TOOL_NAME
} = require("./proactive-explanation-contract");

const PERMISSION_LEVELS = Object.freeze(["automatic", "user_confirm", "blocked"]);
const EXECUTION_TYPES = Object.freeze(["local", "device_bridge", "vps_relay"]);
const TOOL_DEFINITION_FIELDS = Object.freeze([
  "name", "description", "inputSchema", "permissionLevel", "executionType"
]);

const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: PROACTIVE_EXPLANATION_TOOL_NAME,
    description: "Return a structured read-only explanation for one proactive delivery.",
    inputSchema: PROACTIVE_EXPLANATION_INPUT_SCHEMA,
    permissionLevel: "automatic",
    executionType: "local"
  })
]);

module.exports = {
  EXECUTION_TYPES,
  PERMISSION_LEVELS,
  TOOL_DEFINITIONS,
  TOOL_DEFINITION_FIELDS
};
