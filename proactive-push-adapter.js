"use strict";

class ProactivePushAdapter {
  async send(_delivery) {
    return { success: false, reasonCode: "PUSH_NOT_CONFIGURED" };
  }
}

module.exports = { ProactivePushAdapter };
