"use strict";

(() => {
  const GAME_EVENTS_API = "/api/game/events";
  const eventOptions = [
    "和沉一起看星星",
    "整理小屋",
    "喝下午茶",
    "在晚风里散步"
  ];
  const moodReplies = {
    开心: "看到你今天有一点开心，沉也会跟着轻轻笑起来。",
    平静: "平静很好。我们就让这一刻慢一点，再慢一点。",
    疲惫: "辛苦了。先在小屋里坐一会儿，什么都不做也可以。",
    低落: "沉会留在这里。不必马上好起来，我们慢慢陪着这份感受。"
  };
  const state = {
    target: 0,
    guesses: 0,
    mood: null,
    event: null
  };

  const select = selector => document.querySelector(selector);
  const setText = (selector, value) => {
    const element = select(selector);
    if (element) element.textContent = value;
  };
  const randomNumber = maximum => Math.floor(Math.random() * maximum) + 1;
  const sendGameEvent = async ({ eventType, title, metadata }) => {
    try {
      const config = window.AppConfig?.getProviderConfig?.();
      const baseUrl = String(config?.baseUrl || "").replace(/\/+$/, "");
      const token = config?.auth?.type === "bearer" ? String(config.auth.token || "") : "";
      if (!baseUrl || !token) return false;
      const response = await fetch(`${baseUrl}${GAME_EVENTS_API}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ eventType, title, metadata })
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const resetNumberGame = () => {
    state.target = randomNumber(100);
    state.guesses = 0;
    const input = select("#guess-number");
    if (input) input.value = "";
    setText("[data-guess-result]", "沉已经想好啦，猜猜看。");
    setText("[data-record-guess]", "还没有开始");
  };

  const updateDate = () => {
    const target = select("[data-current-date]");
    if (!target) return;
    const now = new Date();
    target.dateTime = now.toISOString().slice(0, 10);
    target.textContent = new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(now);
  };

  select("[data-guess-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    const input = select("#guess-number");
    const guess = Number(input?.value);
    if (!Number.isInteger(guess) || guess < 1 || guess > 100) {
      setText("[data-guess-result]", "请输入 1 到 100 之间的整数。");
      return;
    }
    state.guesses++;
    const result = guess === state.target ? "猜中了" : guess > state.target ? "大了" : "小了";
    setText("[data-guess-result]", result === "猜中了"
      ? `猜中了！你用了 ${state.guesses} 次。`
      : `${result}，再试一次吧。`);
    setText("[data-record-guess]", result === "猜中了"
      ? `${state.guesses} 次猜中`
      : `已猜 ${state.guesses} 次`);
    if (result === "猜中了") {
      void sendGameEvent({
        eventType: "mini_game_completed",
        title: "完成猜数字",
        metadata: { gameName: "guess_number", attempts: state.guesses }
      });
    }
  });

  select("[data-new-number]")?.addEventListener("click", resetNumberGame);

  select("[data-mood-options]")?.addEventListener("click", event => {
    const button = event.target.closest("[data-mood]");
    if (!button) return;
    state.mood = button.dataset.mood;
    document.querySelectorAll("[data-mood]").forEach(item => {
      item.classList.toggle("is-selected", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    setText("[data-mood-result]", moodReplies[state.mood]);
    setText("[data-record-mood]", state.mood);
    setText("[data-companion-line]", moodReplies[state.mood]);
    void sendGameEvent({
      eventType: "mood_selected",
      title: "选择今日心情",
      metadata: { mood: state.mood }
    });
  });

  select("[data-random-event]")?.addEventListener("click", () => {
    state.event = eventOptions[randomNumber(eventOptions.length) - 1];
    setText("[data-event-result]", state.event);
    setText("[data-record-event]", state.event);
    void sendGameEvent({
      eventType: "room_interaction",
      title: state.event,
      metadata: { interaction: state.event }
    });
  });

  document.querySelectorAll("[data-show-panel]").forEach(button => {
    button.addEventListener("click", () => {
      const panelName = button.dataset.showPanel;
      document.querySelectorAll("[data-panel]").forEach(panel => {
        panel.hidden = panel.dataset.panel !== panelName;
      });
      document.querySelectorAll("[data-show-panel]").forEach(item => {
        item.classList.toggle("is-active", item === button);
      });
      select(`[data-panel="${panelName}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  window.GameSpaceConfig = Object.freeze({
    eventsApi: GAME_EVENTS_API,
    mode: "event-api-best-effort"
  });

  updateDate();
  resetNumberGame();
})();
