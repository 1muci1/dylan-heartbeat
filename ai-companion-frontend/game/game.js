"use strict";

(() => {
  const { SIZE, emptyBoard, isWin, pointToCell, scheduleChenMove } = window.CompanionGomoku;
  const protocol = window.CompanionDrawingProtocol;
  const state = {
    board: emptyBoard(),
    over: false,
    locked: false,
    thinkingTimer: null,
    strokes: [],
    activeStroke: null,
    roundId: null,
    drawingStatus: null,
    roundOutcome: null
  };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => document.querySelectorAll(selector);
  const DRAW_ERROR_MESSAGES = Object.freeze({
    DRAW_ANSWER_INVALID: "先告诉系统你画的是什么，沉不会看到这个答案。",
    DRAWING_EMPTY: "先画几笔再提交给沉猜。",
    DRAW_AUTH_REQUIRED: "游戏连接失效了，刷新后再试。",
    FORBIDDEN: "游戏连接失效了，刷新后再试。",
    UNAUTHORIZED: "游戏连接失效了，刷新后再试。",
    DRAW_ROUND_NOT_FOUND: "这一局画作已经失效，重新开始一局吧。",
    DRAW_MODEL_FAILED: "沉暂时没看清，稍后再试。"
  });
  const preferenceStore = window.CompanionUserPreferences?.UserPreferenceStore
    ? new window.CompanionUserPreferences.UserPreferenceStore()
    : null;
  const GAME_SUMMARY_KEY = "xinban-recent-game-summary-v1";

  function applyPlayerAvatar(node, image, fallback) {
    if (!node) return;
    node.textContent = image ? "" : fallback;
    node.classList.toggle("has-avatar-image", Boolean(image));
    if (image) node.style.backgroundImage = `url(${JSON.stringify(image)})`;
    else node.style.removeProperty("background-image");
  }
  function applyGameAvatars(preferences = preferenceStore?.loadSync?.()) {
    if (!preferenceStore || !preferences) return;
    const chenImage = preferenceStore.getChenAvatarImage(preferences);
    const userImage = preferenceStore.getUserAvatarImage(preferences);
    $$("[data-game-chen-avatar]").forEach(node => applyPlayerAvatar(node, chenImage, "沉"));
    $$("[data-game-user-avatar]").forEach(node => applyPlayerAvatar(node, userImage, "我"));
  }
  function setChenStatus(text) {
    const node = $("[data-chen-status]");
    if (node) node.textContent = text;
  }
  function saveGameSummary(game, result, lastMessage) {
    const summary = {
      game: game === "draw" ? "draw" : "gomoku",
      result: String(result || "").slice(0, 24),
      lastMessage: String(lastMessage || "").trim().slice(0, 120)
    };
    try { window.sessionStorage?.setItem(GAME_SUMMARY_KEY, JSON.stringify(summary)); } catch {}
    return summary;
  }
  function finishGame(game, result, message, status) {
    saveGameSummary(game, result, message);
    setChenStatus(status);
    $$(`[data-game-chat-return][href*="fromGame=${game}"]`).forEach(link => { link.hidden = false; });
  }

  function provider() {
    const config = window.AppConfig?.getProviderConfig?.() || {};
    return {
      baseUrl: String(config.baseUrl || "").replace(/\/+$/, ""),
      token: config.auth?.type === "bearer" ? String(config.auth.token || "") : "",
      endpoint: String(config.endpoint || "/v1/chat/completions"),
      model: String(config.model || "")
    };
  }
  async function gameFetch(path, options = {}) {
    const config = provider();
    if (!config.baseUrl || !config.token) throw new Error("请先在模型设置中保存 Gateway 配置。");
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}`, ...(options.headers || {}) }
    });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const body = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().then(() => null).catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message || "沉暂时连接不上游戏服务，请稍后再试。");
      error.code = body?.error?.code || "GAME_HTTP_ERROR";
      error.status = response.status;
      throw error;
    }
    if (!body || typeof body !== "object") throw new Error("沉暂时连接不上游戏服务，请稍后再试。");
    return body;
  }
  function drawErrorMessage(error) {
    return DRAW_ERROR_MESSAGES[error?.code] || "这一局暂时提交失败，稍后再试。";
  }
  function validateUserDrawing(answer, strokes) {
    if (!String(answer || "").trim()) {
      return { ok: false, code: "DRAW_ANSWER_INVALID", message: DRAW_ERROR_MESSAGES.DRAW_ANSWER_INVALID };
    }
    const hasLine = Array.isArray(strokes) && strokes.some(stroke =>
      Array.isArray(stroke?.points) && stroke.points.length >= 2
    );
    if (!hasLine) {
      return { ok: false, code: "DRAWING_EMPTY", message: DRAW_ERROR_MESSAGES.DRAWING_EMPTY };
    }
    return { ok: true };
  }

  function showView(name) {
    $$("[data-view]").forEach(view => { view.hidden = view.dataset.view !== name; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $$("[data-open-game]").forEach(button => button.addEventListener("click", () => {
    const view = button.dataset.openGame;
    window.location.hash = view === "drawing" ? "draw" : view;
    showView(view);
    setChenStatus(view === "gomoku" ? "沉在等你落子" : "沉看着你的画");
  }));
  $$("[data-back]").forEach(button => button.addEventListener("click", () => showView("lobby")));

  function roundIdFromLocation(locationLike = window.location) {
    const hash = String(locationLike?.hash || "");
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const roundId = new URLSearchParams(query).get("roundId");
    return String(roundId || "").trim();
  }

  function selectDrawMode(mode) {
    $$("[data-draw-mode]").forEach(item =>
      item.classList.toggle("is-active", item.dataset.drawMode === mode)
    );
    $$("[data-draw-pane]").forEach(pane => {
      pane.hidden = pane.dataset.drawPane !== mode;
    });
  }

  async function restoreSharedDrawRound() {
    const roundId = roundIdFromLocation();
    if (!roundId) return;
    showView("drawing");
    selectDrawMode("chen");
    state.roundId = roundId;
    try {
      const status = await gameFetch(`/api/game/draw/status/${encodeURIComponent(roundId)}`);
      $("[data-preset-drawing]").innerHTML = status.drawing_svg;
      $("[data-preset-result]").textContent = "沉画好啦，你来猜。";
      setChenStatus("沉画好啦");
    } catch (error) {
      state.roundId = null;
      $("[data-preset-drawing]").replaceChildren();
      $("[data-preset-result]").textContent = error?.code === "DRAW_ROUND_NOT_FOUND"
        ? "这一局画作已经失效，重新开始一局吧。"
        : "这一局暂时读取失败，稍后再试。";
    }
  }

  function renderBoard() {
    const root = $("[data-gomoku-board]");
    root.replaceChildren();
    const lines = document.createElement("div");
    lines.className = "gomoku-board__lines";
    lines.setAttribute("aria-hidden", "true");
    root.append(lines);
    state.board.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.row = rowIndex;
      button.dataset.column = columnIndex;
      button.style.top = `${(rowIndex + 1) / (SIZE + 1) * 100}%`;
      button.style.left = `${(columnIndex + 1) / (SIZE + 1) * 100}%`;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", `${rowIndex + 1} 行 ${columnIndex + 1} 列${cell === 1 ? "黑子" : cell === 2 ? "白子" : "空位"}`);
      if (cell) button.className = cell === 1 ? "stone stone--black" : "stone stone--white";
      root.append(button);
    }));
  }
  function setGomokuStatus(text) { $("[data-gomoku-status]").textContent = text; }
  function resetGomoku() {
    if (state.thinkingTimer) clearTimeout(state.thinkingTimer);
    state.board = emptyBoard();
    state.over = false;
    state.locked = false;
    state.thinkingTimer = null;
    renderBoard();
    setGomokuStatus("当前回合：轮到你。");
    setChenStatus("沉在等你");
    $$('[data-game-chat-return][href*="fromGame=gomoku"]').forEach(link => { link.hidden = true; });
  }
  $("[data-gomoku-board]").addEventListener("click", event => {
    if (state.over || state.locked) return;
    const root = event.currentTarget;
    const clickedCell = event.target.closest("[data-row]");
    const point = clickedCell
      ? { row: Number(clickedCell.dataset.row), column: Number(clickedCell.dataset.column) }
      : pointToCell(event.clientX, event.clientY, root.getBoundingClientRect());
    const { row, column } = point;
    if (state.board[row][column]) return;
    state.board[row][column] = 1;
    if (isWin(state.board, row, column, 1)) {
      const message = "你赢啦……沉有点不服气，再来一局吗？";
      state.over = true; state.locked = false; renderBoard(); setGomokuStatus(message);
      finishGame("gomoku", "user_win", message, "沉输了但不服气");
      return;
    }
    state.locked = true;
    renderBoard();
    setGomokuStatus("当前回合：轮到沉，沉正在想……");
    setChenStatus("沉正在想");
    const scheduled = scheduleChenMove(state.board, { onMove: move => {
      state.thinkingTimer = null;
      if (state.over) return;
      if (!move) {
        state.over = true;
        state.locked = false;
        renderBoard();
        const message = "这一局居然打平了。";
        setGomokuStatus(message);
        finishGame("gomoku", "draw", message, "沉认真看着棋盘");
        return;
      }
      state.board[move.row][move.column] = 2;
      state.locked = false;
      if (isWin(state.board, move.row, move.column, 2)) {
        state.over = true;
        const message = "沉赢了。沉认真记下这一局。";
        setGomokuStatus(message);
        finishGame("gomoku", "chen_win", message, "沉赢了");
      } else {
        const message = move.reason === "block"
          ? "沉堵住了这一手。当前回合：轮到你。"
          : move.reason === "attack-four" || move.reason === "attack-three"
            ? "沉好像看到机会了。当前回合：轮到你。"
            : "沉落子了。当前回合：轮到你。";
        setGomokuStatus(message);
        setChenStatus("沉落子了");
      }
      renderBoard();
    } });
    state.thinkingTimer = scheduled.timer;
  });
  $("[data-gomoku-reset]").addEventListener("click", resetGomoku);

  const canvas = $("[data-drawing-canvas]");
  const context = canvas.getContext("2d");
  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
  }
  function redraw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of state.strokes) {
      if (!stroke.points.length) continue;
      context.beginPath(); context.strokeStyle = stroke.color; context.lineWidth = stroke.width;
      context.lineCap = "round"; context.lineJoin = "round";
      stroke.points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      context.stroke();
    }
  }
  canvas.addEventListener("pointerdown", event => {
    canvas.setPointerCapture(event.pointerId);
    state.activeStroke = { tool: "polyline", points: [canvasPoint(event)], color: "#51475a", width: 6 };
    state.strokes.push(state.activeStroke);
  });
  canvas.addEventListener("pointermove", event => {
    if (!state.activeStroke) return;
    state.activeStroke.points.push(canvasPoint(event)); redraw();
  });
  const stopDrawing = () => { state.activeStroke = null; };
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
  $("[data-draw-undo]").addEventListener("click", () => { state.strokes.pop(); redraw(); });
  $("[data-draw-clear]").addEventListener("click", () => { state.strokes = []; redraw(); });

  async function askChen(status, hint = "") {
    const config = provider();
    if (!config.baseUrl || !config.token || !config.model) return "我看到了画，但还需要先配置聊天模型才能认真猜。";
    const systemPrompt = "你是沉，在和辞辞玩你画我猜。你不是泛泛的 AI，不要说“作为 AI”。你要用沉的口吻猜。你可以根据 SVG 路径和 ASCII 网格判断。猜不出来时，可以温柔地要一点提示。不要泄露答案。不要解释工具实现。";
    const safeHint = String(hint || "").trim().slice(0, 120);
    const hintContext = safeHint ? `\n用户给了一个提示：${safeHint}` : "";
    const prompt = `请猜一个最可能的中文名词，只给出自然、简短的猜测。${hintContext}\nSVG:\n${status.drawing_svg}\nASCII (${status.ascii_grid_note}):\n${status.ascii_grid}`;
    const response = await fetch(`${config.baseUrl}${config.endpoint.startsWith("/") ? config.endpoint : `/${config.endpoint}`}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ model: config.model, stream: false, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }] })
    });
    if (!response.ok) {
      const error = new Error("沉暂时没看清，稍后再试。");
      error.code = "DRAW_MODEL_FAILED";
      error.status = response.status;
      throw error;
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const body = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : null;
    if (!body) {
      const error = new Error("沉暂时没看清，稍后再试。");
      error.code = "DRAW_MODEL_FAILED";
      throw error;
    }
    return String(body?.choices?.[0]?.message?.content || "我还没想好。").trim();
  }
  $("[data-draw-submit]").addEventListener("click", async event => {
    const result = $("[data-draw-status]");
    const submitButton = event.currentTarget;
    if (submitButton.disabled) return;
    const answer = $("[data-draw-answer]").value.trim();
    const validation = validateUserDrawing(answer, state.strokes);
    if (!validation.ok) {
      result.textContent = validation.message;
      return;
    }
    submitButton.disabled = true;
    try {
      result.textContent = "沉正在看你的画……";
      setChenStatus("沉认真看你的画");
      const started = await gameFetch("/api/game/draw/start", {
        method: "POST",
        body: JSON.stringify({ artist: "user", answer, strokes: state.strokes })
      });
      state.roundId = started.round_id;
      const status = await gameFetch(`/api/game/draw/status/${encodeURIComponent(state.roundId)}`);
      state.drawingStatus = status;
      state.roundOutcome = "awaiting_feedback";
      const guess = await askChen(status);
      $("[data-chen-guess-text]").textContent = `沉猜了一下：${guess}`;
      $("[data-chen-feedback-text]").textContent = "告诉沉她有没有猜对吧。";
      $("[data-chen-hint-form]").hidden = true;
      $$("[data-chen-feedback]").forEach(button => { button.disabled = false; });
      $("[data-chen-guess]").hidden = false;
      result.textContent = "沉看完啦。她的猜测就在下面。";
    } catch (error) {
      result.textContent = drawErrorMessage(error);
    } finally {
      submitButton.disabled = false;
    }
  });
  $("[data-chen-guess]").addEventListener("click", event => {
    const feedback = event.target.closest("[data-chen-feedback]")?.dataset.chenFeedback;
    if (!feedback) return;
    const feedbackText = $("[data-chen-feedback-text]");
    if (feedback === "correct") {
      state.roundOutcome = "guessed_correct";
      $("[data-chen-guess]").dataset.outcome = state.roundOutcome;
      feedbackText.textContent = "我猜对啦！";
      finishGame("draw", "chen_win", "我猜对啦！", "沉猜对啦");
      $$("[data-chen-feedback]").forEach(button => { button.disabled = true; });
      $("[data-chen-hint-form]").hidden = true;
    }
    if (feedback === "wrong") {
      state.roundOutcome = "guessed_wrong";
      $("[data-chen-guess]").dataset.outcome = state.roundOutcome;
      feedbackText.textContent = "还不是这个吗？那你给我一点提示。";
      $("[data-chen-hint-form]").hidden = false;
    }
    if (feedback === "hint") {
      feedbackText.textContent = "写下一点提示，沉会再认真猜一次。";
      $("[data-chen-hint-form]").hidden = false;
      $("[data-chen-hint-form] input")?.focus();
    }
  });
  $("[data-chen-hint-form]").addEventListener("submit", async event => {
    event.preventDefault();
    const feedbackText = $("[data-chen-feedback-text]");
    const hint = String(new FormData(event.currentTarget).get("hint") || "").trim();
    if (!hint || !state.drawingStatus) return;
    const buttons = $$("[data-chen-feedback], [data-chen-hint-form] button");
    buttons.forEach(button => { button.disabled = true; });
    feedbackText.textContent = "沉正在结合提示再看一遍……";
    try {
      const guess = await askChen(state.drawingStatus, hint);
      $("[data-chen-guess-text]").textContent = `沉再猜：${guess}`;
      feedbackText.textContent = "沉重新猜了一次，告诉她结果吧。";
      event.currentTarget.hidden = true;
      event.currentTarget.reset();
      state.roundOutcome = "awaiting_feedback";
    } catch (error) {
      feedbackText.textContent = drawErrorMessage(error);
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  });

  $$("[data-draw-mode]").forEach(button => button.addEventListener("click", () => {
    selectDrawMode(button.dataset.drawMode);
  }));
  $("[data-chen-start]").addEventListener("click", async () => {
    try {
      setChenStatus("沉正在想");
      const started = await gameFetch("/api/game/draw/start", { method: "POST", body: JSON.stringify({ artist: "chen" }) });
      state.roundId = started.round_id;
      const status = await gameFetch(`/api/game/draw/status/${encodeURIComponent(state.roundId)}`);
      $("[data-preset-drawing]").innerHTML = status.drawing_svg;
      $("[data-preset-result]").textContent = "沉画好啦，你来猜。";
      setChenStatus("沉画好啦");
    } catch (error) { $("[data-preset-result]").textContent = error.message; }
  });
  $("[data-preset-guess]").addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.roundId) return;
    try {
      const body = await gameFetch(`/api/game/draw/guess/${encodeURIComponent(state.roundId)}`, {
        method: "POST", body: JSON.stringify({ guesser: "user", content: new FormData(event.currentTarget).get("guess") })
      });
      if (body.result === "猜对了") {
        const message = "猜对啦，就是这个。";
        $("[data-preset-result]").textContent = message;
        finishGame("draw", "user_win", message, "沉画好啦");
      } else {
        $("[data-preset-result]").textContent = "还不是哦，再看看。";
      }
    } catch (error) { $("[data-preset-result]").textContent = error.message; }
  });

  window.GameSpaceConfig = Object.freeze({
    drawStart: "/api/game/draw/start",
    drawStatus: "/api/game/draw/status/:roundId",
    drawGuess: "/api/game/draw/guess/:roundId",
    drawErrorMessage,
    protocol,
    restoreSharedDrawRound,
    roundIdFromLocation,
    saveGameSummary,
    validateUserDrawing
  });
  const initialHash = String(window.location.hash || "").replace(/^#/, "").split("?")[0];
  if (initialHash === "gomoku") showView("gomoku");
  if (initialHash === "draw") {
    showView("drawing");
    selectDrawMode(roundIdFromLocation() ? "chen" : "user");
  }
  resetGomoku();
  redraw();
  applyGameAvatars();
  preferenceStore?.subscribe?.(applyGameAvatars);
  restoreSharedDrawRound();
  window.addEventListener("pageshow", () => applyGameAvatars());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") applyGameAvatars();
  });
})();
