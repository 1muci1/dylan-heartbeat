"use strict";

const ANDROID_DEVICE_TOOLS = Object.freeze([
  Object.freeze({
    name: "android.device.status_get",
    description: "Return Android device availability status through the active command channel.",
    riskLevel: "low",
    inputSchema: Object.freeze({ type: "object", properties: Object.freeze({}), additionalProperties: false })
  }),
  Object.freeze({
    name: "android.reminder.draft_create",
    description: "Create a reminder draft in the paired Android Companion for user review.",
    riskLevel: "medium",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        title: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
        time: Object.freeze({ type: "string", minLength: 1, maxLength: 40 })
      }),
      required: Object.freeze(["title", "time"]),
      additionalProperties: false
    })
  })
]);

module.exports = { ANDROID_DEVICE_TOOLS };
