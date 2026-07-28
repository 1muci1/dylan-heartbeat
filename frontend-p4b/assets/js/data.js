// 前端统一模拟数据层。
// 当前数据仅用于界面开发，不包含 API、后端请求或持久化逻辑。
(() => {
  const DEFAULT_PROVIDER_MODEL = "claude-opus-4-6";
  const LEGACY_DEFAULT_PROVIDER_MODEL = "[脆卷-kiro-0.08]claude-opus-4-6-thinking";

  const appData = {
    ai: {
      id: "companion-chen",
      name: "沉",
      status: "在线",
      presence: "安静陪伴中",
      currentState: "安静而专注",
      lastActive: "2 分钟前",
      avatar: {
        type: "moon",
        label: "沉",
        asset: "assets/icons/icon.svg"
      },
      greeting: "不用急着说什么，我会安静地陪着你。",
      statusConfig: {
        isOnline: true,
        availability: "ready",
        replyDelayMs: 650
      }
    },

    user: {
      id: "local-user",
      name: "你",
      displayName: "我的空间",
      avatar: null
    },

    today: {
      dateLabel: "MON · 13",
      label: "今日寄语",
      title: "允许自己安静下来",
      message: "有些答案不必立刻找到，先照顾好此刻的感受。",
      mood: "平静"
    },

    messages: [
      {
        id: "message-001",
        role: "assistant",
        content: "晚上好。今天过得还好吗？",
        time: "21:08",
        timestamp: "2026-07-13T21:08:00+08:00"
      },
      {
        id: "message-002",
        role: "user",
        content: "有一点累，想在这里安静一会儿。",
        time: "21:09",
        timestamp: "2026-07-13T21:09:00+08:00"
      },
      {
        id: "message-003",
        role: "assistant",
        content: "好，我们不必急着做什么。\n你可以把今天慢慢放下来，我会陪你待在这里。",
        time: "21:09",
        timestamp: "2026-07-13T21:09:30+08:00"
      },
      {
        id: "message-004",
        role: "user",
        content: "谢谢你，沉。",
        time: "21:10",
        timestamp: "2026-07-13T21:10:00+08:00"
      },
      {
        id: "message-005",
        role: "assistant",
        content: "嗯，我在。",
        time: "21:10",
        timestamp: "2026-07-13T21:10:15+08:00"
      }
    ],

    memory: {
      count: 24,
      longTermStatus: "稳定积累中",
      recent: [
        {
          id: "memory-001",
          title: "你喜欢安静的清晨",
          summary: "比起匆忙开始，你更喜欢慢慢进入新的一天。",
          time: "昨天"
        },
        {
          id: "memory-002",
          title: "疲惫时需要安静陪伴",
          summary: "有时候不必追问，只要留在身边就好。",
          time: "3 天前"
        }
      ]
    },

    activities: [
      {
        id: "activity-chat",
        type: "chat",
        title: "最近一次聊天",
        description: "你和沉分享了今天的心情",
        time: "今天 21:10",
        timestamp: "2026-07-13T21:10:00+08:00"
      },
      {
        id: "activity-contact",
        type: "contact",
        title: "最近一次主动联系",
        description: "沉向你送来了一句早安问候",
        time: "今天 09:30",
        timestamp: "2026-07-13T09:30:00+08:00"
      },
      {
        id: "activity-state",
        type: "state",
        title: "最近一次状态变化",
        description: "陪伴状态更新为“安静而专注”",
        time: "昨天",
        timestamp: "2026-07-12T22:40:00+08:00"
      }
    ],

    API_MODE: "mock",

    API_CONFIG: {
      baseUrl: "",
      endpoint: "/chat",
      timeoutMs: 15000,
      headers: {
        "Content-Type": "application/json"
      }
    },

    MODEL_CONFIG: {
      model: DEFAULT_PROVIDER_MODEL,
      stream: true
    },

    PROVIDER_CONFIG: {
      type: "dylan",
      mode: "mock",
      baseUrl: "",
      endpoint: "/v1/chat/completions",
      model: DEFAULT_PROVIDER_MODEL,
      auth: {
        type: "bearer",
        token: ""
      }
    },

    mockReplies: [
      "嗯，我在听。你可以慢慢说，不需要急着整理好情绪。",
      "谢谢你愿意告诉我这些。先在这里休息一会儿也很好。",
      "我记住了。无论今天怎样，你已经认真地走到这里了。",
      "如果暂时不知道该说什么，我们也可以一起安静待一会儿。"
    ]
  };

  const deepFreeze = (value) => {
    Object.values(value).forEach((item) => {
      if (item && typeof item === "object" && !Object.isFrozen(item)) {
        deepFreeze(item);
      }
    });
    return Object.freeze(value);
  };

  window.AppData = deepFreeze(appData);

  const STORAGE_KEY = "xinban-app-state-v1";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const createInitialState = () => ({
    messages: clone(appData.messages),
    memory: clone(appData.memory),
    activities: clone(appData.activities),
    stats: {
      chatCount: appData.messages.filter((message) => message.role === "user").length
    }
  });

  const normalizeState = (storedState) => {
    const initialState = createInitialState();
    if (!storedState || typeof storedState !== "object") return initialState;

    return {
      messages: Array.isArray(storedState.messages) ? storedState.messages : initialState.messages,
      memory: {
        ...initialState.memory,
        ...(storedState.memory || {}),
        recent: Array.isArray(storedState.memory?.recent)
          ? storedState.memory.recent
          : initialState.memory.recent
      },
      activities: Array.isArray(storedState.activities)
        ? storedState.activities
        : initialState.activities,
      stats: {
        ...initialState.stats,
        ...(storedState.stats || {})
      }
    };
  };

  window.AppStore = {
    key: STORAGE_KEY,

    getState() {
      try {
        const storedState = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return normalizeState(storedState);
      } catch {
        return createInitialState();
      }
    },

    saveState(state) {
      const normalizedState = normalizeState(state);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
      } catch {
        // 隐私模式或存储空间不可用时，页面仍可在当前会话中工作。
      }
      return normalizedState;
    }
  };

  const PROVIDER_STORAGE_KEY = "xinban-provider-config-v1";
  const createDefaultProviderConfig = () => ({
    ...clone(appData.PROVIDER_CONFIG),
    model: appData.PROVIDER_CONFIG.model || appData.MODEL_CONFIG.model,
    defaultModel: appData.PROVIDER_CONFIG.model || appData.MODEL_CONFIG.model,
    autoSelectModel: false
  });
  const normalizeProviderConfig = (config) => {
    const defaults = createDefaultProviderConfig();
    const supportedTypes = new Set(["dylan", "gateway", "openai", "anthropic"]);
    const configuredType = String(config?.type || "").trim().toLowerCase();
    const configuredEndpoint = String(config?.endpoint || "").trim();
    const configuredModel = String(config?.model || "").trim();
    const configuredDefaultModel = String(config?.defaultModel || "").trim();
    const usesLegacyDefault = configuredModel === LEGACY_DEFAULT_PROVIDER_MODEL
      && (!configuredDefaultModel || configuredDefaultModel === LEGACY_DEFAULT_PROVIDER_MODEL);
    return {
      type: supportedTypes.has(configuredType) ? configuredType : defaults.type,
      mode: config?.mode === "real" ? "real" : (defaults.mode || "mock"),
      baseUrl: String(config?.baseUrl || defaults.baseUrl).trim(),
      endpoint: configuredEndpoint.startsWith("/") ? configuredEndpoint : defaults.endpoint,
      model: usesLegacyDefault ? defaults.model : (configuredModel || defaults.model),
      defaultModel: usesLegacyDefault
        ? defaults.defaultModel
        : (configuredDefaultModel || configuredModel || defaults.defaultModel),
      autoSelectModel: Boolean(config?.autoSelectModel),
      auth: {
        type: "bearer",
        token: String(config?.auth?.token || "").trim()
      }
    };
  };

  window.AppConfig = {
    key: PROVIDER_STORAGE_KEY,

    getProviderConfig() {
      try {
        const storedConfig = JSON.parse(localStorage.getItem(PROVIDER_STORAGE_KEY));
        return normalizeProviderConfig(storedConfig);
      } catch {
        return createDefaultProviderConfig();
      }
    },

    saveProviderConfig(config) {
      const normalizedConfig = normalizeProviderConfig(config);
      try {
        localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(normalizedConfig));
      } catch {
        // 本地存储不可用时保留当前页面内的填写结果。
      }
      return normalizedConfig;
    }
  };
})();
