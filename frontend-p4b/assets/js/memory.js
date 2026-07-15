document.addEventListener("DOMContentLoaded", () => {
  const configStore = window.AppConfig;
  const listElement = document.querySelector("[data-memory-list]");
  const filterForm = document.querySelector(".memory-filters");
  const errorElement = document.querySelector("[data-memory-error]");
  const emptyElement = document.querySelector("[data-memory-empty]");
  const moreButton = document.querySelector("[data-load-more]");
  const editDialog = document.querySelector("[data-memory-dialog]");
  const memoryForm = document.querySelector("[data-memory-form]");
  const detailDialog = document.querySelector("[data-detail-dialog]");
  if (!configStore || !listElement || !filterForm || !editDialog || !memoryForm || !detailDialog) return;

  const typeLabels = { MEMORY: "记忆", EVENT: "事件", MOMENT: "Moment", PROMISE: "约定", WISHLIST: "愿望", NOTE: "笔记" };
  let page = 1;
  let totalPages = 1;
  let currentDetail = null;

  const config = () => configStore.getProviderConfig();
  const request = async (pathname, options = {}) => {
    const provider = config();
    const baseUrl = String(provider.baseUrl || "").replace(/\/+$/, "");
    const token = String(provider.auth?.token || "");
    if (!baseUrl || !token) throw new Error("记忆库 API 尚未配置，请先在设置页保存 Gateway 地址和 Bearer Token。");
    const response = await fetch(`${baseUrl}${pathname}`, {
      cache: "no-store",
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
    return payload;
  };

  const showError = message => {
    errorElement.textContent = message || "";
    errorElement.hidden = !message;
  };
  const displayDate = value => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "未设置日期";

  const createCard = item => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "memory-card";
    const top = document.createElement("div");
    top.className = "memory-card__top";
    const type = document.createElement("span");
    type.className = "memory-card__type";
    type.textContent = typeLabels[item.type] || item.type;
    const time = document.createElement("time");
    time.textContent = displayDate(item.occurredAt || item.createdAt);
    top.append(type, time);
    const title = document.createElement("h2");
    title.textContent = item.title || item.content.slice(0, 36);
    const content = document.createElement("p");
    content.textContent = item.content;
    const meta = document.createElement("div");
    meta.className = "memory-card__meta";
    const importance = document.createElement("span");
    importance.textContent = `重要度 ${item.importance}`;
    const status = document.createElement("span");
    status.textContent = item.deletedAt ? "已删除" : item.status;
    meta.append(importance, status);
    card.append(top, title, content, meta);
    card.addEventListener("click", () => openDetail(item.id, Boolean(item.deletedAt)));
    return card;
  };

  const queryString = () => {
    const form = new FormData(filterForm);
    const query = new URLSearchParams({ page: String(page), limit: "12", sort: "newest" });
    for (const key of ["keyword", "type", "status", "dateFrom", "dateTo"]) {
      const value = String(form.get(key) || "").trim();
      if (value) query.set(key, value);
    }
    return query;
  };

  const loadStats = async () => {
    const payload = await request("/api/v1/memories/stats");
    document.querySelector("[data-memory-total]").textContent = payload.data.total;
    document.querySelector("[data-moment-total]").textContent = payload.data.byType.MOMENT || 0;
    document.querySelector("[data-deleted-total]").textContent = payload.data.deleted;
  };

  const loadMemories = async (append = false) => {
    showError("");
    moreButton.disabled = true;
    try {
      const payload = await request(`/api/v1/memories?${queryString()}`);
      if (!append) listElement.replaceChildren();
      payload.data.forEach(item => listElement.append(createCard(item)));
      totalPages = payload.meta.totalPages;
      emptyElement.hidden = listElement.children.length > 0;
      moreButton.hidden = page >= totalPages;
      await loadStats();
    } catch (error) {
      showError(error.message);
      if (!append) listElement.replaceChildren();
      emptyElement.hidden = true;
      moreButton.hidden = true;
    } finally { moreButton.disabled = false; }
  };

  const openEditor = item => {
    memoryForm.reset();
    memoryForm.elements.id.value = item?.id || "";
    memoryForm.elements.type.value = item?.type || "MEMORY";
    memoryForm.elements.title.value = item?.title || "";
    memoryForm.elements.content.value = item?.content || "";
    memoryForm.elements.importance.value = item?.importance || 3;
    memoryForm.elements.occurredAt.value = item?.occurredAt ? item.occurredAt.slice(0, 16) : "";
    document.querySelector("[data-dialog-title]").textContent = item ? "编辑记忆" : "新建记忆";
    editDialog.showModal();
  };

  const renderComments = comments => {
    const target = document.querySelector("[data-comment-list]");
    target.replaceChildren();
    comments.forEach(comment => {
      const row = document.createElement("article");
      row.className = "memory-comment";
      const content = document.createElement("p");
      content.textContent = comment.content;
      const author = document.createElement("small");
      author.textContent = `${comment.author || "我"} · ${displayDate(comment.createdAt)}`;
      const actions = document.createElement("div");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "编辑";
      edit.addEventListener("click", async () => {
        const next = window.prompt("修改评论", comment.content)?.trim();
        if (!next || next === comment.content) return;
        try {
          await request(`/api/v1/memories/${currentDetail.id}/comments/${comment.id}`, { method: "PATCH", body: JSON.stringify({ content: next }) });
          await loadComments();
        } catch (error) { showError(error.message); }
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除";
      remove.addEventListener("click", async () => {
        if (!window.confirm("删除这条评论？")) return;
        try {
          await request(`/api/v1/memories/${currentDetail.id}/comments/${comment.id}`, { method: "DELETE" });
          await loadComments();
        } catch (error) { showError(error.message); }
      });
      actions.append(edit, remove);
      row.append(content, author, actions);
      target.append(row);
    });
  };

  async function loadComments() {
    const payload = await request(`/api/v1/memories/${currentDetail.id}/comments`);
    renderComments(payload.data);
  }

  async function openDetail(id, includeDeleted = false) {
    showError("");
    try {
      const payload = await request(`/api/v1/memories/${id}${includeDeleted ? "?includeDeleted=true" : ""}`);
      currentDetail = payload.data;
      document.querySelector("[data-detail-title]").textContent = currentDetail.title || typeLabels[currentDetail.type];
      const body = document.querySelector("[data-detail-body]");
      body.replaceChildren();
      const meta = document.createElement("div");
      meta.className = "memory-detail__meta";
      meta.textContent = `${typeLabels[currentDetail.type]} · 重要度 ${currentDetail.importance} · ${displayDate(currentDetail.occurredAt || currentDetail.createdAt)}`;
      const content = document.createElement("p");
      content.className = "memory-detail__content";
      content.textContent = currentDetail.content;
      body.append(meta, content);
      const actions = document.querySelector("[data-detail-actions]");
      actions.replaceChildren();
      if (currentDetail.deletedAt) {
        const restore = document.createElement("button");
        restore.type = "button";
        restore.textContent = "恢复记忆";
        restore.addEventListener("click", async () => {
          try { await request(`/api/v1/memories/${id}/restore`, { method: "POST" }); detailDialog.close(); page = 1; await loadMemories(); }
          catch (error) { showError(error.message); }
        });
        actions.append(restore);
      } else {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "编辑";
        edit.addEventListener("click", () => { detailDialog.close(); openEditor(currentDetail); });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "删除";
        remove.addEventListener("click", async () => {
          if (!window.confirm("将这条记忆移入回收站？")) return;
          try { await request(`/api/v1/memories/${id}`, { method: "DELETE" }); detailDialog.close(); page = 1; await loadMemories(); }
          catch (error) { showError(error.message); }
        });
        actions.append(edit, remove);
      }
      await loadComments();
      detailDialog.showModal();
    } catch (error) { showError(error.message); }
  }

  memoryForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(memoryForm);
    const id = String(data.get("id") || "");
    const rawDate = String(data.get("occurredAt") || "");
    const body = {
      type: data.get("type"), title: data.get("title"), content: data.get("content"),
      importance: Number(data.get("importance")), occurredAt: rawDate ? new Date(rawDate).toISOString() : null
    };
    try {
      await request(id ? `/api/v1/memories/${id}` : "/api/v1/memories", {
        method: id ? "PATCH" : "POST", body: JSON.stringify(body)
      });
      editDialog.close();
      page = 1;
      await loadMemories();
    } catch (error) { showError(error.message); }
  });

  document.querySelector("[data-comment-form]").addEventListener("submit", async event => {
    event.preventDefault();
    const input = event.currentTarget.elements.content;
    try {
      await request(`/api/v1/memories/${currentDetail.id}/comments`, { method: "POST", body: JSON.stringify({ author: "我", content: input.value }) });
      input.value = "";
      await loadComments();
    } catch (error) { showError(error.message); }
  });

  filterForm.addEventListener("submit", event => { event.preventDefault(); page = 1; loadMemories(); });
  filterForm.addEventListener("reset", () => setTimeout(() => { page = 1; loadMemories(); }, 0));
  document.querySelector("[data-moments-only]").addEventListener("click", () => {
    filterForm.elements.type.value = "MOMENT";
    filterForm.elements.status.value = "active";
    page = 1;
    loadMemories();
  });
  document.querySelector("[data-create-memory]").addEventListener("click", () => openEditor(null));
  document.querySelector("[data-close-detail]").addEventListener("click", () => detailDialog.close());
  moreButton.addEventListener("click", () => { if (page < totalPages) { page++; loadMemories(true); } });
  loadMemories().then(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) openDetail(id);
  });
});
