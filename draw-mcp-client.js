"use strict";

const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const DRAW_MCP_TOOL_NAMES = Object.freeze(["draw_start", "draw_status", "draw_guess"]);
const DEFAULT_TIMEOUT_MS = 12000;
const SAFE_MESSAGE = "沉的画画工具暂时没有连上。";

class DrawMcpClientError extends Error {
  constructor(code) {
    super(SAFE_MESSAGE);
    this.name = "DrawMcpClientError";
    this.code = code;
  }
}

function safeFailure(code) {
  return {
    ok: false,
    error: {
      code,
      message: SAFE_MESSAGE
    }
  };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new DrawMcpClientError("DRAW_MCP_TIMEOUT")),
        timeoutMs
      );
    })
  ]).finally(() => clearTimeout(timer));
}

function publicToolResult(name, payload) {
  if (name === "draw_start") {
    return {
      ok: true,
      roundId: payload.roundId,
      message: payload.message,
      gameUrl: payload.gameUrl
    };
  }
  if (name === "draw_status") {
    return {
      ok: true,
      roundId: payload.roundId,
      canvas: payload.canvas,
      artist: payload.artist,
      created_at: payload.created_at,
      drawing_svg: payload.drawing_svg,
      ascii_grid: payload.ascii_grid,
      ascii_grid_note: payload.ascii_grid_note
    };
  }
  return {
    ok: true,
    guessed: payload.guessed === true,
    message: payload.message
  };
}

class DrawMcpClient {
  constructor(options = {}) {
    this.timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;
    this.clientFactory = options.clientFactory || (() => new Client({
      name: "dylan-heartbeat-gateway",
      version: "1.0.0"
    }));
    this.transportFactory = options.transportFactory || (() => new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, "mcp-draw-server.js")],
      cwd: __dirname,
      stderr: "pipe"
    }));
    this.client = null;
    this.transport = null;
    this.connecting = null;
  }

  async connect() {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = this.clientFactory();
      const transport = this.transportFactory();
      try {
        await withTimeout(client.connect(transport), this.timeoutMs);
      } catch (error) {
        await client.close?.().catch?.(() => {});
        if (error?.code === "DRAW_MCP_TIMEOUT") throw error;
        throw new DrawMcpClientError("DRAW_MCP_UNAVAILABLE");
      }
      this.client = client;
      this.transport = transport;
      return client;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async listTools() {
    try {
      const client = await this.connect();
      const result = await withTimeout(client.listTools(), this.timeoutMs);
      const names = Array.isArray(result?.tools)
        ? result.tools.map(tool => tool?.name).filter(name => DRAW_MCP_TOOL_NAMES.includes(name))
        : [];
      return { ok: true, tools: names };
    } catch (error) {
      const code = error?.code === "DRAW_MCP_TIMEOUT" ? error.code : "DRAW_MCP_UNAVAILABLE";
      await this.close();
      return safeFailure(code);
    }
  }

  async callTool(name, args = {}) {
    if (!DRAW_MCP_TOOL_NAMES.includes(name)) {
      return safeFailure("DRAW_MCP_TOOL_INVALID");
    }
    try {
      const client = await this.connect();
      const result = await withTimeout(client.callTool({
        name,
        arguments: args
      }), this.timeoutMs);
      const payload = result?.structuredContent;
      if (result?.isError === true || !payload || payload.ok !== true) {
        return safeFailure(
          payload?.error?.code === "DRAW_ROUND_NOT_FOUND"
            ? "DRAW_ROUND_NOT_FOUND"
            : "DRAW_MCP_CALL_FAILED"
        );
      }
      return publicToolResult(name, payload);
    } catch (error) {
      const code = error?.code === "DRAW_MCP_TIMEOUT"
        ? "DRAW_MCP_TIMEOUT"
        : (this.client ? "DRAW_MCP_CALL_FAILED" : "DRAW_MCP_UNAVAILABLE");
      await this.close();
      return safeFailure(code);
    }
  }

  async close() {
    if (this.connecting) await this.connecting.catch(() => {});
    const client = this.client;
    this.client = null;
    this.transport = null;
    if (client) await client.close().catch(() => {});
  }
}

const defaultClient = new DrawMcpClient();

function listDrawMcpTools() {
  return defaultClient.listTools();
}

function callDrawMcpTool(name, args) {
  return defaultClient.callTool(name, args);
}

function closeDrawMcpClient() {
  return defaultClient.close();
}

module.exports = {
  DRAW_MCP_TOOL_NAMES,
  DrawMcpClient,
  DrawMcpClientError,
  callDrawMcpTool,
  closeDrawMcpClient,
  listDrawMcpTools
};
