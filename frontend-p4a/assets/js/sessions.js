// 服务器会话 API。任何请求失败都由聊天页降级到原有 localStorage 模式。
(() => {
  const ACTIVE_SESSION_KEY = "xinban-active-session-v1";

  const getConfig = () => window.AppConfig?.getProviderConfig?.() || {};
  const apiUrl = (pathname) => {
    const baseUrl = String(getConfig().baseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) throw new Error("尚未配置服务器地址");
    return `${baseUrl}${pathname}`;
  };
  const headers = (withJson = false) => {
    const config = getConfig();
    const result = {};
    if (withJson) result["Content-Type"] = "application/json";
    if (config.auth?.type === "bearer" && config.auth.token) {
      result.Authorization = `Bearer ${config.auth.token}`;
    }
    return result;
  };

  const request = async (pathname, options = {}) => {
    const response = await fetch(apiUrl(pathname), {
      cache: "no-store",
      ...options,
      headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) }
    });
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch {}
      throw new Error(payload?.error?.message || `Session API 请求失败（${response.status}）`);
    }
    return response.status === 204 ? null : response.json();
  };

  const list = async () => (await request("/api/v1/chat/sessions")).sessions;
  const create = async (title) => (await request("/api/v1/chat/sessions", {
    method: "POST",
    body: JSON.stringify({ title })
  })).session;
  const rename = async (id, title) => (await request(`/api/v1/chat/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  })).session;
  const remove = async id => request(`/api/v1/chat/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  const messages = async id => {
    const collected = [];
    let before = null;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (before) query.set("before", before);
      const page = await request(`/api/v1/chat/sessions/${encodeURIComponent(id)}/messages?${query}`);
      collected.unshift(...page.messages);
      before = page.hasMore ? page.nextCursor : null;
    } while (before);
    return collected;
  };

  const getActiveId = () => {
    try { return localStorage.getItem(ACTIVE_SESSION_KEY) || ""; } catch { return ""; }
  };
  const setActiveId = id => {
    try {
      if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id);
      else localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {}
  };

  window.AppSessions = Object.freeze({ list, create, rename, remove, messages, getActiveId, setActiveId });
})();
