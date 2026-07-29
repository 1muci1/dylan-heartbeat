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
    roundId: null
  };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => document.querySelectorAll(selector);
  const preferenceStore = window.CompanionUserPreferences?.UserPreferenceStore
    ? new window.CompanionUserPreferences.UserPreferenceStore()
    : null;

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

  function showView(name) {
    $$("[data-view]").forEach(view => { view.hidden = view.dataset.view !== name; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $$("[data-open-game]").forEach(button => button.addEventListener("click", () => showView(button.dataset.openGame)));
  $$("[data-back]").forEach(button => button.addEventListener("click", () => showView("lobby")));

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
      state.over = true; state.locked = false; renderBoard(); setGomokuStatus("你赢了。沉认真记下这一局。"); return;
    }
    state.locked = true;
    renderBoard();
    setGomokuStatus("当前回合：轮到沉，沉正在想……");
    const scheduled = scheduleChenMove(state.board, { onMove: move => {
      state.thinkingTimer = null;
      if (state.over) return;
      if (!move) {
        state.over = true;
        state.locked = false;
        renderBoard();
        setGomokuStatus("棋盘满了，这局是平局。");
        return;
      }
      state.board[move.row][move.column] = 2;
      state.locked = false;
      if (isWin(state.board, move.row, move.column, 2)) {
        state.over = true;
        setGomokuStatus("沉赢了。沉认真记下这一局。");
      } else {
        setGomokuStatus(move.reason === "block"
          ? "沉堵住了这一手。当前回合：轮到你。"
          : "沉落子了。当前回合：轮到你。");
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

  async function askChen(status) {
    const config = provider();
    if (!config.baseUrl || !config.token || !config.model) return "我看到了画，但还需要先配置聊天模型才能认真猜。";
    const systemPrompt = "你是沉，在和辞辞玩你画我猜。你不是泛泛的 AI，不要说“作为 AI”。你要用沉的口吻猜。你可以根据 SVG 路径和 ASCII 网格判断。猜不出来时，可以温柔地要一点提示。不要泄露答案。不要解释工具实现。";
    const prompt = `请猜一个最可能的中文名词，只给出自然、简短的猜测。\nSVG:\n${status.drawing_svg}\nASCII (${status.ascii_grid_note}):\n${status.ascii_grid}`;
    const response = await fetch(`${config.baseUrl}${config.endpoint.startsWith("/") ? config.endpoint : `/${config.endpoint}`}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ model: config.model, stream: false, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }] })
    });
    if (!response.ok) throw new Error("沉暂时没猜出来，请稍后重试。");
    const body = await response.json();
    return String(body?.choices?.[0]?.message?.content || "我还没想好。").trim();
  }
  $("[data-draw-submit]").addEventListener("click", async event => {
    const result = $("[data-draw-status]");
    const submitButton = event.currentTarget;
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    try {
      result.textContent = "沉正在看你的画……";
      const started = await gameFetch("/api/game/draw/start", {
        method: "POST",
        body: JSON.stringify({ artist: "user", answer: $("[data-draw-answer]").value, strokes: state.strokes })
      });
      state.roundId = started.round_id;
      const status = await gameFetch(`/api/game/draw/status/${encodeURIComponent(state.roundId)}`);
      const guess = await askChen(status);
      $("[data-chen-guess-text]").textContent = `沉猜：${guess}`;
      $("[data-chen-guess]").hidden = false;
      result.textContent = "沉看完啦。她的猜测就在下面。";
    } catch {
      result.textContent = "沉暂时没看清，稍后再试。";
    } finally {
      submitButton.disabled = false;
    }
  });
  $("[data-chen-guess]").addEventListener("click", event => {
    const feedback = event.target.closest("[data-chen-feedback]")?.dataset.chenFeedback;
    if (feedback === "correct") $("[data-draw-status]").textContent = "沉猜对啦，她很开心。";
    if (feedback === "wrong") $("[data-draw-status]").textContent = "沉没猜中，可以给她一点提示。";
    if (feedback === "hint") $("[data-draw-status]").textContent = "告诉沉一个小提示，再让她猜一次吧。";
  });

  $$("[data-draw-mode]").forEach(button => button.addEventListener("click", () => {
    $$("[data-draw-mode]").forEach(item => item.classList.toggle("is-active", item === button));
    $$("[data-draw-pane]").forEach(pane => { pane.hidden = pane.dataset.drawPane !== button.dataset.drawMode; });
  }));
  $("[data-chen-start]").addEventListener("click", async () => {
    try {
      const started = await gameFetch("/api/game/draw/start", { method: "POST", body: JSON.stringify({ artist: "chen" }) });
      state.roundId = started.round_id;
      const status = await gameFetch(`/api/game/draw/status/${encodeURIComponent(state.roundId)}`);
      $("[data-preset-drawing]").innerHTML = status.drawing_svg;
      $("[data-preset-result]").textContent = "沉画了一张图，你来猜。";
    } catch (error) { $("[data-preset-result]").textContent = error.message; }
  });
  $("[data-preset-guess]").addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.roundId) return;
    try {
      const body = await gameFetch(`/api/game/draw/guess/${encodeURIComponent(state.roundId)}`, {
        method: "POST", body: JSON.stringify({ guesser: "user", content: new FormData(event.currentTarget).get("guess") })
      });
      $("[data-preset-result]").textContent = body.result === "猜对了"
        ? "猜对了，沉很开心。"
        : "还没猜中。";
    } catch (error) { $("[data-preset-result]").textContent = error.message; }
  });

  window.GameSpaceConfig = Object.freeze({ drawStart: "/api/game/draw/start", drawStatus: "/api/game/draw/status/:roundId", drawGuess: "/api/game/draw/guess/:roundId", protocol });
  resetGomoku();
  redraw();
  applyGameAvatars();
  preferenceStore?.subscribe?.(applyGameAvatars);
  window.addEventListener("pageshow", () => applyGameAvatars());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") applyGameAvatars();
  });
})();
