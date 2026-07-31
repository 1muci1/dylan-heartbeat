// 浏览器本地聊天历史。只保存会话和消息白名单字段，不读取或存储 Provider 配置。
((root, factory) => {
  const exports = factory();
  if (typeof module === "object" && module.exports) module.exports = exports;
  if (root) root.ChatHistoryStore = exports.ChatHistoryStore;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const DB_NAME = "xinban-chat-history";
  const DB_VERSION = 1;
  const SESSION_STORE = "sessions";
  const VALID_ROLES = new Set(["system", "user", "assistant"]);
  const SYNC_STATES = new Set(["local-only", "syncing", "synced", "stale"]);

  const clone = value => {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };

  const cleanAttachment = value => {
    if (!value || typeof value !== "object") return null;
    const attachment = {
      id: String(value.id || ""),
      url: String(value.url || ""),
      mimeType: String(value.mimeType || value.type || ""),
      name: String(value.name || "")
    };
    return attachment.url ? attachment : null;
  };

  const cleanSticker = value => {
    if (!value || typeof value !== "object") return null;
    const sticker = {
      id: String(value.id || ""),
      url: String(value.url || ""),
      label: String(value.label || ""),
      description: String(value.description || ""),
      tags: String(value.tags || "")
    };
    return sticker.id || sticker.url ? sticker : null;
  };

  const cleanFile = value => {
    if (!value || typeof value !== "object" || !value.fileId) return null;
    return {
      fileId: String(value.fileId),
      name: String(value.name || ""),
      mime: String(value.mime || ""),
      size: Number(value.size) || 0,
      kind: String(value.kind || ""),
      canUseInChat: value.canUseInChat === true,
      extractedTextPreview: String(value.extractedTextPreview || "").slice(0, 500),
      extractedTextLength: Number(value.extractedTextLength) || 0
    };
  };

  const cleanMessage = value => {
    if (!value || !VALID_ROLES.has(value.role)) return null;
    const content = String(value.content || "").trim();
    const stickers = Array.isArray(value.stickers)
      ? value.stickers.map(cleanSticker).filter(Boolean).slice(0, 2)
      : [];
    const legacySticker = cleanSticker(value.sticker);
    if (!content && !legacySticker && !stickers.length) return null;
    const message = {
      id: String(value.id || ""),
      role: value.role,
      content,
      time: String(value.time || ""),
      timestamp: String(value.timestamp || ""),
      type: String(value.type || "text")
    };
    if (value.thinking) message.thinking = String(value.thinking);
    const attachments = Array.isArray(value.attachments)
      ? value.attachments.map(cleanAttachment).filter(Boolean)
      : [];
    if (attachments.length) message.attachments = attachments;
    const files = Array.isArray(value.files) ? value.files.map(cleanFile).filter(Boolean) : [];
    if (files.length) message.files = files;
    if (legacySticker) message.sticker = legacySticker;
    if (stickers.length) message.stickers = stickers;
    return message;
  };

  const requestResult = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });

  class ChatHistoryStore {
    #indexedDB;
    #databaseName;
    #databasePromise;
    #clock;
    #createId;

    constructor(options = {}) {
      this.#indexedDB = options.indexedDB || globalThis.indexedDB;
      this.#databaseName = options.databaseName || DB_NAME;
      this.#clock = options.clock || (() => new Date());
      this.#createId = options.createId || (() => globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      if (!this.#indexedDB?.open) throw new Error("IndexedDB is unavailable");
    }

    #open() {
      if (this.#databasePromise) return this.#databasePromise;
      this.#databasePromise = new Promise((resolve, reject) => {
        const request = this.#indexedDB.open(this.#databaseName, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(SESSION_STORE)) {
            const sessions = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
            sessions.createIndex("updatedAt", "updatedAt");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      });
      return this.#databasePromise;
    }

    async #store(mode = "readonly") {
      const database = await this.#open();
      return database.transaction(SESSION_STORE, mode).objectStore(SESSION_STORE);
    }

    async createSession(title = "最近会话") {
      const now = this.#clock().toISOString();
      const session = {
        id: `local-session-${this.#createId()}`,
        title: String(title || "最近会话").trim().slice(0, 80) || "最近会话",
        createdAt: now,
        updatedAt: now,
        serverSessionId: null,
        lastServerMessageId: null,
        lastSyncedAt: null,
        syncState: "local-only",
        messages: []
      };
      const store = await this.#store("readwrite");
      await requestResult(store.put(session));
      return clone(session);
    }

    async saveMessages(sessionId, messages) {
      const id = String(sessionId || "").trim();
      if (!id) throw new TypeError("sessionId is required");
      const store = await this.#store("readwrite");
      const current = await requestResult(store.get(id));
      if (!current) throw new Error("Chat session not found");
      const saved = {
        ...current,
        updatedAt: this.#clock().toISOString(),
        messages: Array.isArray(messages) ? messages.map(cleanMessage).filter(Boolean) : []
      };
      await requestResult(store.put(saved));
      return clone(saved);
    }

    async loadSession(sessionId) {
      const id = String(sessionId || "").trim();
      if (!id) return null;
      const store = await this.#store();
      return clone(await requestResult(store.get(id)) || null);
    }

    async updateSyncState(sessionId, changes = {}) {
      const id = String(sessionId || "").trim();
      if (!id) throw new TypeError("sessionId is required");
      const store = await this.#store("readwrite");
      const current = await requestResult(store.get(id));
      if (!current) throw new Error("Chat session not found");
      const next = { ...current };
      if (Object.hasOwn(changes, "serverSessionId")) {
        next.serverSessionId = changes.serverSessionId
          ? String(changes.serverSessionId)
          : null;
      }
      if (Object.hasOwn(changes, "lastServerMessageId")) {
        const messageId = Number(changes.lastServerMessageId);
        next.lastServerMessageId = Number.isSafeInteger(messageId) && messageId > 0
          ? messageId
          : null;
      }
      if (Object.hasOwn(changes, "lastSyncedAt")) {
        next.lastSyncedAt = changes.lastSyncedAt
          ? String(changes.lastSyncedAt)
          : null;
      }
      if (Object.hasOwn(changes, "syncState")) {
        if (!SYNC_STATES.has(changes.syncState)) throw new TypeError("Invalid sync state");
        next.syncState = changes.syncState;
      }
      next.updatedAt = this.#clock().toISOString();
      await requestResult(store.put(next));
      return clone(next);
    }

    async listSessions() {
      const store = await this.#store();
      const sessions = await requestResult(store.getAll());
      return sessions
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
        .map(({ messages, ...session }) => ({
          ...clone(session),
          messageCount: Array.isArray(messages) ? messages.length : 0
        }));
    }

    async deleteSession(sessionId) {
      const id = String(sessionId || "").trim();
      if (!id) return false;
      const store = await this.#store("readwrite");
      const exists = Boolean(await requestResult(store.get(id)));
      if (!exists) return false;
      await requestResult(store.delete(id));
      return true;
    }
  }

  return { ChatHistoryStore, cleanMessage, DB_NAME, DB_VERSION };
});
