document.addEventListener("DOMContentLoaded", () => {
  const data = window.AppData;
  const store = window.AppStore;
  if (!data || !store) return;

  const { ai } = data;
  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };

  const renderDashboard = () => {
    const state = store.getState();
    const { memory, activities, stats } = state;

    setText(".dashboard-avatar__name", ai.avatar.label);
    setText("#companion-name", ai.name);
    setText(".companion-profile__copy > p", `此刻连接稳定，正在${ai.presence}`);

    const onlineLabel = document.querySelector(".online-label");
    if (onlineLabel) {
      const dot = onlineLabel.querySelector("span");
      onlineLabel.replaceChildren(dot, `当前${ai.status}`);
    }

    setText(".status-card--companion h3", ai.currentState);
    setText("[data-last-active]", activities[0]?.time || ai.lastActive);
    setText("[data-chat-count]", `${stats.chatCount} 次`);
    setText(".status-card--memory .memory-count strong", memory.count);
    setText(".status-card--memory .status-card__detail strong", memory.longTermStatus);

    const activityEntries = document.querySelectorAll(".activity-entry");
    activityEntries.forEach((entry, index) => {
      const activity = activities[index];
      if (!activity) {
        entry.hidden = true;
        return;
      }

      entry.hidden = false;
      entry.dataset.activityId = activity.id;
      entry.querySelector("strong").textContent = activity.title;
      entry.querySelector("p").textContent = activity.description;
      const time = entry.querySelector("time");
      time.textContent = activity.time;
      time.dateTime = activity.timestamp;
    });
  };

  const loadAiStatus = async () => {
    const output = document.querySelector("[data-ai-status]");
    try {
      const config = window.AppConfig?.getProviderConfig?.() || {};
      const base = String(config.baseUrl || "").replace(/\/+$/, "");
      const headers = config.auth?.type === "bearer" && config.auth.token ? { Authorization: `Bearer ${config.auth.token}` } : {};
      const call = async path => { const response = await fetch(base + path, { cache:"no-store", headers }); const value = await response.json(); if (!response.ok || value.error) throw new Error(value.error?.message || "请求失败"); return value; };
      const [automation, candidates, jobs] = await Promise.all([
        call("/api/v1/ai-automation/status"), call("/api/v1/memory-candidates?status=pending&limit=1"), call("/api/v1/ai-jobs?limit=1")
      ]);
      setText("[data-ai-pending]", candidates.meta.total);
      setText("[data-ai-enabled]", automation.data.automationEnabled ? "已启用" : "默认关闭");
      setText("[data-ai-job]", jobs.data[0] ? `${jobs.data[0].jobType} · ${jobs.data[0].status}` : "暂无任务");
      output.textContent = automation.data.automationEnabled ? "自动化已启用，请留意审核队列。" : "自动摘要与抽取关闭；可在聊天 Session 中手动触发。";
    } catch (error) { output.textContent = error.message; }
  };

  renderDashboard();
  loadAiStatus();
  window.addEventListener("storage", (event) => {
    if (event.key === store.key) renderDashboard();
  });
});
