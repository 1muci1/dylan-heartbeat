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

  function winningMove(board, player) {
    for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
      if (board[row][column]) continue;
      board[row][column] = player;
      const win = isWin(board, row, column, player);
      board[row][column] = 0;
      if (win) return { row, column };
    }
    return null;
  }

  function chooseAiMove(board, random = Math.random) {
    const forced = winningMove(board, 2) || winningMove(board, 1);
    if (forced) return forced;
    const nearby = [];
    const all = [];
    for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
      if (board[row][column]) continue;
      all.push({ row, column });
      let neighbor = false;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        if (board[row + dr]?.[column + dc]) neighbor = true;
      }
      if (neighbor) nearby.push({ row, column });
    }
    const choices = nearby.length ? nearby : all;
    return choices.length ? choices[Math.floor(random() * choices.length) % choices.length] : null;
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

  return Object.freeze({ SIZE, emptyBoard, isWin, chooseAiMove, scheduleChenMove });
});
