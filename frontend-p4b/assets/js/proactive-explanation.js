"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("[data-explanation-form]");
  const input = form?.elements.deliveryId;
  const submit = document.querySelector("[data-explanation-submit]");
  const notice = document.querySelector("[data-explanation-notice]");
  const noticeTitle = document.querySelector("[data-explanation-notice-title]");
  const noticeMessage = document.querySelector("[data-explanation-notice-message]");
  const settingsLink = document.querySelector("[data-explanation-settings]");
  const result = document.querySelector("[data-explanation-result]");
  const summary = document.querySelector("[data-explanation-summary]");
  const shownId = document.querySelector("[data-explanation-id]");
  const sections = document.querySelector("[data-explanation-sections]");
  if (!form || !input || !submit || !notice || !noticeTitle || !noticeMessage || !settingsLink || !result || !summary || !shownId || !sections) return;

  const summaryLabels = Object.freeze({
    DELIVERY_PENDING: "等待发送",
    DELIVERY_SENDING: "发送中",
    DELIVERY_SENT: "已发送",
    DELIVERY_FAILED: "发送失败",
    DELIVERY_CANCELLED: "已取消"
  });

  const text = (value, nullable = false) => {
    if (nullable && value == null) return null;
    if (typeof value !== "string" || !value) throw new Error("INVALID_EXPLANATION");
    return value;
  };

  const timestamp = (value, nullable = false) => {
    const normalized = text(value, nullable);
    if (normalized !== null && Number.isNaN(Date.parse(normalized))) throw new Error("INVALID_EXPLANATION");
    return normalized;
  };

  const object = value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_EXPLANATION");
    return value;
  };

  const unavailableFact = (value, fields) => {
    const item = object(value);
    if (typeof item.available !== "boolean") throw new Error("INVALID_EXPLANATION");
    if (!item.available) return Object.freeze({ available: false });
    const safe = { available: true };
    for (const [name, kind] of fields) safe[name] = kind === "timestamp" ? timestamp(item[name]) : text(item[name]);
    return Object.freeze(safe);
  };

  const whitelistExplanation = value => {
    const item = object(value);
    const delivery = object(item.delivery);
    const summaryLabel = summaryLabels[item.summaryCode];
    if (!summaryLabel || typeof delivery.status !== "string" || !delivery.status) throw new Error("INVALID_EXPLANATION");
    if (!Number.isSafeInteger(delivery.attemptCount) || delivery.attemptCount < 0) throw new Error("INVALID_EXPLANATION");
    const feedback = item.feedback == null ? null : object(item.feedback);
    return Object.freeze({
      deliveryId: text(item.deliveryId),
      summaryLabel,
      delivery: Object.freeze({
        status: text(delivery.status),
        channel: text(delivery.channel),
        reasonCode: text(delivery.reasonCode),
        attemptCount: delivery.attemptCount,
        createdAt: timestamp(delivery.createdAt),
        sentAt: timestamp(delivery.sentAt, true),
        failedAt: timestamp(delivery.failedAt, true),
        lastErrorCode: text(delivery.lastErrorCode, true)
      }),
      aiJob: unavailableFact(item.aiJob, [["id", "text"], ["status", "text"]]),
      triggerEvent: unavailableFact(item.triggerEvent, [["eventType", "text"], ["occurredAt", "timestamp"]]),
      wakeDecision: unavailableFact(item.wakeDecision, [["decision", "text"], ["reasonCode", "text"]]),
      feedback: feedback ? Object.freeze({
        feedbackType: text(feedback.feedbackType),
        createdAt: timestamp(feedback.createdAt)
      }) : null
    });
  };

  const displayValue = value => value == null ? "无记录" : String(value);
  const displayTime = value => value == null ? "无记录" : new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium", timeStyle: "medium"
  }).format(new Date(value));

  const addField = (list, label, value) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = displayValue(value);
    row.append(term, detail);
    list.append(row);
  };

  const addCard = (title, fields, unavailable = false) => {
    const card = document.createElement("article");
    card.className = "explanation-card";
    const heading = document.createElement("h3");
    heading.textContent = title;
    card.append(heading);
    if (unavailable) {
      const message = document.createElement("p");
      message.className = "explanation-unavailable";
      message.textContent = "暂无可用关联。当前没有可证明的关联事实。";
      card.append(message);
    } else {
      const list = document.createElement("dl");
      for (const [label, value] of fields) addField(list, label, value);
      card.append(list);
    }
    sections.append(card);
  };

  const clearResult = () => {
    result.hidden = true;
    summary.textContent = "";
    shownId.textContent = "";
    sections.replaceChildren();
  };

  const showNotice = (title, message, kind = "status", showSettings = false) => {
    notice.hidden = false;
    notice.dataset.kind = kind;
    noticeTitle.textContent = title;
    noticeMessage.textContent = message;
    settingsLink.hidden = !showSettings;
  };

  const render = explanation => {
    clearResult();
    summary.textContent = explanation.summaryLabel;
    shownId.textContent = explanation.deliveryId;
    addCard("Delivery", [
      ["状态", explanation.delivery.status],
      ["渠道", explanation.delivery.channel],
      ["原因代码", explanation.delivery.reasonCode],
      ["尝试次数", explanation.delivery.attemptCount],
      ["创建时间", displayTime(explanation.delivery.createdAt)],
      ["发送时间", displayTime(explanation.delivery.sentAt)],
      ["失败时间", displayTime(explanation.delivery.failedAt)],
      ["最后错误代码", explanation.delivery.lastErrorCode]
    ]);
    addCard("AI Job", explanation.aiJob.available ? [
      ["Job ID", explanation.aiJob.id], ["状态", explanation.aiJob.status]
    ] : [], !explanation.aiJob.available);
    addCard("Trigger Event", explanation.triggerEvent.available ? [
      ["事件类型", explanation.triggerEvent.eventType],
      ["发生时间", displayTime(explanation.triggerEvent.occurredAt)]
    ] : [], !explanation.triggerEvent.available);
    addCard("Wake Decision", explanation.wakeDecision.available ? [
      ["决策", explanation.wakeDecision.decision], ["原因代码", explanation.wakeDecision.reasonCode]
    ] : [], !explanation.wakeDecision.available);
    addCard("Feedback", explanation.feedback ? [
      ["反馈类型", explanation.feedback.feedbackType],
      ["反馈时间", displayTime(explanation.feedback.createdAt)]
    ] : [["状态", "尚无明确反馈"]]);
    notice.hidden = true;
    result.hidden = false;
  };

  const requestExplanation = async deliveryId => {
    const config = window.AppConfig?.getProviderConfig?.() || {};
    const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
    const token = String(config.auth?.token || "");
    if (!baseUrl || config.auth?.type !== "bearer" || !token) {
      showNotice("尚未配置连接", "请先在设置页保存 Gateway 地址和 Bearer Token。", "error", true);
      return;
    }

    submit.disabled = true;
    showNotice("正在加载解释", "正在执行一次只读查询。", "status");
    try {
      const response = await fetch(`${baseUrl}/api/v1/proactive/explanations/${encodeURIComponent(deliveryId)}`, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
      });
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      if (response.status === 404 || payload?.error?.code === "DELIVERY_NOT_FOUND") {
        showNotice("未找到该 Delivery", "请检查 Delivery ID 后重新查询。", "error");
        return;
      }
      if (response.status === 401 || response.status === 403 || payload?.error?.code === "UNAUTHORIZED") {
        showNotice("Gateway 认证失败", "请检查现有连接设置。", "error", true);
        return;
      }
      if (!response.ok || payload?.error || payload == null) {
        showNotice("Explanation 暂时不可用", "请稍后重新加载。", "error");
        return;
      }
      render(whitelistExplanation(payload));
    } catch {
      showNotice("Explanation 暂时不可用", "请稍后重新加载。", "error");
    } finally {
      submit.disabled = false;
    }
  };

  const deepLinkId = new URLSearchParams(window.location.search).get("deliveryId");
  if (deepLinkId) {
    const normalizedDeepLinkId = deepLinkId.trim();
    if (normalizedDeepLinkId.length <= 200) input.value = normalizedDeepLinkId;
    else showNotice("Delivery ID 无效", "请输入 1 至 200 个字符的 Delivery ID。", "error");
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    clearResult();
    const deliveryId = String(input.value || "").trim();
    if (!deliveryId || deliveryId.length > 200) {
      showNotice("Delivery ID 无效", "请输入 1 至 200 个字符的 Delivery ID。", "error");
      return;
    }
    requestExplanation(deliveryId);
  });
});
