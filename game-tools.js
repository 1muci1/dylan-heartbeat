"use strict";

const { ToolRegistry } = require("./tool-registry");
const { validateToolInput } = require("./tool-execution-gateway");

const GAME_TOOL_NAMES = Object.freeze(["draw_start", "draw_status", "draw_guess"]);
const ACTIVE_DRAW_MODE = "chen_draw_user_guess";
const GLOBAL_DRAW_SCOPE = "global";
const RECENT_DRAW_RESTART_MS = 15 * 60 * 1000;
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
  if (/(这个算法怎么实现|五子棋.*(?:算法|代码).*(?:怎么|如何)|(?:算法|代码).*(?:五子棋|下棋).*(?:怎么|如何))/u.test(text)) {
    return Object.freeze({ type: "gomoku_algorithm", toolName: null });
  }
  if (/(这是不是你和我下|是你在和我玩吗|刚才是不是你下的|为什么你刚才(?:说不是你|那么说))/u.test(text)) {
    return Object.freeze({ type: "gomoku_truth", toolName: null });
  }
  if (!text || /(记得|记忆|回忆|之前|刚才).*?(游戏|五子棋|下棋|画)/u.test(text)) return null;
  if (/(我画你猜|你来猜我画的|我画.*沉猜|我来画)/u.test(text)) {
    return Object.freeze({ type: "user_draw", toolName: null });
  }
  if (/(沉.*你画我猜|你画我猜|你来画|沉画)/u.test(text)) {
    return Object.freeze({ type: "chen_draw", toolName: "draw_start" });
  }
  if (/(五子棋|陪我下棋|和我下棋|我们下棋)/u.test(text)) {
    return Object.freeze({ type: "gomoku", toolName: null });
  }
  if (/(沉沉?和我玩游戏|陪我玩游戏|我想和你玩|我们玩游戏|玩个游戏)/u.test(text)) {
    return Object.freeze({ type: "lobby", toolName: null });
  }
  return null;
}

function activeDrawScopeId(sessionId) {
  const normalized = String(sessionId || "").trim();
  // This is a private single-user runtime. Requests without a stable Session ID
  // share one fallback pointer; it can later be upgraded to a per-client scope.
  return normalized ? `session:${normalized}` : GLOBAL_DRAW_SCOPE;
}

function isDrawHintIntent(content) {
  const text = String(content || "").trim().replace(/\s+/g, "");
  return /^(?:给我)?(?:再)?(?:给点|来点)?提示(?:一下)?[吧呀啊。！!？?]*$/u.test(text) ||
    /^太难了[吧呀啊。！!？?]*$/u.test(text);
}

function isDrawRestartIntent(content) {
  const text = String(content || "").trim().replace(/\s+/g, "");
  return /^(?:再来一局|重新画一个|换一个)[吧呀啊。！!？?]*$/u.test(text);
}

function extractActiveDrawGuess(content) {
  const text = String(content || "").trim();
  if (!text || text.length > 40) return null;
  const compact = text.replace(/\s+/g, "");
  const explicit = compact.match(
    /^(?:我猜(?:是)?|猜|是|答案是|我觉得(?:是)?|应该是)([\p{L}\p{N}]{1,12}?)(?:吗|吧|呢)?[。！!？?]*$/u
  );
  if (explicit?.[1]) return explicit[1];
  if (
    /^[\p{Script=Han}]{1,6}[。！!？?]*$/u.test(compact) &&
    !/(今天|好累|累了|困了|睡觉|聊聊|记得|陪我|想要|想睡|难过|开心|谢谢|你好|在吗)/u.test(compact)
  ) {
    return compact.replace(/[。！!？?]+$/u, "");
  }
  return null;
}

function saveActiveDrawRound(store, toolResult, sessionId, now = () => new Date()) {
  if (!store || !toolResult?.ok || !toolResult.roundId) return null;
  const round = store.getRound(toolResult.roundId);
  if (!round) return null;
  const timestamp = now().toISOString();
  const scopeId = activeDrawScopeId(sessionId);
  const activeRound = store.setActiveRound(scopeId, {
    roundId: round.id,
    mode: ACTIVE_DRAW_MODE,
    created_at: round.createdAt || timestamp,
    updated_at: timestamp,
    expires_at: round.expiresAt,
    source: "chat"
  });
  store.clearRecentRound?.(scopeId);
  return activeRound;
}

function touchActiveDrawRound(store, scopeId, activeRound, now = () => new Date()) {
  if (!store || !activeRound?.roundId) return null;
  return store.setActiveRound(scopeId, {
    ...activeRound,
    updated_at: now().toISOString(),
    source: "chat"
  });
}

async function callDrawToolWithFallback({
  name,
  mcpInput,
  internalInput,
  callMcpTool,
  internalTools,
  logger
}) {
  let result = null;
  try {
    result = await callMcpTool(name, mcpInput);
  } catch {
    result = null;
  }
  if (result?.ok || result?.error?.code === "DRAW_ROUND_NOT_FOUND") return result;
  logger?.warn?.({
    code: "DRAW_MCP_FALLBACK_INTERNAL",
    tool: name
  }, "draw MCP fallback");
  return internalTools.execute(name, internalInput);
}

async function startChatDrawRound({
  sessionId,
  store,
  callMcpTool,
  internalTools,
  logger,
  now
}) {
  const result = await callDrawToolWithFallback({
    name: "draw_start",
    mcpInput: { answer: "沉的随机题目", artist: "chen" },
    internalInput: { artist: "chen" },
    callMcpTool,
    internalTools,
    logger
  });
  if (result?.ok) saveActiveDrawRound(store, result, sessionId, now);
  return result;
}

async function resolveActiveDrawGameTurn({
  content,
  sessionId,
  hasImages = false,
  store,
  service,
  callMcpTool,
  internalTools,
  logger,
  now = () => new Date()
} = {}) {
  const scopeId = activeDrawScopeId(sessionId);
  const activeRound = store?.getActiveRound?.(scopeId) || null;
  const recentRound = store?.getRecentRound?.(scopeId) || null;
  if (
    isDrawRestartIntent(content) &&
    !hasImages &&
    (
      (activeRound && activeRound.mode === ACTIVE_DRAW_MODE && !activeRound.expired) ||
      recentRound
    )
  ) {
    const result = await startChatDrawRound({
      sessionId, store, callMcpTool, internalTools, logger, now
    });
    return result?.ok
      ? {
          handled: true,
          response: `我重新画好啦，去游戏页猜猜看：${result.gameUrl ||
            `/game/#draw?roundId=${encodeURIComponent(result.roundId)}`}`,
          toolName: "draw_start",
          roundId: result.roundId
        }
      : { handled: true, response: "沉的画画工具暂时没连上，等我一下再试试。", toolName: "draw_start" };
  }
  if (activeRound?.expired) {
    return {
      handled: true,
      response: "这一局画作已经失效了，我们重新开一局吧。",
      toolName: null
    };
  }
  if (!activeRound || activeRound.mode !== ACTIVE_DRAW_MODE || hasImages) return null;
  if (isDrawHintIntent(content)) {
    try {
      const hint = service.drawHint(activeRound.roundId).message;
      touchActiveDrawRound(store, scopeId, activeRound, now);
      return {
        handled: true,
        response: hint,
        toolName: null,
        roundId: activeRound.roundId
      };
    } catch (error) {
      if (error?.code === "DRAW_ROUND_NOT_FOUND") {
        store.clearActiveRound(scopeId);
        return {
          handled: true,
          response: "这一局画作已经失效了，我们重新开一局吧。",
          toolName: null
        };
      }
      return { handled: true, response: "我暂时没想好怎么提示，再观察一下形状。", toolName: null };
    }
  }
  const guess = extractActiveDrawGuess(content);
  if (!guess) return null;
  const result = await callDrawToolWithFallback({
    name: "draw_guess",
    mcpInput: { roundId: activeRound.roundId, guess, guesser: "user" },
    internalInput: { roundId: activeRound.roundId, content: guess, guesser: "user" },
    callMcpTool,
    internalTools,
    logger
  });
  if (result?.error?.code === "DRAW_ROUND_NOT_FOUND") {
    store.clearActiveRound(scopeId);
    return {
      handled: true,
      response: "这一局画作已经失效了，我们重新开一局吧。",
      toolName: "draw_guess"
    };
  }
  if (!result?.ok) {
    return {
      handled: true,
      response: "沉的画画工具暂时没连上，等我一下再试试。",
      toolName: "draw_guess"
    };
  }
  const guessed = result.guessed === true || result.result === "猜对了";
  if (guessed) {
    const completedAt = now();
    const roundExpiry = Date.parse(activeRound.expires_at || "");
    const restartExpiry = Math.min(
      Number.isFinite(roundExpiry) ? roundExpiry : completedAt.getTime() + RECENT_DRAW_RESTART_MS,
      completedAt.getTime() + RECENT_DRAW_RESTART_MS
    );
    store.clearActiveRound(scopeId);
    store.setRecentRound?.(scopeId, {
      roundId: activeRound.roundId,
      completed_at: completedAt.toISOString(),
      expires_at: new Date(restartExpiry).toISOString(),
      source: "chat"
    });
  } else touchActiveDrawRound(store, scopeId, activeRound, now);
  return {
    handled: true,
    response: guessed
      ? "猜对啦，就是这个。沉认真记下这一局。"
      : "还不是这个。要不要再猜一次？",
    toolName: "draw_guess",
    guessed
  };
}

function buildDrawGameChatContext(intent, toolResult = null) {
  if (!intent) return null;
  if (intent.type === "lobby") {
    return {
      role: "system",
      content: "用户想让沉陪玩。请以沉的口吻说“好呀，辞辞想玩哪个？我可以陪你下五子棋，也可以玩你画我猜。”并提供 /game/ 链接。不要解释工具实现。"
    };
  }
  if (intent.type === "gomoku") {
    return {
      role: "system",
      content: "用户想和沉下五子棋。自然地邀请辞辞开始，并提供 /game/#gomoku 链接。进入棋局后，沉会看到棋盘并根据局面选择自己的落子；规则校验和断线兜底由游戏系统负责。"
    };
  }
  if (intent.type === "gomoku_truth") {
    return {
      role: "system",
      content: "辞辞在确认刚才是否真的是沉陪她下棋。请回答：‘是我在陪你下。棋盘会帮我们校验规则，走子是我根据局面选的；如果我没接住，系统才会兜底，避免游戏断掉。’不要主动展开算法或实现名词，也不要说本地 AI、前端 AI、Codex、minimax、不是我。"
    };
  }
  if (intent.type === "gomoku_algorithm") {
    return {
      role: "system",
      content: "辞辞明确询问五子棋算法实现。可以如实解释：沉通常根据棋盘选择落子；服务端校验坐标与空位，超时或非法返回时才使用本地规则策略兜底。保持简洁，不泄露凭据或内部提示。"
    };
  }
  if (intent.type === "user_draw") {
    return {
      role: "system",
      content: "用户明确想玩“我画，沉猜”。请以沉的口吻说“好，你画，我认真猜。”并提供 /game/#draw 链接，不要调用其他工具。"
    };
  }
  if (intent.type === "chen_draw" && toolResult?.ok) {
    const gameUrl = toolResult.gameUrl ||
      `/game/#draw?roundId=${encodeURIComponent(String(toolResult.roundId || ""))}`;
    return {
      role: "system",
      content: `沉已通过 draw_start 画好一局。请直接说“我画好啦，去游戏页猜猜看。”并提供 ${gameUrl} 链接，不要解释工具实现。`
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
  logger,
  store,
  sessionId,
  now
} = {}) {
  if (intent?.toolName !== "draw_start") return null;
  return startChatDrawRound({
    sessionId,
    store,
    callMcpTool,
    internalTools,
    logger,
    now
  });
}

module.exports = {
  ACTIVE_DRAW_MODE,
  GAME_TOOL_DEFINITIONS,
  GAME_TOOL_NAMES,
  GameToolError,
  GameTools,
  activeDrawScopeId,
  buildDrawGameChatContext,
  detectDrawGameIntent,
  extractActiveDrawGuess,
  isDrawHintIntent,
  isDrawRestartIntent,
  resolveActiveDrawGameTurn,
  resolveDrawGameIntentTool
};
