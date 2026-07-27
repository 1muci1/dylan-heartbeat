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
      this.#historyStore = options.historyStore || null;
      this.#sessionApi = options.sessionApi;
      this.#localSessionId = String(options.localSessionId || "").trim();
      this.#mapMessage = options.mapMessage || (message => message);
      this.#clock = options.clock || (() => new Date());
      if (!this.#sessionApi) throw new TypeError("Chat session API is required");
    }

    get serverSessionId() {
      return this.#serverSessionId || "";
    }

    async #updateLocalSyncState(changes) {
      if (!this.#historyStore || !this.#localSessionId) return null;
      try {
        await this.#historyStore.updateSyncState(this.#localSessionId, changes);
        return null;
      } catch (error) {
        return error;
      }
    }

    async ensureServerSession() {
      let local = null;
      let cacheError = null;
      if (this.#historyStore && this.#localSessionId) {
        try {
          local = await this.#historyStore.loadSession(this.#localSessionId);
        } catch (error) {
          cacheError = error;
        }
      }
      const sessions = await this.#sessionApi.list();
      let selected = chooseServerSession(
        sessions,
        this.#serverSessionId || local?.serverSessionId
      );
      const available = [...sessions];
      if (!selected) {
        selected = await this.#sessionApi.create(local?.title || "新会话");
        available.unshift(selected);
      }
      this.#serverSessionId = selected.id;
      const updateError = await this.#updateLocalSyncState({
        serverSessionId: selected.id,
        syncState: "syncing"
      });
      return {
        serverSessionId: selected.id,
        sessions: available,
        selected,
        cacheAvailable: Boolean(this.#historyStore && this.#localSessionId && !cacheError && !updateError),
        cacheError: cacheError || updateError
      };
    }

    async connect() {
      const ensured = await this.ensureServerSession();
      const snapshot = await this.pull();
      return {
        ...snapshot,
        sessions: ensured.sessions,
        selected: ensured.selected,
        cacheAvailable: ensured.cacheAvailable && snapshot.cacheAvailable,
        cacheError: ensured.cacheError || snapshot.cacheError
      };
    }

    async select(serverSessionId) {
      const id = String(serverSessionId || "").trim();
      if (!id) throw new TypeError("serverSessionId is required");
      this.#serverSessionId = id;
      const cacheError = await this.#updateLocalSyncState({
        serverSessionId: id,
        syncState: "syncing"
      });
      const snapshot = await this.pull();
      return {
        ...snapshot,
        cacheAvailable: !cacheError && snapshot.cacheAvailable,
        cacheError: cacheError || snapshot.cacheError
      };
    }

    async pull() {
      if (!this.#serverSessionId) throw new Error("Server chat session is not connected");
      try {
        const serverMessages = await this.#sessionApi.messages(this.#serverSessionId);
        const messages = serverMessages.map(this.#mapMessage).filter(Boolean);
        let cacheError = null;
        if (this.#historyStore && this.#localSessionId) {
          try {
            await this.#historyStore.saveMessages(this.#localSessionId, messages);
            cacheError = await this.#updateLocalSyncState({
              serverSessionId: this.#serverSessionId,
              lastServerMessageId: lastServerMessageId(serverMessages),
              lastSyncedAt: this.#clock().toISOString(),
              syncState: "synced"
            });
          } catch (error) {
            cacheError = error;
          }
        }
        return {
          serverSessionId: this.#serverSessionId,
          serverMessages,
          messages,
          cacheAvailable: Boolean(this.#historyStore && this.#localSessionId && !cacheError),
          cacheError
        };
      } catch (error) {
        await this.#updateLocalSyncState({
          serverSessionId: this.#serverSessionId,
          syncState: "stale"
        });
        throw error;
      }
    }
  }

  return { ChatSyncController, chooseServerSession, lastServerMessageId };
});
