"use strict";

const { ToolRegistry } = require("./tool-registry");
const { validateToolInput } = require("./tool-execution-gateway");

const GAME_TOOL_NAMES = Object.freeze(["draw_start", "draw_status", "draw_guess"]);
const base = (name, description, properties, required = []) => Object.freeze({
  name,
  description,
  inputSchema: Object.freeze({
    type: "object",
    properties: Object.freeze(properties),
    required: Object.freeze(required),
    additionalProperties: false
  }),
  permissionLevel: "automatic",
  executionType: "local"
});
const pointSchema = Object.freeze({
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: Object.freeze({ type: "number", minimum: 0, maximum: 2000 })
});
const strokeSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    tool: Object.freeze({ type: "string", enum: ["polyline"] }),
    points: Object.freeze({ type: "array", minItems: 2, maxItems: 5000, items: pointSchema }),
    color: Object.freeze({ type: "string", maxLength: 16 }),
    width: Object.freeze({ type: "number", minimum: 1, maximum: 40 })
  }),
  required: Object.freeze(["tool", "points"]),
  additionalProperties: false
});
const GAME_TOOL_DEFINITIONS = Object.freeze([
  base("draw_start", "让沉开始一局你画我猜；复用现有画作回合服务。", {
    artist: Object.freeze({ type: "string", enum: ["chen", "user"] }),
    answer: Object.freeze({ type: "string", minLength: 1, maxLength: 40 }),
    aliases: Object.freeze({ type: "array", maxItems: 12, items: Object.freeze({ type: "string", minLength: 1, maxLength: 40 }) }),
    content: Object.freeze({ type: "array", maxItems: 500, items: strokeSchema }),
    strokes: Object.freeze({ type: "array", maxItems: 500, items: strokeSchema }),
    drawing_svg: Object.freeze({ type: "string", maxLength: 200000 })
  }, ["artist"]),
  base("draw_status", "让沉查看当前公开画作结构；永不返回答案或别名。", {
    roundId: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
    target: Object.freeze({ type: "string", minLength: 1, maxLength: 120 })
  }),
  base("draw_guess", "让沉提交一次猜测；猜错时不泄露真实答案。", {
    roundId: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
    target: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
    content: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
    guesser: Object.freeze({ type: "string", enum: ["chen", "user"] })
  }, ["content"])
]);

class GameToolError extends Error {
  constructor(message, code = "GAME_TOOL_FAILED") {
    super(message);
    this.name = "GameToolError";
    this.code = code;
  }
}

function safeFailure(error) {
  const exposedCodes = new Set([
    "DRAW_ANSWER_INVALID",
    "DRAWING_EMPTY",
    "DRAW_GUESS_EMPTY",
    "DRAW_ROUND_NOT_FOUND",
    "GAME_TOOL_INPUT_INVALID",
    "GAME_TOOL_NOT_ALLOWED"
  ]);
  const code = exposedCodes.has(error?.code) ? error.code : "GAME_TOOL_FAILED";
  const messages = {
    DRAW_ANSWER_INVALID: "画作答案无效",
    DRAWING_EMPTY: "画作内容为空",
    DRAW_GUESS_EMPTY: "猜测内容为空",
    DRAW_ROUND_NOT_FOUND: "画作回合不存在或已过期",
    GAME_TOOL_INPUT_INVALID: "游戏工具参数无效",
    GAME_TOOL_NOT_ALLOWED: "游戏工具不在白名单中",
    GAME_TOOL_FAILED: "游戏工具暂时不可用"
  };
  return { ok: false, error: { code, message: messages[code] } };
}

class GameTools {
  constructor({ service } = {}) {
    if (!service || !["drawStart", "drawStatus", "drawGuess"].every(method => typeof service[method] === "function")) {
      throw new TypeError("DrawGameService 必填");
    }
    this.service = service;
    this.registry = new ToolRegistry({ definitions: GAME_TOOL_DEFINITIONS });
    this.handlers = Object.freeze({
      draw_start: input => {
        if (input.drawing_svg && !(input.strokes || input.content)) {
          throw new GameToolError("drawing_svg 需要配套结构化线条", "GAME_TOOL_INPUT_INVALID");
        }
        const started = this.service.drawStart({
          artist: input.artist,
          answer: input.answer,
          aliases: input.aliases,
          strokes: input.strokes || input.content
        });
        return { ok: true, roundId: started.round_id, message: "沉画好了，可以开始猜了。" };
      },
      draw_status: input => {
        const roundId = input.roundId || input.target;
        if (!roundId) throw new GameToolError("roundId 必填", "GAME_TOOL_INPUT_INVALID");
        return { ok: true, ...this.service.drawStatus(roundId) };
      },
      draw_guess: input => {
        const roundId = input.roundId || input.target;
        if (!roundId) throw new GameToolError("roundId 必填", "GAME_TOOL_INPUT_INVALID");
        return { ok: true, ...this.service.drawGuess(roundId, { content: input.content, guesser: input.guesser || "chen" }) };
      }
    });
  }

  list() {
    return this.registry.list();
  }

  execute(name, input = {}) {
    try {
      if (!GAME_TOOL_NAMES.includes(name)) throw new GameToolError("工具不在白名单", "GAME_TOOL_NOT_ALLOWED");
      const definition = this.registry.get(name);
      if (!definition || !this.handlers[name]) throw new GameToolError("工具不在白名单", "GAME_TOOL_NOT_ALLOWED");
      try {
        validateToolInput(input, definition.inputSchema);
      } catch {
        throw new GameToolError("参数无效", "GAME_TOOL_INPUT_INVALID");
      }
      return this.handlers[name](input);
    } catch (error) {
      return safeFailure(error);
    }
  }
}

function detectDrawGameIntent(content) {
  const text = String(content || "").trim().replace(/\s+/g, "");
  if (!text || !/(你画我猜|画你猜|猜我画)/u.test(text)) return null;
  if (/(我画你猜|你来猜我画的|我画.*沉猜|我来画)/u.test(text)) {
    return Object.freeze({ type: "user_draw", toolName: null });
  }
  if (/(沉.*你画我猜|你画我猜|你来画|沉画)/u.test(text)) {
    return Object.freeze({ type: "chen_draw", toolName: "draw_start" });
  }
  return Object.freeze({ type: "lobby", toolName: null });
}

function buildDrawGameChatContext(intent, toolResult = null) {
  if (!intent) return null;
  if (intent.type === "user_draw") {
    return {
      role: "system",
      content: "用户明确想玩“我画，沉猜”。请以沉的口吻简短邀请用户前往 /game/#draw 画画，不要调用其他工具。"
    };
  }
  if (intent.type === "chen_draw" && toolResult?.ok) {
    return {
      role: "system",
      content: `沉已通过 draw_start 画好一局（roundId: ${toolResult.roundId}）。请直接说“我画好啦，去游戏页猜猜看。”并提供 /game/#draw 链接，不要解释工具实现。`
    };
  }
  return {
    role: "system",
    content: "用户明确想玩你画我猜。请以沉的口吻邀请用户打开 /game/#draw，不要解释工具实现。"
  };
}

async function resolveDrawGameIntentTool({
  intent,
  callMcpTool,
  internalTools,
  logger
} = {}) {
  if (intent?.toolName !== "draw_start") return null;
  let result = null;
  try {
    result = await callMcpTool("draw_start", {
      answer: "沉的随机题目",
      artist: "chen"
    });
  } catch {
    result = null;
  }
  if (result?.ok) return result;
  logger?.warn?.({
    code: "DRAW_MCP_FALLBACK_INTERNAL",
    tool: "draw_start"
  }, "draw MCP fallback");
  return internalTools.execute("draw_start", { artist: "chen" });
}

module.exports = {
  GAME_TOOL_DEFINITIONS,
  GAME_TOOL_NAMES,
  GameToolError,
  GameTools,
  buildDrawGameChatContext,
  detectDrawGameIntent,
  resolveDrawGameIntentTool
};
