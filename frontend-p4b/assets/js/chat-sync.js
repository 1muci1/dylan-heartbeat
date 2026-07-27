// Chat Sync v1：服务器 Session 是事实源，IndexedDB 是每台设备的离线缓存。
((root, factory) => {
  const exports = factory();
  if (typeof module === "object" && module.exports) module.exports = exports;
  if (root) root.CompanionChatSync = exports;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const chooseServerSession = (sessions, serverSessionId) => {
    if (!Array.isArray(sessions)) return null;
    return sessions.find(session => session.id === serverSessionId) || sessions[0] || null;
  };

  const lastServerMessageId = messages => {
    const ids = (Array.isArray(messages) ? messages : [])
      .map(message => Number(message?.id))
      .filter(id => Number.isSafeInteger(id) && id > 0);
    return ids.length ? Math.max(...ids) : null;
  };

  class ChatSyncController {
    #historyStore;
    #sessionApi;
    #localSessionId;
    #mapMessage;
    #clock;
    #serverSessionId;

    constructor(options = {}) {
      this.#historyStore = options.historyStore;
      this.#sessionApi = options.sessionApi;
      this.#localSessionId = options.localSessionId;
      this.#mapMessage = options.mapMessage || (message => message);
      this.#clock = options.clock || (() => new Date());
      if (!this.#historyStore || !this.#sessionApi || !this.#localSessionId) {
        throw new TypeError("Chat sync dependencies are required");
      }
    }

    get serverSessionId() {
      return this.#serverSessionId || "";
    }

    async connect() {
      const local = await this.#historyStore.loadSession(this.#localSessionId);
      if (!local) throw new Error("Local chat session not found");
      const sessions = await this.#sessionApi.list();
      let selected = chooseServerSession(sessions, local.serverSessionId);
      const available = [...sessions];
      if (!selected) {
        selected = await this.#sessionApi.create(local.title || "新会话");
        available.unshift(selected);
      }
      const snapshot = await this.select(selected.id);
      return { ...snapshot, sessions: available, selected };
    }

    async select(serverSessionId) {
      const id = String(serverSessionId || "").trim();
      if (!id) throw new TypeError("serverSessionId is required");
      this.#serverSessionId = id;
      await this.#historyStore.updateSyncState(this.#localSessionId, {
        serverSessionId: id,
        syncState: "syncing"
      });
      return this.pull();
    }

    async pull() {
      if (!this.#serverSessionId) throw new Error("Server chat session is not connected");
      try {
        const serverMessages = await this.#sessionApi.messages(this.#serverSessionId);
        const messages = serverMessages.map(this.#mapMessage).filter(Boolean);
        await this.#historyStore.saveMessages(this.#localSessionId, messages);
        await this.#historyStore.updateSyncState(this.#localSessionId, {
          serverSessionId: this.#serverSessionId,
          lastServerMessageId: lastServerMessageId(serverMessages),
          lastSyncedAt: this.#clock().toISOString(),
          syncState: "synced"
        });
        return {
          serverSessionId: this.#serverSessionId,
          serverMessages,
          messages
        };
      } catch (error) {
        await this.#historyStore.updateSyncState(this.#localSessionId, {
          serverSessionId: this.#serverSessionId,
          syncState: "stale"
        }).catch(() => {});
        throw error;
      }
    }
  }

  return { ChatSyncController, chooseServerSession, lastServerMessageId };
});
