"use strict";

const { chooseAiMove, isWin, winningMoves } = require("./ai-companion-frontend/game/gomoku");

const SIZE = 15;
const DEFAULT_MESSAGE = "沉想了一下，落在这里。";
const FALLBACK_REASONS = Object.freeze([
  "MODEL_DISABLED",
  "PROVIDER_CONFIG_MISSING",
  "TARGET_API_URL_MISSING",
  "TARGET_API_KEY_MISSING",
  "MODEL_HTTP_FAILED",
  "MODEL_TIMEOUT",
  "MODEL_EMPTY_RESPONSE",
  "MODEL_JSON_PARSE_FAILED",
  "MODEL_MOVE_MISSING",
  "MODEL_MOVE_NOT_NUMERIC",
  "MODEL_MOVE_OUT_OF_RANGE",
  "MODEL_MOVE_OCCUPIED",
  "MODEL_MOVE_NOT_IN_CANDIDATES",
  "GAME_ALREADY_OVER",
  "INTERNAL_ERROR"
]);

class GomokuChenError extends Error {
  constructor(message, code = "GOMOKU_REQUEST_INVALID", statusCode = 400) {
    super(message);
    this.name = "GomokuChenError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeBoard(value) {
  if (!Array.isArray(value) || value.length !== SIZE) {
    throw new GomokuChenError("棋盘必须是十五乘十五");
  }
  return value.map(row => {
    if (!Array.isArray(row) || row.length !== SIZE || row.some(cell => ![0, 1, 2].includes(cell))) {
      throw new GomokuChenError("棋盘内容无效");
    }
    return row.slice();
  });
}

function numericCoordinate(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^\d{1,2}$/.test(value.trim())) return Number(value.trim());
  return null;
}

function validateModelMove(board, move, candidates) {
  const rawRow = move?.row;
  const rawCol = move?.col ?? move?.column;
  if (rawRow === undefined || rawCol === undefined) return { reason: "MODEL_MOVE_MISSING" };
  const row = numericCoordinate(rawRow);
  const col = numericCoordinate(rawCol);
  if (row === null || col === null) return { reason: "MODEL_MOVE_NOT_NUMERIC" };
  if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return { reason: "MODEL_MOVE_OUT_OF_RANGE" };
  if (board[row][col] !== 0) return { reason: "MODEL_MOVE_OCCUPIED" };
  if (!candidates.some(candidate => candidate.row === row && candidate.col === col)) {
    return { reason: "MODEL_MOVE_NOT_IN_CANDIDATES" };
  }
  return { move: { row, col } };
}

function legalMove(board, move) {
  const candidates = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) if (board[row][col] === 0) candidates.push({ row, col });
  }
  return validateModelMove(board, move, candidates).move || null;
}

function fallbackMove(board) {
  const move = chooseAiMove(board);
  return move ? { row: move.row, col: move.column } : null;
}

function boardHasWinner(board) {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (board[row][col] !== 0 && isWin(board, row, col, board[row][col])) return true;
    }
  }
  return false;
}

function extractJsonObject(text) {
  const source = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function parseModelJson(value) {
  const content = typeof value === "string" ? value : value?.content;
  if (!String(content || "").trim()) throw Object.assign(new Error("empty model response"), { code: "MODEL_EMPTY_RESPONSE" });
  const json = extractJsonObject(content);
  if (!json) throw Object.assign(new Error("model JSON missing"), { code: "MODEL_JSON_PARSE_FAILED" });
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw Object.assign(new Error("model JSON invalid"), { code: "MODEL_JSON_PARSE_FAILED" });
  }
  return {
    move: {
      row: parsed?.move?.row ?? parsed?.row,
      col: parsed?.move?.col ?? parsed?.move?.column ?? parsed?.col ?? parsed?.column
    },
    message: String(parsed?.message || "").trim().slice(0, 120)
  };
}

function candidateMoves(board, limit = 12) {
  const result = [];
  const seen = new Set();
  const add = move => {
    const row = move?.row;
    const col = move?.col ?? move?.column;
    const key = `${row}:${col}`;
    if (!Number.isInteger(row) || !Number.isInteger(col) || board[row]?.[col] !== 0 || seen.has(key)) return;
    seen.add(key);
    result.push({ row, col });
  };
  winningMoves(board, 2).forEach(add);
  winningMoves(board, 1).forEach(add);
  add(chooseAiMove(board, () => 0));
  const nearby = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (board[row][col] !== 0) continue;
      let proximity = 0;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          if (board[row + dr]?.[col + dc]) proximity += 3 - Math.max(Math.abs(dr), Math.abs(dc));
        }
      }
      if (proximity > 0) nearby.push({ row, col, proximity });
    }
  }
  nearby.sort((left, right) => right.proximity - left.proximity || left.row - right.row || left.col - right.col).forEach(add);
  if (!result.length) add({ row: 7, col: 7 });
  return result.slice(0, Math.max(1, Math.min(20, limit)));
}

function fallbackResult(move, reason, statusCode = 200) {
  return { ok: true, move, message: DEFAULT_MESSAGE, source: "fallback", reason, statusCode };
}

function fallbackReason(error) {
  if (error?.name === "AbortError") return "MODEL_TIMEOUT";
  return FALLBACK_REASONS.includes(error?.code) ? error.code : "INTERNAL_ERROR";
}

class GomokuChenService {
  constructor({ generate, timeoutMs = 15000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (typeof generate !== "function") throw new TypeError("generate 必填");
    this.generate = generate;
    this.timeoutMs = timeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  async chenMove(input = {}) {
    const board = normalizeBoard(input.board);
    if ((input.gameState && input.gameState !== "playing") || boardHasWinner(board)) {
      throw new GomokuChenError("这一局已经结束", "GAME_ALREADY_OVER", 409);
    }
    const fallback = fallbackMove(board);
    if (!fallback) throw new GomokuChenError("棋盘已经没有合法位置", "GOMOKU_BOARD_FULL", 409);
    const candidates = candidateMoves(board);
    const controller = new AbortController();
    const timer = this.setTimer(() => controller.abort(), this.timeoutMs);
    try {
      const lastMoves = Array.isArray(input.moveHistory) ? input.moveHistory.slice(-10) : [];
      const result = await this.generate({
        signal: controller.signal,
        model: String(input.model || "").trim().slice(0, 120),
        messages: [
          {
            role: "system",
            content: "你是沉，正在和辞辞下五子棋。棋盘是 15x15，0 表示空，1 表示辞辞，2 表示沉；你执白棋 2。只能从 candidates 中选择一个空位，row 和 col 必须是 0 到 14 的整数。只返回 JSON，不要 markdown。格式：{\"row\":数字,\"col\":数字,\"message\":\"一句很短的自然反应\"}"
          },
          {
            role: "user",
            content: JSON.stringify({ board, userMove: input.userMove || null, lastMoves, candidates })
          }
        ]
      });
      const parsed = parseModelJson(result);
      const validated = validateModelMove(board, parsed.move, candidates);
      if (!validated.move) return fallbackResult(fallback, validated.reason);
      return { ok: true, move: validated.move, message: parsed.message || "我下这里。", source: "chen" };
    } catch (error) {
      const reason = fallbackReason(error);
      const statusCode = Number(error?.statusCode)
        || (reason === "MODEL_TIMEOUT" ? 504 : reason === "MODEL_HTTP_FAILED" ? 502 : 200);
      return fallbackResult(fallback, reason, statusCode);
    } finally {
      this.clearTimer(timer);
    }
  }
}

module.exports = {
  DEFAULT_MESSAGE,
  FALLBACK_REASONS,
  GomokuChenError,
  GomokuChenService,
  boardHasWinner,
  candidateMoves,
  extractJsonObject,
  legalMove,
  normalizeBoard,
  parseModelJson,
  validateModelMove
};
