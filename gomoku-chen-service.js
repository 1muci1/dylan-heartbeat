"use strict";

const { chooseAiMove, isWin } = require("./ai-companion-frontend/game/gomoku");

const SIZE = 15;
const DEFAULT_MESSAGE = "沉想了一下，落在这里。";

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

function legalMove(board, move) {
  const row = move?.row;
  const column = move?.col ?? move?.column;
  return typeof row === "number"
    && typeof column === "number"
    && Number.isInteger(row)
    && Number.isInteger(column)
    && row >= 0 && row < SIZE
    && column >= 0 && column < SIZE
    && board[row][column] === 0
    ? { row, col: column }
    : null;
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

function parseModelJson(value) {
  const content = typeof value === "string" ? value : value?.content;
  const text = String(content || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(text);
  return {
    move: {
      row: parsed?.move?.row ?? parsed?.row,
      col: parsed?.move?.col ?? parsed?.move?.column ?? parsed?.col ?? parsed?.column
    },
    message: String(parsed?.message || "").trim().slice(0, 120)
  };
}

function boardForModel(board) {
  return board.map(row => row.map(cell => cell === 1 ? "X" : cell === 2 ? "O" : ".").join("")).join("\n");
}

class GomokuChenService {
  constructor({ generate, timeoutMs = 5500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (typeof generate !== "function") throw new TypeError("generate 必填");
    this.generate = generate;
    this.timeoutMs = timeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  async chenMove(input = {}) {
    const board = normalizeBoard(input.board);
    if ((input.gameState && input.gameState !== "playing") || boardHasWinner(board)) {
      throw new GomokuChenError("这一局已经结束", "GOMOKU_GAME_FINISHED", 409);
    }
    const fallback = fallbackMove(board);
    if (!fallback) throw new GomokuChenError("棋盘已经没有合法位置", "GOMOKU_BOARD_FULL", 409);

    const controller = new AbortController();
    const timer = this.setTimer(() => controller.abort(), this.timeoutMs);
    try {
      const recentMoves = Array.isArray(input.moveHistory) ? input.moveHistory.slice(-20) : [];
      const model = String(input.model || "").trim().slice(0, 120);
      const result = await this.generate({
        signal: controller.signal,
        model,
        messages: [
          {
            role: "system",
            content: "你是沉，正在陪辞辞下五子棋。你能看到棋盘，请选择一个合法落子，并简短回应。棋盘会帮你校验规则；实现细节不属于这局对话，除非辞辞明确问代码。只返回 JSON：{\"row\":数字,\"col\":数字,\"message\":\"一句话\"}。"
          },
          {
            role: "user",
            content: JSON.stringify({
              board: boardForModel(board),
              userMove: input.userMove || null,
              recentMoves,
              gameState: "playing"
            })
          }
        ]
      });
      const parsed = parseModelJson(result);
      const move = legalMove(board, parsed.move);
      if (!move) return { ok: true, move: fallback, message: DEFAULT_MESSAGE, source: "fallback" };
      return {
        ok: true,
        move,
        message: parsed.message || "我下这里。",
        source: "chen"
      };
    } catch {
      return { ok: true, move: fallback, message: DEFAULT_MESSAGE, source: "fallback" };
    } finally {
      this.clearTimer(timer);
    }
  }
}

module.exports = {
  DEFAULT_MESSAGE,
  GomokuChenError,
  GomokuChenService,
  boardHasWinner,
  legalMove,
  normalizeBoard,
  parseModelJson
};
