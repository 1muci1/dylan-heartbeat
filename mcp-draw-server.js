"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");
const { DrawGameService } = require("./draw-game-service");
const { GAME_TOOL_NAMES, GameTools } = require("./game-tools");

const GAME_URL = "/game/#draw";
const gameUrlForRound = roundId =>
  `${GAME_URL}?roundId=${encodeURIComponent(String(roundId || ""))}`;
const artistSchema = z.enum(["chen", "user"]).default("chen");
const guesserSchema = z.enum(["chen", "user"]).default("chen");
const pointSchema = z.tuple([
  z.number().min(0).max(2000),
  z.number().min(0).max(2000)
]);
const strokeSchema = z.strictObject({
  tool: z.literal("polyline"),
  points: z.array(pointSchema).min(2).max(5000),
  color: z.string().max(16).optional(),
  width: z.number().min(1).max(40).optional()
});

function toolPayload(payload, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload
  };
}

function safeMcpFailure(result) {
  const code = typeof result?.error?.code === "string" ? result.error.code : "GAME_TOOL_FAILED";
  const message = typeof result?.error?.message === "string"
    ? result.error.message
    : "游戏工具暂时不可用";
  return toolPayload({ ok: false, error: { code, message } }, true);
}

function callGameTool(gameTools, name, input) {
  if (!GAME_TOOL_NAMES.includes(name)) {
    return safeMcpFailure({
      error: { code: "GAME_TOOL_NOT_ALLOWED", message: "游戏工具不在白名单中" }
    });
  }
  const result = gameTools.execute(name, input);
  if (!result?.ok) return safeMcpFailure(result);

  if (name === "draw_start") {
    return toolPayload({
      ok: true,
      roundId: result.roundId,
      message: result.message,
      gameUrl: gameUrlForRound(result.roundId)
    });
  }
  if (name === "draw_status") {
    return toolPayload({
      ok: true,
      roundId: input.roundId,
      canvas: result.canvas,
      artist: result.artist,
      created_at: result.created_at,
      drawing_svg: result.drawing_svg,
      ascii_grid: result.ascii_grid,
      ascii_grid_note: result.ascii_grid_note
    });
  }
  return toolPayload({
    ok: true,
    guessed: result.result === "猜对了",
    message: result.result
  });
}

function registerDrawMcpTools(server, gameTools) {
  const startAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  };
  const statusAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };

  server.registerTool("draw_start", {
    title: "沉开始画画",
    description: "让沉创建一局你画我猜，返回公开回合标识和游戏页链接。",
    inputSchema: {
      answer: z.string().trim().min(1).max(40),
      artist: artistSchema,
      strokes: z.array(strokeSchema).max(500).optional(),
      drawing_svg: z.string().max(200000).optional(),
      aliases: z.array(z.string().trim().min(1).max(40)).max(12).optional()
    },
    annotations: startAnnotations
  }, async input => callGameTool(gameTools, "draw_start", input));

  server.registerTool("draw_status", {
    title: "沉查看画作",
    description: "读取当前回合的公开画作结构，不返回答案、别名或私密信息。",
    inputSchema: {
      roundId: z.string().trim().min(1).max(120)
    },
    annotations: statusAnnotations
  }, async input => callGameTool(gameTools, "draw_status", input));

  server.registerTool("draw_guess", {
    title: "沉提交猜测",
    description: "提交一次你画我猜的猜测；猜错时不会返回真实答案。",
    inputSchema: {
      roundId: z.string().trim().min(1).max(120),
      guess: z.string().trim().min(1).max(120),
      guesser: guesserSchema
    },
    annotations: startAnnotations
  }, async input => callGameTool(gameTools, "draw_guess", {
    roundId: input.roundId,
    content: input.guess,
    guesser: input.guesser
  }));
}

function createDrawMcpRuntime(options = {}) {
  const service = options.service || new DrawGameService();
  const gameTools = options.gameTools || new GameTools({ service });
  const server = options.server || new McpServer({
    name: "dylan-heartbeat-draw-game",
    version: "0.1.0"
  });
  const transport = options.transport || new StdioServerTransport();
  const signalSource = options.signalSource || process;
  let started = false;
  let closed = false;

  registerDrawMcpTools(server, gameTools);

  const close = async () => {
    if (closed) return;
    closed = true;
    signalSource.removeListener?.("SIGINT", handleSignal);
    signalSource.removeListener?.("SIGTERM", handleSignal);
    await server.close();
  };
  const handleSignal = () => {
    close().catch(() => {
      process.stderr.write("Draw MCP 关闭失败 [DRAW_MCP_CLOSE_FAILED]\n");
      process.exitCode = 1;
    });
  };
  const start = async () => {
    if (started) return;
    started = true;
    signalSource.once?.("SIGINT", handleSignal);
    signalSource.once?.("SIGTERM", handleSignal);
    try {
      await server.connect(transport);
    } catch (error) {
      signalSource.removeListener?.("SIGINT", handleSignal);
      signalSource.removeListener?.("SIGTERM", handleSignal);
      started = false;
      throw error;
    }
  };

  return { close, gameTools, server, start, transport };
}

async function main() {
  const runtime = createDrawMcpRuntime();
  await runtime.start();
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("Draw MCP 启动失败 [DRAW_MCP_START_FAILED]\n");
    process.exitCode = 1;
  });
}

module.exports = {
  GAME_URL,
  callGameTool,
  createDrawMcpRuntime,
  gameUrlForRound,
  main,
  registerDrawMcpTools
};
