document.addEventListener("DOMContentLoaded", () => {
  const data = window.AppData;
  if (!data) return;

  const { ai, today } = data;
  const state = window.AppStore?.getState();
  const memory = state?.memory || data.memory;
  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };

  setText(".home-header h1", `此刻，和${ai.name}待一会儿`);
  setText(".companion-portrait__name", ai.avatar.label);
  setText("#companion-name", ai.name);
  setText(".companion-hero__identity > p", `“${ai.greeting}”`);

  const onlinePill = document.querySelector(".online-pill");
  if (onlinePill) {
    const dot = onlinePill.querySelector("span");
    onlinePill.replaceChildren(dot, `${ai.status} · 正在陪伴你`);
  }

  setText(".home-section-heading > span", today.dateLabel);
  setText(".today-card__copy span", today.label);
  setText(".today-card__copy h3", today.title);
  setText(".today-card__copy p", today.message);
  setText(".today-card__meter small", today.mood);

  const routes = {
    ".action-card--chat": "chat.html",
    ".action-card--memory": "dashboard.html",
    ".action-card--status": "dashboard.html"
  };
  Object.entries(routes).forEach(([selector, href]) => {
    document.querySelector(selector)?.setAttribute("href", href);
  });

  setText(".action-card--chat small", `${ai.name}在这里，听你慢慢说`);
  setText(".action-card--memory small", `已收藏 ${memory.count} 条片段`);
  setText(".action-card--status small", `${ai.name}正在${ai.presence}`);
});
