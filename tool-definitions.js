"use strict";

const PERMISSION_LEVELS = Object.freeze(["automatic", "user_confirm", "blocked"]);
const EXECUTION_TYPES = Object.freeze(["local", "device_bridge", "vps_relay"]);
const TOOL_DEFINITION_FIELDS = Object.freeze([
  "name", "description", "inputSchema", "permissionLevel", "executionType"
]);

const TOOL_DEFINITIONS = Object.freeze([]);

module.exports = {
  EXECUTION_TYPES,
  PERMISSION_LEVELS,
  TOOL_DEFINITIONS,
  TOOL_DEFINITION_FIELDS
};
