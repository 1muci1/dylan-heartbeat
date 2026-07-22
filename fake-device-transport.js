"use strict";

const { DeviceBridgeProtocol, DeviceProtocolError, validateRequest } = require("./device-bridge-protocol");

class FakeDeviceTransport {
  constructor({ status = {}, draftId = "fake-transport-draft-1", failActions = [] } = {}) {
    this.protocol = new DeviceBridgeProtocol();
    this.status = Object.freeze({
      batteryLevelBucket: status.batteryLevelBucket ?? "medium",
      online: status.online ?? true,
      appForeground: status.appForeground ?? false
    });
    this.draftId = draftId;
    this.failActions = new Set(failActions);
    this.requests = [];
  }

  async send(request) {
    const safeRequest = validateRequest(request);
    const validStatus = safeRequest.action === "device.status_get" && !Object.keys(safeRequest.payload).length;
    const validDraft = safeRequest.action === "reminder.draft_create" &&
      Object.keys(safeRequest.payload).length === 2 && typeof safeRequest.payload.title === "string" &&
      safeRequest.payload.title.trim() === safeRequest.payload.title && safeRequest.payload.title.length >= 1 &&
      safeRequest.payload.title.length <= 120 && typeof safeRequest.payload.time === "string" &&
      safeRequest.payload.time.endsWith("Z") && !Number.isNaN(Date.parse(safeRequest.payload.time));
    if (!validStatus && !validDraft) throw new DeviceProtocolError("Device request 无效");
    this.requests.push(structuredClone(safeRequest));
    try {
      if (this.failActions.has(safeRequest.action)) throw new Error("isolated fake failure");
      const result = safeRequest.action === "device.status_get"
        ? { ...this.status }
        : { draftId: this.draftId, status: "created" };
      return this.protocol.validateResponse({
        requestId: safeRequest.requestId, success: true, result, errorCode: null
      }, { requestId: safeRequest.requestId });
    } catch (error) {
      if (error instanceof DeviceProtocolError) throw error;
      return this.protocol.validateResponse({
        requestId: safeRequest.requestId,
        success: false,
        result: null,
        errorCode: "DEVICE_OPERATION_FAILED"
      }, { requestId: safeRequest.requestId });
    }
  }
}

module.exports = { FakeDeviceTransport };
