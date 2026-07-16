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

  const basicAuthorization = (username, password) => {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    return `Basic ${btoa(String.fromCharCode(...bytes))}`;
  };

  const requestAdminCredentials = () => {
    const username = window.prompt("管理员账号");
    if (username === null) return null;
    const password = window.prompt("管理员密码");
    if (password === null) return null;
    return { Authorization: basicAuthorization(username, password) };
  };

  const loadAiMetrics = async () => {
    const output = document.querySelector("[data-ai-metrics-status]");
    const headers = requestAdminCredentials();
    if (!headers) return;
    output.textContent = "正在加载指标…";
    try {
      const config = window.AppConfig?.getProviderConfig?.() || {};
      const base = String(config.baseUrl || "").replace(/\/+$/, "");
      const response = await fetch(base + "/admin/ai/metrics", {
        cache: "no-store",
        headers
      });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error?.message || "指标请求失败");
      const metrics = value.data?.total || {};
      for (const key of ["totalJobs","completedJobs","failedJobs","promptTokens","completionTokens","totalTokens","averageLatencyMs"]) {
        setText(`[data-ai-metric="${key}"]`, Number(metrics[key] || 0).toLocaleString());
      }
      output.textContent = "指标已更新。管理员凭据未保存。";
    } catch (error) {
      output.textContent = error.message;
    }
  };

  const jobValue = value => value == null || value === "" ? "—" : String(value);
  const addJobField = (container, label, value) => {
    const field = document.createElement("div");
    const name = document.createElement("span");
    const content = document.createElement("strong");
    name.textContent = label;
    content.textContent = jobValue(value);
    field.append(name, content);
    container.append(field);
  };

  const jobDetailFields = [
    ["id","ID"],["jobType","任务类型"],["sessionId","Session ID"],["status","状态"],
    ["inputMessageCount","输入消息数"],["attemptCount","尝试次数"],["provider","Provider"],["model","模型"],
    ["promptTokens","Prompt Tokens"],["completionTokens","Completion Tokens"],["totalTokens","Total Tokens"],
    ["latencyMs","延迟（ms）"],["startedAt","开始时间"],["completedAt","完成时间"],
    ["errorCode","错误代码"],["errorMessage","错误信息"],["createdAt","创建时间"]
  ];

  const renderAiJobDetail = job => {
    const fields = document.querySelector("[data-ai-job-detail-fields]");
    fields.replaceChildren();
    for (const [key, label] of jobDetailFields) {
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = label;
      value.textContent = jobValue(job[key]);
      fields.append(term, value);
    }
  };

  const loadAiJobDetail = async id => {
    const dialog = document.querySelector("[data-ai-job-detail]");
    const output = document.querySelector("[data-ai-job-detail-status]");
    const headers = requestAdminCredentials();
    if (!headers) return;
    output.textContent = "正在加载 Job 详情…";
    dialog.showModal();
    try {
      const config = window.AppConfig?.getProviderConfig?.() || {};
      const base = String(config.baseUrl || "").replace(/\/+$/, "");
      const response = await fetch(base + `/admin/ai/jobs/${encodeURIComponent(id)}`, { cache: "no-store", headers });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error?.message || "Job 详情请求失败");
      renderAiJobDetail(value.data || {});
      output.textContent = "Job 详情已加载。";
    } catch (error) {
      output.textContent = error.message;
    }
  };

  const renderAiJobs = jobs => {
    const list = document.querySelector("[data-ai-jobs-list]");
    list.replaceChildren();
    if (!jobs.length) {
      const empty = document.createElement("article");
      empty.className = "status-card";
      const text = document.createElement("h3");
      text.textContent = "暂无 AI Job";
      empty.append(text);
      list.append(empty);
      return;
    }
    for (const job of jobs) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "status-card";
      card.setAttribute("aria-label", `查看 ${jobValue(job.jobType)} Job 详情`);
      card.addEventListener("click", () => loadAiJobDetail(job.id));
      const label = document.createElement("p");
      label.className = "status-card__label";
      label.textContent = jobValue(job.jobType);
      const title = document.createElement("h3");
      title.textContent = jobValue(job.status);
      const detail = document.createElement("div");
      detail.className = "status-card__detail";
      addJobField(detail, "模型", job.model);
      addJobField(detail, "Total Tokens", job.totalTokens);
      addJobField(detail, "延迟", job.latencyMs == null ? null : `${job.latencyMs} ms`);
      addJobField(detail, "创建时间", job.createdAt);
      addJobField(detail, "错误代码", job.errorCode);
      card.append(label, title, detail);
      list.append(card);
    }
  };

  const loadAiJobs = async () => {
    const output = document.querySelector("[data-ai-jobs-status]");
    const headers = requestAdminCredentials();
    if (!headers) return;
    output.textContent = "正在加载任务…";
    try {
      const config = window.AppConfig?.getProviderConfig?.() || {};
      const base = String(config.baseUrl || "").replace(/\/+$/, "");
      const response = await fetch(base + "/admin/ai/jobs?limit=6", { cache: "no-store", headers });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error?.message || "任务请求失败");
      renderAiJobs(Array.isArray(value.data) ? value.data : []);
      output.textContent = `已加载 ${Array.isArray(value.data) ? value.data.length : 0} 条最近任务。`;
    } catch (error) {
      output.textContent = error.message;
    }
  };

  renderDashboard();
  loadAiStatus();
  document.querySelector("[data-ai-metrics-load]")?.addEventListener("click", loadAiMetrics);
  document.querySelector("[data-ai-jobs-load]")?.addEventListener("click", loadAiJobs);
  document.querySelector("[data-ai-job-detail-close]")?.addEventListener("click", () => {
    document.querySelector("[data-ai-job-detail]")?.close();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === store.key) renderDashboard();
  });
});
