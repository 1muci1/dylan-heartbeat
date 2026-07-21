"use strict";

const { DevicePairingError } = require("./device-pairing-service");

class DevicePairingRouteError extends Error {
  constructor(message, statusCode = 400, code = "DEVICE_PAIRING_INVALID") {
    super(message);
    this.name = "DevicePairingRouteError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function exactBody(body, fields) {
  return body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).length === fields.length && fields.every(field => Object.hasOwn(body, field));
}

function routeError(error) {
  if (error instanceof DevicePairingRouteError) return error;
  const statusByCode = {
    DEVICE_PAIRING_TOKEN_INVALID: 401,
    DEVICE_NOT_FOUND: 404,
    DEVICE_PAIRING_TOKEN_USED: 409,
    DEVICE_REVOKED: 403
  };
  if (error instanceof DevicePairingError && statusByCode[error.code]) {
    return new DevicePairingRouteError(error.message, statusByCode[error.code], error.code);
  }
  if (error instanceof DevicePairingError) return new DevicePairingRouteError(error.message, 400, error.code);
  return new DevicePairingRouteError("Device pairing 服务暂时不可用", 500, "DEVICE_PAIRING_FAILED");
}

function registerDevicePairingRoutes(app, { pairingService } = {}) {
  if (!pairingService || typeof pairingService.createPairingRequest !== "function" ||
      typeof pairingService.confirmPairing !== "function") throw new TypeError("pairingService 必填");

  function fail(req, reply, original) {
    const error = routeError(original);
    if (error.statusCode >= 500) req.log.error({ errorName: original?.name, errorCode: original?.code }, "device pairing failed");
    return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
  }

  app.post("/api/v1/devices/pairing", async (req, reply) => {
    try {
      if (!exactBody(req.body, ["deviceName", "platform"])) throw new DevicePairingRouteError("Body 只允许 deviceName 和 platform");
      const created = pairingService.createPairingRequest(req.body);
      return reply.code(201).send({
        pairingId: created.device.deviceId,
        pairingToken: created.pairingToken,
        status: "pending"
      });
    } catch (error) { return fail(req, reply, error); }
  });

  app.post("/api/v1/devices/pairing/:pairingId/confirm", async (req, reply) => {
    try {
      if (!exactBody(req.body, ["pairingToken"])) throw new DevicePairingRouteError("Body 只允许 pairingToken");
      const paired = pairingService.confirmPairing({
        deviceId: req.params.pairingId,
        pairingToken: req.body.pairingToken
      });
      return { deviceId: paired.deviceId, status: "paired" };
    } catch (error) { return fail(req, reply, error); }
  });
}

module.exports = { DevicePairingRouteError, registerDevicePairingRoutes, routeError };
