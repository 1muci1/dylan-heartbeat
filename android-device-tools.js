"use strict";

const ANDROID_DEVICE_TOOLS = Object.freeze([
  Object.freeze({
    name: "android.device.status_get",
    description: "Return Android device availability status through the active command channel.",
    riskLevel: "low",
    inputSchema: Object.freeze({ type: "object", properties: Object.freeze({}), additionalProperties: false })
  })
]);

module.exports = { ANDROID_DEVICE_TOOLS };
