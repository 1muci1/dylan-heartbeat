"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionGomoku = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const SIZE = 15;
  const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

  function isWin(board, row, column, player) {
    if (!board?.[row] || board[row][column] !== player) return false;
    return [[1,0],[0,1],[1,1],[1,-1]].some(([dr, dc]) => {
      let count = 1;
      for (const sign of [-1, 1]) {
        for (let step = 1; step < 5; step++) {
          if (board[row + dr * step * sign]?.[column + dc * step * sign] !== player) break;
          count++;
        }
      }
      return count >= 5;
    });
  }

  function winningMoves(board, player) {
    const moves = [];
    for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
      if (board[row][column]) continue;
      board[row][column] = player;
      const win = isWin(board, row, column, player);
      board[row][column] = 0;
      if (win) moves.push({ row, column });
    }
    return moves;
  }

  const DIRECTIONS = [[1,0],[0,1],[1,1],[1,-1]];

  function directionString(board, row, column, player, dr, dc) {
    let result = "";
    for (let step = -4; step <= 4; step++) {
      const value = board[row + dr * step]?.[column + dc * step];
      result += value === player ? "X" : value === 0 ? "_" : "O";
    }
    return result;
  }

  function analyzeMove(board, row, column, player) {
    if (board[row]?.[column]) return { win: false, four: 0, liveThree: 0 };
    board[row][column] = player;
    const win = isWin(board, row, column, player);
    let four = 0;
    let liveThree = 0;
    for (const [dr, dc] of DIRECTIONS) {
      const line = directionString(board, row, column, player, dr, dc);
      if (/XXXX_|_XXXX|XXX_X|XX_XX|X_XXX/.test(line)) four++;
      if (/_XXX_|_XX_X_|_X_XX_/.test(line)) liveThree++;
    }
    board[row][column] = 0;
    return { win, four, liveThree };
  }

  function rankedMoves(board, player, feature) {
    const moves = [];
    for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
      if (board[row][column]) continue;
      const analysis = analyzeMove(board, row, column, player);
      if (!analysis[feature]) continue;
      let proximity = 0;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        if (board[row + dr]?.[column + dc]) proximity += 3 - Math.max(Math.abs(dr), Math.abs(dc));
      }
      moves.push({ row, column, strength: analysis[feature], proximity });
    }
    return moves.sort((left, right) => right.strength - left.strength || right.proximity - left.proximity);
  }

  function nearbyMoves(board) {
    const nearby = [];
    const all = [];
    for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
      if (board[row][column]) continue;
      const move = { row, column };
      all.push(move);
      let proximity = 0;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        if (board[row + dr]?.[column + dc]) proximity += 3 - Math.max(Math.abs(dr), Math.abs(dc));
      }
      if (proximity) nearby.push({ ...move, proximity });
    }
    return (nearby.length ? nearby.sort((a, b) => b.proximity - a.proximity) : all);
  }

  function chooseAiMove(board, random = Math.random) {
    const win = winningMoves(board, 2)[0];
    if (win) return { ...win, reason: "win" };
    const immediateBlock = winningMoves(board, 1)[0];
    if (immediateBlock) return { ...immediateBlock, reason: "block" };

    const attackFour = rankedMoves(board, 2, "four")[0];
    if (attackFour) return { row: attackFour.row, column: attackFour.column, reason: "attack-four" };
    const defendFour = rankedMoves(board, 1, "four")[0];
    if (defendFour) return { row: defendFour.row, column: defendFour.column, reason: "block" };
    const defendThree = rankedMoves(board, 1, "liveThree")[0];
    if (defendThree) return { row: defendThree.row, column: defendThree.column, reason: "block" };
    const attackThree = rankedMoves(board, 2, "liveThree")[0];
    if (attackThree) return { row: attackThree.row, column: attackThree.column, reason: "attack-three" };

    const choices = nearbyMoves(board);
    if (!choices.length) return null;
    const bestProximity = choices[0].proximity;
    const best = Number.isFinite(bestProximity)
      ? choices.filter(move => move.proximity === bestProximity)
      : choices;
    const selected = best[Math.floor(random() * best.length) % best.length];
    return { row: selected.row, column: selected.column, reason: "nearby" };
  }

  function pointToCell(clientX, clientY, rect, size = SIZE) {
    const edge = rect.width / (size + 1);
    const spanX = Math.max(1, rect.width - edge * 2);
    const spanY = Math.max(1, rect.height - edge * 2);
    const column = Math.round((clientX - rect.left - edge) / spanX * (size - 1));
    const row = Math.round((clientY - rect.top - edge) / spanY * (size - 1));
    return {
      row: Math.max(0, Math.min(size - 1, row)),
      column: Math.max(0, Math.min(size - 1, column))
    };
  }

  function scheduleChenMove(board, {
    random = Math.random,
    setTimer = setTimeout,
    onMove,
    minimumDelay = 600,
    maximumDelay = 1200
  } = {}) {
    if (typeof onMove !== "function") throw new TypeError("onMove 必填");
    const span = Math.max(0, maximumDelay - minimumDelay);
    const delay = minimumDelay + Math.floor(random() * (span + 1));
    const timer = setTimer(() => onMove(chooseAiMove(board, random)), delay);
    return { timer, delay };
  }

  return Object.freeze({
    SIZE,
    analyzeMove,
    chooseAiMove,
    emptyBoard,
    isWin,
    pointToCell,
    scheduleChenMove,
    winningMoves
  });
});
