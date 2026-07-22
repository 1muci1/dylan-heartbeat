"use strict";

const PERMISSION_LEVELS = Object.freeze(["automatic", "user_confirm", "blocked"]);
const EXECUTION_TYPES = Object.freeze(["local", "device_bridge", "vps_relay"]);
const TOOL_DEFINITION_FIELDS = Object.freeze([
  "name", "description", "inputSchema", "permissionLevel", "executionType"
]);

const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "proactive_explanation_get",
    description: "Return a structured read-only explanation for one proactive delivery.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        deliveryId: Object.freeze({ type: "string", minLength: 1, maxLength: 200 })
      }),
      required: Object.freeze(["deliveryId"]),
      additionalProperties: false
    }),
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
