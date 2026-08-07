require("dotenv").config();

const Fastify = require("fastify");
const cors = require("@fastify/cors");
const fs = require("fs-extra");
const { registerMemoryAdmin } = require("./memory-admin");
const { registerSessionRoutes } = require("./session-routes");
const { beginSessionTurn, createSseAccumulator } = require("./chat-session-persistence");
const { openDatabase } = require("./database");
const { SessionStore } = require("./session-store");
const { StructuredMemoryStore } = require("./structured-memory-store");
const { AgentMemoryRetriever } = require("./agent-memory-retriever");
const {
  AgentMemoryContextBuilder,
  buildMemoryOverviewResponseInstruction
} = require("./agent-memory-context-builder");
const { detectMemoryIntent } = require("./agent-memory-query");
const { AgentMemoryWriter } = require("./agent-memory-writer");
const { AgentIdentityContextBuilder } = require("./agent-identity-context-builder");
const { AgentIdentityBoundaryBuilder } = require("./agent-identity-boundary-builder");
const { registerMemoryRoutes } = require("./memory-routes");
const { MediaStore } = require("./media-store");
const { registerMediaRoutes } = require("./media-routes");
const { UploadStore } = require("./upload-store");
const { StickerImporter } = require("./sticker-importer");
const { registerUploadRoutes } = require("./upload-routes");
const { AiMemoryStore } = require("./ai-memory-store");
const { DeliveryStore } = require("./delivery-store");
const { ConversationSummaryService } = require("./conversation-summary-service");
const { AiTaskRunner, readAiConfig } = require("./ai-task-runner");
const { OpenAIJsonAdapter } = require("./model-adapter");
const { registerAiRoutes } = require("./ai-routes");
const { EventStore } = require("./event-store");
const { registerEventRoutes } = require("./event-routes");
const { GameEventService } = require("./game-event-service");
const { registerGameEventRoutes } = require("./game-event-routes");
const { DrawGameService } = require("./draw-game-service");
const { registerDrawGameRoutes } = require("./draw-game-routes");
const { GomokuChenService } = require("./gomoku-chen-service");
const { registerGomokuChenRoutes } = require("./gomoku-chen-routes");
const {
  GameTools,
  buildDrawGameChatContext,
  buildDrawGameDirectResponse,
  detectDrawGameIntent,
  resolveActiveDrawGameTurn,
  resolveDrawGameIntentTool
} = require("./game-tools");
const {
  callDrawMcpTool,
  closeDrawMcpClient
} = require("./draw-mcp-client");
const { StateStore } = require("./state-store");
const { StateProjector } = require("./state-projector");
const { registerStateRoutes } = require("./state-routes");
const { RelationshipViewService } = require("./relationship-view");
const { registerRelationshipRoutes } = require("./relationship-routes");
const { WakeDecisionGate } = require("./wake-decision-gate");
const { WakeDecisionMetrics } = require("./wake-decision-metrics");
const { WakeDecisionRollout } = require("./wake-decision-rollout");
const { WakeDecisionRolloutMetrics } = require("./wake-decision-rollout-metrics");
const { registerWakeDecisionRoutes } = require("./wake-decision-routes");
const { WakeDecisionSnapshotClient } = require("./wake-decision-snapshot-client");
const { ProactiveContactSettings } = require("./proactive-contact-settings");
const { registerProactiveDeliveryRoutes } = require("./proactive-delivery-routes");
const { ProactiveView } = require("./proactive-view");
const { ProactiveFeedbackStore } = require("./proactive-feedback-store");
const { ProactiveExplanationView } = require("./proactive-explanation-view");
const { registerProactiveExplanationRoutes } = require("./proactive-explanation-routes");
const { registerToolAuditRoutes } = require("./tool-audit-routes");
const { DeviceIdentityStore } = require("./device-identity-store");
const { DevicePairingService } = require("./device-pairing-service");
const { registerDevicePairingRoutes } = require("./device-pairing-routes");
const { CollaborationSessionService } = require("./collaboration-session-service");
const {
  ChatGptCollaborationAgentAdapter,
  ChenCollaborationAgentAdapter,
  CollaborationAgentAdapter
} = require("./collaboration-agent-adapter");
const { CollaborationRuntime } = require("./collaboration-runtime");
const { registerCollaborationRoutes } = require("./collaboration-routes");
const { CollaborationHistoryService } = require("./collaboration-history-service");
const { registerCollaborationHistoryRoutes } = require("./collaboration-history-routes");

const DEFAULT_BODY_LIMIT_MB = 50;

function readAllowedFrontendOrigins() {
  const configured = process.env.CHAT_FRONTEND_ORIGINS || process.env.CHAT_FRONTEND_ORIGIN || "";
  const defaults = [
    "https://chat.xiaowo.homes",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
  ];
  return new Set(configured.split(",").map(value => value.trim()).filter(Boolean).concat(defaults));
}

const ALLOWED_FRONTEND_ORIGINS = readAllowedFrontendOrigins();

function readBodyLimitBytes() {
  const configured = Number(process.env.REQUEST_BODY_LIMIT_MB);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BODY_LIMIT_MB;
  return Math.floor(mb * 1024 * 1024);
}

const app = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: readBodyLimitBytes()
});

app.register(require("@fastify/formbody"));
app.register(require("@fastify/multipart"), {
  limits: { files: 5, fileSize: 10 * 1024 * 1024, fields: 8, parts: 13 }
});
app.register(cors, {
  origin(origin, callback) {
    callback(null, !origin || ALLOWED_FRONTEND_ORIGINS.has(origin));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-Id"]
});

const databaseConnection = openDatabase(process.env.SESSION_DB_FILE || "./chat-sessions.sqlite");
const stateStore = new StateStore({ database: databaseConnection.db });
const stateProjector = new StateProjector({ stateStore });
const eventStore = new EventStore({ database: databaseConnection.db, stateProjector, logger: app.log });
const gameEventService = new GameEventService({ eventStore });
const drawGameService = new DrawGameService();
const gomokuChenService = new GomokuChenService({ generate: requestGomokuChenModel });
const gameTools = new GameTools({ service: drawGameService });
const sessionStore = new SessionStore({ database: databaseConnection.db, filename: databaseConnection.filename });
const structuredMemoryStore = new StructuredMemoryStore({ database: databaseConnection.db, filename: databaseConnection.filename, eventStore, logger: app.log });
const agentMemoryRetriever = new AgentMemoryRetriever({
  store: structuredMemoryStore,
  defaultLimit: 12,
  defaultCharacterBudget: 5000
});
const agentMemoryContextBuilder = new AgentMemoryContextBuilder({ maxItems: 12, maxCharacters: 5000 });
const agentMemoryWriter = new AgentMemoryWriter({ store: structuredMemoryStore });
const agentMemoryWriteHook = Object.freeze({
  create: proposal => agentMemoryWriter.create(proposal)
});
app.decorate("agentMemoryWriteHook", agentMemoryWriteHook);
const agentIdentityBoundaryBuilder = new AgentIdentityBoundaryBuilder({ agentName: "沉" });
const agentIdentityContextBuilder = new AgentIdentityContextBuilder({ database: databaseConnection.db });
const collaborationSessionService = new CollaborationSessionService();
const collaborationAgentAdapter = new CollaborationAgentAdapter({
  chen: new ChenCollaborationAgentAdapter({
    gateway: { generate: invokeCollaborationChen },
    gatewayProvidesMemoryContext: true
  }),
  chatgpt: new ChatGptCollaborationAgentAdapter({
    adapter: { generate: invokeCollaborationChatGpt }
  })
});
const collaborationRuntime = new CollaborationRuntime({
  sessionService: collaborationSessionService,
  agentAdapter: collaborationAgentAdapter
});
const collaborationHistoryService = new CollaborationHistoryService();
const mediaStore = new MediaStore({
  database: databaseConnection.db,
  imageDir: process.env.CHAT_IMAGE_UPLOAD_DIR || "./uploads/chat-images",
  stickerDir: process.env.STICKER_UPLOAD_DIR || "./uploads/stickers"
});
const uploadStore = new UploadStore();
const stickerImporter = new StickerImporter({ uploadStore });
const aiConfig = readAiConfig();
const aiMemoryStore = new AiMemoryStore({ database: databaseConnection.db, memoryStore: structuredMemoryStore, eventStore, logger: app.log });
const deliveryStore = new DeliveryStore({ database: databaseConnection.db });
const proactiveContactSettings = new ProactiveContactSettings({ stateStore, eventStore });
const proactiveFeedbackStore = new ProactiveFeedbackStore({ database: databaseConnection.db, deliveryStore, eventStore });
const aiAdapter = new OpenAIJsonAdapter();
const conversationSummaryService = new ConversationSummaryService({ database: databaseConnection.db, store: aiMemoryStore,
  adapter: aiAdapter, summaryModel: aiConfig.summaryModel, extractionModel: aiConfig.extractionModel });
const aiTaskRunner = new AiTaskRunner({ store: aiMemoryStore, service: conversationSummaryService, eventStore, deliveryStore, config: aiConfig, logger: app.log });
const relationshipViewService = new RelationshipViewService({ memoryStore: structuredMemoryStore, eventStore, stateStore });
const proactiveView = new ProactiveView({ deliveryStore, stateStore, relationshipView: relationshipViewService, eventStore, feedbackStore: proactiveFeedbackStore });
const proactiveExplanationView = new ProactiveExplanationView({
  deliveryStore,
  aiJobStore: aiMemoryStore,
  eventStore,
  feedbackStore: proactiveFeedbackStore
});
const deviceIdentityStore = new DeviceIdentityStore();
const devicePairingService = new DevicePairingService({ store: deviceIdentityStore });
const wakeDecisionGate = new WakeDecisionGate({
  mode: process.env.WAKE_DECISION_MODE || "legacy",
  metrics: new WakeDecisionMetrics(),
  rollout: new WakeDecisionRollout({ percent: process.env.WAKE_DECISION_ENFORCED_PERCENT }),
  rolloutMetrics: new WakeDecisionRolloutMetrics()
});
const wakeDecisionSnapshotClient = new WakeDecisionSnapshotClient({
  url: process.env.WAKE_DECISION_SNAPSHOT_URL,
  token: process.env.WAKE_DECISION_INTERNAL_TOKEN
});
registerSessionRoutes(app, { store: sessionStore });
registerMemoryRoutes(app, {
  store: structuredMemoryStore,
  retriever: agentMemoryRetriever,
  contextBuilder: agentMemoryContextBuilder
});
registerMediaRoutes(app, { store: mediaStore, sessionStore });
registerUploadRoutes(app, { uploadStore, stickerImporter });
registerAiRoutes(app, { store: aiMemoryStore, runner: aiTaskRunner, config: aiConfig, adapter: aiAdapter });
registerEventRoutes(app, { store: eventStore });
registerGameEventRoutes(app, { service: gameEventService });
registerDrawGameRoutes(app, { service: drawGameService });
registerGomokuChenRoutes(app, { service: gomokuChenService });
registerStateRoutes(app, { store: stateStore });
registerRelationshipRoutes(app, { service: relationshipViewService });
registerWakeDecisionRoutes(app, { gate: wakeDecisionGate, snapshotClient: wakeDecisionSnapshotClient });
registerProactiveDeliveryRoutes(app, { deliveryStore, settings: proactiveContactSettings, proactiveView, feedbackStore: proactiveFeedbackStore });
registerProactiveExplanationRoutes(app, { explanationView: proactiveExplanationView });
registerToolAuditRoutes(app, { eventStore });
registerDevicePairingRoutes(app, { pairingService: devicePairingService });
registerCollaborationRoutes(app, {
  runtime: collaborationRuntime,
  sessionService: collaborationSessionService
});
registerCollaborationHistoryRoutes(app, { service: collaborationHistoryService });
registerMemoryAdmin(app, {
  structuredStore: structuredMemoryStore,
  database: databaseConnection.db,
  databaseFile: databaseConnection.filename
});
app.addHook("onClose", async () => {
  await closeDrawMcpClient();
  aiTaskRunner.stop();
  databaseConnection.db.close();
});

const PORT = Number(process.env.PORT) || 3000;
const TARGET_API_URL = process.env.TARGET_API_URL;
const TIMELINE_FILE = process.env.TIMELINE_FILE || "enhanced_messages.json";
const TIMESTAMP_DB_FILE = process.env.TIMESTAMP_DB_FILE || "./message_timestamps.json";
const DEFAULT_RESTART_COMMAND = "pm2 restart gateway wake-up";

async function requestGomokuChenModel({ messages, model, signal }) {
  const selectedModel = String(model || process.env.MODEL_NAME || "").trim();
  if (/^(?:disabled|none|off)$/i.test(selectedModel)) throw Object.assign(new Error("gomoku model disabled"), { code: "MODEL_DISABLED" });
  if (!TARGET_API_URL) throw Object.assign(new Error("gomoku target URL missing"), { code: "TARGET_API_URL_MISSING" });
  if (!process.env.TARGET_API_KEY) throw Object.assign(new Error("gomoku target key missing"), { code: "TARGET_API_KEY_MISSING" });
  if (!selectedModel) throw Object.assign(new Error("gomoku model missing"), { code: "PROVIDER_CONFIG_MISSING" });
  let response;
  try {
    response = await fetch(TARGET_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TARGET_API_KEY}`
      },
      body: JSON.stringify({ model: selectedModel, stream: false, temperature: 0.4, messages }),
      signal
    });
  } catch (error) {
    throw Object.assign(new Error("gomoku model unavailable"), {
      code: error?.name === "AbortError" ? "MODEL_TIMEOUT" : "MODEL_HTTP_FAILED"
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error("gomoku model HTTP failed"), {
      code: "MODEL_HTTP_FAILED",
      statusCode: response.status
    });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error("gomoku model response invalid"), { code: "MODEL_JSON_PARSE_FAILED" });
  }
  const rawContent = payload?.choices?.[0]?.message?.content
    ?? payload?.output_text
    ?? payload?.response?.output_text;
  const content = Array.isArray(rawContent)
    ? rawContent.map(part => typeof part === "string" ? part : part?.text || part?.content || "").join("")
    : rawContent;
  if (!String(content || "").trim()) {
    throw Object.assign(new Error("gomoku model response empty"), { code: "MODEL_EMPTY_RESPONSE" });
  }
  return { content };
}

async function invokeCollaborationChen({ messages }) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: process.env.GATEWAY_API_KEY
      ? { authorization: `Bearer ${process.env.GATEWAY_API_KEY}` }
      : {},
    payload: {
      model: process.env.MODEL_NAME,
      stream: false,
      messages
    }
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw Object.assign(new Error("chen Gateway 调用失败"), {
      code: "COLLABORATION_CHEN_GATEWAY_FAILED",
      statusCode: 502
    });
  }
  const content = response.json()?.choices?.[0]?.message?.content;
  return { content };
}

async function invokeCollaborationChatGpt({ messages, signal }) {
  const url = process.env.COLLABORATION_CHATGPT_API_URL || process.env.TARGET_API_URL;
  const apiKey = process.env.COLLABORATION_CHATGPT_API_KEY || process.env.TARGET_API_KEY;
  const model = process.env.COLLABORATION_CHATGPT_MODEL || process.env.MODEL_NAME;
  if (!url || !apiKey || !model) {
    throw Object.assign(new Error("chatgpt adapter 未配置"), {
      code: "COLLABORATION_CHATGPT_NOT_CONFIGURED",
      statusCode: 503
    });
  }
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, stream: false, messages }),
      signal
    });
  } catch {
    throw Object.assign(new Error("chatgpt adapter 调用失败"), {
      code: "COLLABORATION_CHATGPT_UNAVAILABLE",
      statusCode: 502
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error("chatgpt adapter 调用失败"), {
      code: "COLLABORATION_CHATGPT_UPSTREAM_ERROR",
      statusCode: 502
    });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error("chatgpt adapter 响应无效"), {
      code: "COLLABORATION_CHATGPT_RESPONSE_INVALID",
      statusCode: 502
    });
  }
  return { content: payload?.choices?.[0]?.message?.content };
}

// ========================
// 多模态消息处理
// ========================
function shouldForwardMultimodalContent() {
  const mode = (process.env.MULTIMODAL_MODE || "text").trim().toLowerCase();
  return mode === "passthrough" || mode === "vision" || mode === "true";
}

function isDataImageUrl(value) {
  return typeof value === "string" && /^data:image\//i.test(value);
}

function isImageContentPart(part) {
  if (!part || typeof part !== "object") return false;
  if (part.image_url) return true;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  return type.includes("image");
}

function isFileContentPart(part) {
  if (!part || typeof part !== "object") return false;
  if (part.file) return true;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  return type.includes("file");
}

function getTextFromContentPart(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  if (type === "text" || type === "input_text") return part.text || part.content || "";
  if (typeof part.text === "string") return part.text;
  return "";
}

function normalizeContentToText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";

  if (Array.isArray(content)) {
    const parts = content
      .map(part => {
        const text = getTextFromContentPart(part).trim();
        if (text) return text;
        if (isImageContentPart(part)) return "[图片]";
        if (isFileContentPart(part)) return "[文件]";
        return "";
      })
      .filter(Boolean);
    return parts.join("\n");
  }

  if (isImageContentPart(content)) return "[图片]";
  if (isFileContentPart(content)) return "[文件]";
  return "[非文本内容]";
}

function latestUserContentOf(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      return normalizeContentToText(messages[index].content);
    }
  }
  return "";
}

function sendLocalAssistantCompletion({ reply, body, content, sessionTurn, requestOrigin }) {
  const model = typeof body?.model === "string" ? body.model : "";
  const id = `chatcmpl-draw-${Date.now()}`;
  sessionTurn?.complete(content, null);
  if (body?.stream) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(ALLOWED_FRONTEND_ORIGINS.has(requestOrigin)
        ? { "Access-Control-Allow-Origin": requestOrigin }
        : {}),
      Vary: "Origin"
    });
    const chunks = [
      {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }]
      },
      {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
      }
    ];
    for (const chunk of chunks) reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    reply.raw.end("data: [DONE]\n\n");
    return;
  }
  return reply.send({
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop"
    }]
  });
}

function memoryQueryOf(messages, maxMessages = 6) {
  if (!Array.isArray(messages)) return "";
  return messages
    .filter(message => message?.role === "user" || message?.role === "assistant")
    .slice(-Math.max(1, Math.min(6, Number(maxMessages) || 6)))
    .map(message => normalizeContentToText(message.content).trim().slice(0, 500))
    .filter(Boolean)
    .join("\n")
    .slice(-2000);
}

function normalizeMessageForTimeline(msg) {
  return { ...msg, content: normalizeContentToText(msg.content) };
}

function prepareMessageForLLM(msg) {
  if (msg.role === "assistant" && msg.tool_calls) return msg;
  if (msg.role === "tool") return msg;
  if (msg.role === "system") return { ...msg, content: normalizeContentToText(msg.content) };
  if (typeof msg.content === "string") return msg;

  if (Array.isArray(msg.content) && shouldForwardMultimodalContent()) return msg;

  const textContent = normalizeContentToText(msg.content);
  if (!textContent) return null;
  return { ...msg, content: textContent };
}

const LOCAL_IMAGE_RE = /\/api\/v1\/chat\/media\/([0-9a-f-]{36})(?:[?#].*)?$/i;

function imageUrlValue(part) {
  return typeof part?.image_url === "string" ? part.image_url : part?.image_url?.url;
}

function readP4MessageMetadata(messages) {
  const latest = [...messages].reverse().find(message => message?.role === "user");
  const parts = Array.isArray(latest?.content) ? latest.content : [];
  const attachmentIds = [];
  const fileIds = [];
  let stickerId = null;
  for (const part of parts) {
    const match = String(imageUrlValue(part) || "").match(LOCAL_IMAGE_RE);
    if (match) attachmentIds.push(match[1]);
    if (part?.type === "sticker" && typeof part.sticker_id === "string") stickerId = part.sticker_id;
    if (part?.type === "file" && typeof part.file_id === "string") fileIds.push(part.file_id);
  }
  if (attachmentIds.length > 4) { const error = new Error("每条消息最多包含 4 张图片"); error.statusCode = 413; throw error; }
  if (attachmentIds.length && !shouldForwardMultimodalContent()) {
    const error = new Error("当前 MULTIMODAL_MODE 不支持图片，请启用 passthrough/vision 后重试");
    error.statusCode = 400; error.code = "MULTIMODAL_NOT_ENABLED"; throw error;
  }
  if (fileIds.length > 5) { const error = new Error("每条消息最多包含 5 个文件"); error.statusCode = 413; error.code = "TOO_MANY_FILES"; throw error; }
  const files = fileIds.map(fileId => uploadStore.get(fileId));
  let sticker = null;
  if (stickerId) sticker = mediaStore.getSticker(stickerId);
  return { attachmentIds, fileIds, files, stickerId, sticker,
    messageType: stickerId ? "sticker" : attachmentIds.length ? "image" : "text" };
}

function normalizeStickerParts(messages, metadata, options = {}) {
  const filesById = new Map((metadata.fileIds || []).map((fileId, index) => [fileId, metadata.files?.[index]]));
  const latestUserIndex = messages.findLastIndex(message => message?.role === "user");
  return messages.map((message, messageIndex) => {
    if (!Array.isArray(message?.content)) return message;
    const content = message.content.map(part => {
      if (part?.type === "sticker") return { type: "text", text: `[Sticker: ${metadata.sticker?.label || "Sticker"}]` };
      if (part?.type === "file" && typeof part.file_id === "string") {
        const file = filesById.get(part.file_id);
        if (!file) return { type: "text", text: "[附件已失效]" };
        return {
          type: "text",
          text: options.includeFileText && messageIndex === latestUserIndex
            ? uploadStore.chatContext(part.file_id, { preview: part.preview })
            : `[附件：${file.safeName || file.name || "文件"}，${file.mime}；历史内容已省略]`
        };
      }
      return part;
    });
    return { ...message, content };
  });
}

function buildStickerInstructionContext(importer = stickerImporter) {
  const preferredTags = ["小白猫", "哭", "无语", "爱心", "生气", "开心", "思考", "睡觉", "咬", "收到"];
  let availableTags = preferredTags;
  try {
    const searchableText = importer.list()
      .map(item => `${String(item.label || "")} ${String(item.tags || "")}`)
      .join(" ");
    const matched = preferredTags.filter(tag => searchableText.includes(tag));
    if (matched.length) availableTags = matched;
  } catch {
    // Sticker 目录暂时不可读时仍提供固定、安全的协议说明。
  }
  return {
    role: "system",
    content: [
      "你可以在回复里使用 Sticker。Sticker 不是图片上传，而是前端渲染指令。",
      "当你想用表情辅助表达情绪时，输出 [[sticker:关键词]]，例如 [[sticker:爱心]]。",
      `可用 Sticker 标签：${availableTags.slice(0, 10).join("、")}。`,
      "每条回复最多使用 2 个 Sticker；文字回复仍需自然完整。",
      "不要说自己不能发图片或表情包，不要输出图片 URL，也不要编造文件或路径。"
    ].join("\n")
  };
}

function embedLocalImages(messages) {
  return messages.map(message => {
    if (!Array.isArray(message?.content)) return message;
    const content = message.content.map(part => {
      const match = String(imageUrlValue(part) || "").match(LOCAL_IMAGE_RE);
      if (!match) return part;
      const file = mediaStore.resolveFile("image", match[1]);
      const dataUrl = `data:${file.mimeType};base64,${fs.readFileSync(file.filename).toString("base64")}`;
      return { ...part, image_url: typeof part.image_url === "string" ? dataUrl : { ...part.image_url, url: dataUrl } };
    });
    return { ...message, content };
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ========================
// 读取 timeline
// ========================
function loadTimeline() {
  if (!fs.existsSync(TIMELINE_FILE)) return [];
  try { return fs.readJsonSync(TIMELINE_FILE); } catch { return []; }
}

// ========================
// 保存 timeline（保留 SP）
// ========================
function saveTimeline(messages) {
  const sp = messages.find(m => m.role === "system");
  const nonSP = messages.filter(m => m.role !== "system");
  const trimmed = nonSP.slice(-49);
  const final = sp ? [sp, ...trimmed] : trimmed;
  fs.writeJsonSync(TIMELINE_FILE, final, { spaces: 2 });
}

// ========================
// 提取时间戳（支持多种格式）
// ========================
function extractTimestamp(content) {
  if (!content || typeof content !== "string") return null;
  let match = content.match(/（?(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  if (match) return new Date(match[1]);
  match = content.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  if (match) return new Date(match[1]);
  match = content.match(/（(\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2})）/);
  if (match) return new Date(match[1]);
  match = content.match(/(\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2})/);
  if (match) return new Date(match[1]);
  return null;
}

// ========================
// 时间戳记忆库
// ========================
function loadTimestampDB() {
  if (!fs.existsSync(TIMESTAMP_DB_FILE)) return {};
  try { return fs.readJsonSync(TIMESTAMP_DB_FILE); } catch { return {}; }
}

function saveTimestampDB(db) {
  fs.writeJsonSync(TIMESTAMP_DB_FILE, db, { spaces: 2 });
}

function makeFingerprint(msg) {
  const raw = normalizeContentToText(msg.content);
  const content = raw.trim().slice(0, 150);
  return `${msg.role}::${content}`;
}

function makeFingerprintStripped(msg) {
  const raw = normalizeContentToText(msg.content);
  let content = raw.trim();
  content = content
    .replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*/, "")
    .replace(/^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}\s*/, "")
    .replace(/^（\d{4}[-\/]\d{1,2}[-\/]\d{1,2} \d{2}:\d{2}[）\s]*/, "")
    .trim()
    .slice(0, 150);
  return `${msg.role}::${content}`;
}

function extractTimestampWithMemory(msg, tsDB) {
  for (const field of ["timestamp", "createdAt", "created_at"]) {
    if (msg?.[field] == null || msg[field] === "") continue;
    const value = new Date(msg[field]);
    if (!Number.isNaN(value.getTime())) return value;
  }
  const fp = makeFingerprint(msg);
  if (tsDB?.[fp]) {
    const value = new Date(tsDB[fp]);
    if (!Number.isNaN(value.getTime())) return value;
  }
  const fpStripped = makeFingerprintStripped(msg);
  if (tsDB?.[fpStripped]) {
    const value = new Date(tsDB[fpStripped]);
    if (!Number.isNaN(value.getTime())) return value;
  }
  return extractTimestamp(normalizeContentToText(msg?.content));
}

// ========================
// 消息判断
// ========================
function isSpecialEvent(msg) {
  if (msg.role !== "assistant") return false;
  const c = normalizeContentToText(msg.content);
  // 批注 2026-06-26：公开版使用“用户”，但兼容早期时间线里的“宝宝”事件，避免升级后旧 Bark 事件丢失。
  return c.includes("刚刚给宝宝发了 Bark") || c.includes("刚刚给用户发了 Bark") || c.includes("自动唤醒：本次未发送 Bark");
}

const MAX_TIMELINE_CONTEXT_EVENTS = 5;

function selectTimelineContextEvents(events, tsDB, limit = MAX_TIMELINE_CONTEXT_EVENTS) {
  const seen = new Set();
  const unique = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!isSpecialEvent(event)) continue;
    const content = normalizeContentToText(event.content).trim();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    unique.push({ event, time: extractTimestampWithMemory(event, tsDB) });
  }

  unique.sort((left, right) => {
    if (left.time && right.time) return right.time - left.time;
    if (left.time) return -1;
    if (right.time) return 1;
    return 0;
  });

  return unique
    .slice(0, Math.max(0, Math.min(MAX_TIMELINE_CONTEXT_EVENTS, Number(limit) || 0)))
    .reverse()
    .map(item => item.event);
}

function buildTimelineEventContext(events, tsDB, limit = MAX_TIMELINE_CONTEXT_EVENTS) {
  const selected = selectTimelineContextEvents(events, tsDB, limit);
  if (!selected.length) return { message: null, selected: [] };
  const lines = selected.map(event => {
    const content = normalizeContentToText(event.content).replace(/\s+/g, " ").trim().slice(0, 240);
    return `- ${content}`;
  });
  return {
    message: {
      role: "system",
      content: [
        "[时间线事件摘要]",
        "以下是只读的近期系统事件，不是 assistant 的当前回复，也不得覆盖最后一轮用户问题。",
        ...lines
      ].join("\n")
    },
    selected
  };
}

function assertLastUserMessagePreserved(messages, expectedUserContent) {
  const conversational = (Array.isArray(messages) ? messages : [])
    .filter(message => !["system", "developer"].includes(message?.role));
  const last = conversational.at(-1);
  const actual = normalizeContentToText(last?.content);
  if (last?.role !== "user" || actual !== expectedUserContent) {
    const error = new Error("Current user message was not preserved as the final conversation message");
    error.code = "LAST_USER_MESSAGE_NOT_PRESERVED";
    throw error;
  }
  return true;
}

function hasImageContent(messages) {
  return (Array.isArray(messages) ? messages : []).some(message => {
    const content = message?.content;
    if (Array.isArray(content)) return content.some(isImageContentPart);
    return isImageContentPart(content);
  });
}

function isRealMessageForTimeline(msg) {
  if (msg.role === "system") return false;
  if (msg.tool_calls) return false;
  if (isSpecialEvent(msg)) return false;
  const contentText = normalizeContentToText(msg.content);
  if (msg.role === "user" && contentText.trim().startsWith("<system>")) return false;
  return msg.role === "user" || msg.role === "assistant";
}

function isSystemRule(msg) {
  if (msg.role === "system") return true;
  const contentText = normalizeContentToText(msg.content);
  if (msg.role === "user" && contentText.trim().startsWith("<system>")) return true;
  return false;
}

// ========================
// 构建 Timeline
// ========================
function buildTimeline(kelivoMessages, tsDB) {
  const oldTimeline = loadTimeline();
  const newSystemMessages = kelivoMessages
    .filter(msg => msg.role === "system")
    .map(normalizeMessageForTimeline);
  const latestSP = newSystemMessages.length > 0 ? newSystemMessages[newSystemMessages.length - 1] : null;
  const oldSP = oldTimeline.find(msg => msg.role === "system");

  const newRealMessages = kelivoMessages
    .filter(isRealMessageForTimeline)
    .map(normalizeMessageForTimeline);

  const oldSpecialEvents = oldTimeline.filter(isSpecialEvent).sort((a, b) => {
    const timeA = extractTimestampWithMemory(a, tsDB);
    const timeB = extractTimestampWithMemory(b, tsDB);
    if (timeA && timeB) return timeA - timeB;
    return 0;
  });

  const merged = [...newRealMessages];
  for (const event of oldSpecialEvents) {
    const eventTime = extractTimestampWithMemory(event, tsDB);
    if (!eventTime) { merged.push(event); continue; }
    let inserted = false;
    for (let i = 0; i < merged.length; i++) {
      const msgTime = extractTimestampWithMemory(merged[i], tsDB);
      if (msgTime && msgTime >= eventTime) {
        merged.splice(i, 0, event);
        inserted = true;
        break;
      }
    }
    if (!inserted) merged.push(event);
  }

  const seen = new Set();
  const unique = merged.filter(msg => {
    const key = JSON.stringify({ role: msg.role, content: msg.content });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const result = [];
  if (latestSP) result.push({ ...latestSP, position: 0 });
  else if (oldSP) result.push({ ...oldSP, position: 0 });

  let realPos = 1;
  const finalMessages = [];
  let pendingSpecial = [];
  for (const msg of unique) {
    if (isSpecialEvent(msg)) {
      pendingSpecial.push(msg);
    } else {
      if (pendingSpecial.length > 0) {
        const prevRealPos = realPos - 1;
        const step = 1 / (pendingSpecial.length + 1);
        for (let i = 0; i < pendingSpecial.length; i++) {
          finalMessages.push({ ...pendingSpecial[i], position: parseFloat((prevRealPos + step * (i + 1)).toFixed(4)) });
        }
        pendingSpecial = [];
      }
      finalMessages.push({ ...msg, position: realPos });
      realPos++;
    }
  }
  if (pendingSpecial.length > 0) {
    const lastRealPos = realPos - 1;
    for (let i = 0; i < pendingSpecial.length; i++) {
      finalMessages.push({ ...pendingSpecial[i], position: parseFloat((lastRealPos + 0.3 * (i + 1)).toFixed(4)) });
    }
  }

  result.push(...finalMessages);
  return result;
}

// ========================
// 追加特殊事件
// ========================
function appendSpecialEvent(content) {
  const timeline = loadTimeline();
  let maxPos = 0;
  for (const msg of timeline) {
    if (msg.position && msg.position > maxPos) maxPos = msg.position;
  }
  const newEvent = { role: "assistant", content, position: maxPos + 0.5 };
  timeline.push(newEvent);
  saveTimeline(timeline);
  console.log(`已记录特殊事件 (position ${newEvent.position})`);
}

let wakeUpLastHeartbeat = null;

// ========================
// 预设方案
// ========================
const PRESETS_FILE = "./presets.json";
const ENV_FILE = ".env";
const PREFERRED_ENV_ORDER = [
  "TARGET_API_URL",
  "TARGET_API_KEY",
  "MODEL_NAME",
  "BARK_KEY",
  "CUSTOM_ICON_URL",
  "REQUEST_BODY_LIMIT_MB",
  "MULTIMODAL_MODE",
  "DAY_WAKE_AFTER_MINUTES",
  "NIGHT_WAKE_AFTER_MINUTES",
  "DAY_CHECK_INTERVAL_MINUTES",
  "NIGHT_CHECK_INTERVAL_MINUTES",
  "WAKE_DAY_START_HOUR",
  "WAKE_DAY_END_HOUR",
  "WEATHER_ENABLED",
  "WEATHER_LOCATION_NAME",
  "WEATHER_LAT",
  "WEATHER_LON",
  "WEATHER_UNITS",
  "PORT",
  "GATEWAY_BASE_URL",
  "TIME_ZONE",
  "RESTART_COMMAND",
  "ADMIN_USER",
  "ADMIN_PASSWORD"
];

function loadPresets() {
  if (!fs.existsSync(PRESETS_FILE)) return [];
  try { return fs.readJsonSync(PRESETS_FILE); } catch { return []; }
}

function savePresets(presets) {
  fs.writeJsonSync(PRESETS_FILE, presets, { spaces: 2 });
}

function wantsJsonResponse(req) {
  const contentType = req.headers["content-type"] || "";
  const accept = req.headers.accept || "";
  return contentType.includes("application/json") || accept.includes("application/json");
}

function loadEnvFileObject() {
  const result = {};
  try {
    const envContent = fs.readFileSync(ENV_FILE, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      result[key] = value;
    }
  } catch {}
  return result;
}

function serializeEnvValue(value) {
  return String(value ?? "").replace(/\r?\n/g, "\\n");
}

function writeEnvUpdates(updates) {
  const merged = { ...loadEnvFileObject(), ...updates };
  const orderedKeys = [
    ...PREFERRED_ENV_ORDER.filter(key => Object.prototype.hasOwnProperty.call(merged, key)),
    ...Object.keys(merged)
      .filter(key => !PREFERRED_ENV_ORDER.includes(key))
      .sort()
  ];
  const lines = orderedKeys.map(key => `${key}=${serializeEnvValue(merged[key])}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n");
}

function readRestartCommand() {
  return readEnvValue("RESTART_COMMAND") || DEFAULT_RESTART_COMMAND;
}

// ========================
// 安全：
// - /admin 使用 Basic Auth
// - 本机/局域网请求直接允许
// - 公网 /v1/* 必须携带 GATEWAY_API_KEY
// - 其他公网路径拒绝
// ========================
app.addHook("onRequest", (req, reply, done) => {
const auth = req.headers.authorization || "";

  if (req.url.startsWith("/admin")) return done();
  if (req.url.startsWith("/api/v1/chat/sessions")) return done();
  if (req.url.startsWith("/api/v1/chat/")) return done();
  if (req.url.startsWith("/api/v1/stickers")) return done();
  if (req.url.startsWith("/api/v1/sticker-imports")) return done();
  if (req.url.startsWith("/api/v1/uploads")) return done();
  if (req.url.startsWith("/api/v1/memories")) return done();
  if (req.url.startsWith("/api/v1/memory-candidates")) return done();
  if (req.url.startsWith("/api/v1/ai-")) return done();
  // 游戏 API 使用各自路由的 Bearer 鉴权与 JSON 错误封装。
  if (req.url.startsWith("/api/game/")) return done();

const ip =
  req.ip ||
  req.socket?.remoteAddress ||
  "";

  const isLocal =
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "localhost" ||
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);

  if (isLocal) return done();

  if (req.url.startsWith("/v1/")) {
    const expectedKey = process.env.GATEWAY_API_KEY;
    const auth = req.headers.authorization || "";

    if (!expectedKey) {
      return reply.code(503).send({
        error: "GATEWAY_API_KEY 未配置"
      });
    }

    if (auth === `Bearer ${expectedKey}`) {
      return done();
    }

    return reply
      .code(401)
      .header("WWW-Authenticate", "Bearer")
      .send({
        error: "Invalid gateway API key"
      });
  }

  reply.code(403).send("Forbidden");
});

// ========================
// Models
// ========================
app.get("/v1/models", async (req, reply) => {
  reply.send({
    object: "list",
    data: [{ id: "DeepSeek-V4-Pro", object: "model", created: 0, owned_by: "gateway" }]
  });
});

// ========================
// Chat Completions
// ========================
app.post("/v1/chat/completions", async (req, reply) => {
  let sessionTurn = null;
  let streamedAssistantContent = "";
  let streamedAssistantThinking = "";
  try {
    const body = req.body;

    const originalMessages = body.messages || [];
    const p4Metadata = readP4MessageMetadata(originalMessages);
    const kelivoMessages = normalizeStickerParts(originalMessages, p4Metadata);
    const llmSourceMessages = p4Metadata.fileIds?.length
      ? normalizeStickerParts(originalMessages, p4Metadata, { includeFileText: true })
      : kelivoMessages;
    const sessionId = String(req.headers["x-session-id"] || "").trim();
    sessionTurn = beginSessionTurn(sessionStore, sessionId, kelivoMessages, normalizeContentToText, {
      ...p4Metadata,
      onCompleted: ({ sessionId: completedSessionId }) => aiTaskRunner.evaluateSession(completedSessionId)
    });
    const oldTimeline = loadTimeline();

    const tsDB = loadTimestampDB();
    let tsDBDirty = false;
    for (const msg of kelivoMessages) {
      if (msg.role === "system") continue;
      if (msg.role === "tool") continue;
      const ts = extractTimestamp(normalizeContentToText(msg.content));
      if (!ts) continue;
      const fp = makeFingerprint(msg);
      const fpStripped = makeFingerprintStripped(msg);
      if (!tsDB[fp]) { tsDB[fp] = ts.toISOString(); tsDBDirty = true; }
      if (!tsDB[fpStripped]) { tsDB[fpStripped] = ts.toISOString(); tsDBDirty = true; }
    }
    if (tsDBDirty) saveTimestampDB(tsDB);

    const finalTimeline = buildTimeline(kelivoMessages, tsDB);
    saveTimeline(finalTimeline);

    // Kelivo 发图时 content 常是数组。默认转为文本占位，避免非视觉模型/中转站报错。
    // 如上游支持 OpenAI 兼容视觉格式，可设置 MULTIMODAL_MODE=passthrough 原样转发。
    const llmMessages = embedLocalImages(llmSourceMessages)
      .map(prepareMessageForLLM)
      .filter(Boolean);

    // ---- 自动修复不完整的 tool 调用（双向清理） ----
    // 第一遍：标记需要移除的索引
    const removeSet = new Set();

    // 检查 assistant tool_calls 是否完整
    for (let i = 0; i < llmMessages.length; i++) {
      const msg = llmMessages[i];
      if (msg.role !== "assistant" || !msg.tool_calls) continue;
      const expectedIds = msg.tool_calls.map(tc => tc.id);
      const followingTools = [];
      for (let j = i + 1; j < llmMessages.length; j++) {
        const nxt = llmMessages[j];
        if (nxt.role === "tool") {
          followingTools.push(nxt);
        } else {
          break;
        }
      }
      const foundIds = followingTools.map(t => t.tool_call_id);
      const complete = expectedIds.every(id => foundIds.includes(id));
      if (!complete) {
        // 标记这条 assistant 为移除，同时标记它后面的所有 tool 消息也移除
        removeSet.add(i);
        for (let j = i + 1; j < llmMessages.length; j++) {
          if (llmMessages[j].role === "tool") {
            removeSet.add(j);
          } else {
            break;
          }
        }
        console.log(`⚠️ 自动修复：移除不完整的 tool_calls (索引 ${i})`);
      }
    }

    // 检查孤立 tool 消息（前面没有对应的 tool_calls）
    for (let i = 0; i < llmMessages.length; i++) {
      if (llmMessages[i].role !== "tool") continue;
      // 向前查找最近的 assistant
      let hasMatchingToolCalls = false;
      for (let j = i - 1; j >= 0; j--) {
        const prev = llmMessages[j];
        if (prev.role === "assistant" && prev.tool_calls) {
          // 检查这个 tool_call_id 是否在 assistant 的 tool_calls 中
          const ids = prev.tool_calls.map(tc => tc.id);
          if (ids.includes(llmMessages[i].tool_call_id)) {
            hasMatchingToolCalls = true;
          }
          break;
        } else if (prev.role === "tool") {
          continue; // 继续向前找
        } else {
          break; // 遇到 user 或其他消息，停止
        }
      }
      if (!hasMatchingToolCalls) {
        removeSet.add(i);
        console.log(`⚠️ 自动修复：移除孤立的 tool 消息 (索引 ${i})`);
      }
    }

    // 按索引从大到小删除，避免索引错乱
    const sortedRemove = Array.from(removeSet).sort((a, b) => b - a);
    for (const idx of sortedRemove) {
      llmMessages.splice(idx, 1);
    }

    const identityBoundaryContext = agentIdentityBoundaryBuilder.build();
    const identityContext = agentIdentityContextBuilder.build();
    const latestUserContent = latestUserContentOf(kelivoMessages);
    const activeDrawTurn = await resolveActiveDrawGameTurn({
      content: latestUserContent,
      sessionId,
      hasImages: hasImageContent(originalMessages),
      store: drawGameService.store,
      service: drawGameService,
      callMcpTool: callDrawMcpTool,
      internalTools: gameTools,
      logger: app.log
    });
    if (activeDrawTurn?.handled) {
      return sendLocalAssistantCompletion({
        reply,
        body,
        content: activeDrawTurn.response,
        sessionTurn,
        requestOrigin: req.headers.origin
      });
    }
    const drawGameIntent = detectDrawGameIntent(latestUserContent);
    const drawGameToolResult = await resolveDrawGameIntentTool({
      intent: drawGameIntent,
      callMcpTool: callDrawMcpTool,
      internalTools: gameTools,
      logger: app.log,
      store: drawGameService.store,
      sessionId
    });
    const directGameResponse = buildDrawGameDirectResponse(drawGameIntent, drawGameToolResult);
    if (directGameResponse) {
      return sendLocalAssistantCompletion({
        reply,
        body,
        content: directGameResponse,
        sessionTurn,
        requestOrigin: req.headers.origin
      });
    }
    const drawGameContext = buildDrawGameChatContext(drawGameIntent, drawGameToolResult);
    const memoryQuery = memoryQueryOf(kelivoMessages) || latestUserContent;
    const memoryIntent = detectMemoryIntent(memoryQuery);
    const memoryLimit = memoryIntent === "overview" ? 24 : 12;
    const memoryCharacterBudget = memoryIntent === "overview" ? 12000 : 5000;
    const memoryRetrieval = agentMemoryRetriever.retrieve({
      query: memoryQuery,
      memoryIntent,
      limit: memoryLimit,
      characterBudget: memoryCharacterBudget
    });
    const memoryContext = agentMemoryContextBuilder.build(memoryRetrieval, {
      maxItems: memoryLimit,
      maxCharacters: memoryCharacterBudget
    });
    const timelineContext = buildTimelineEventContext(oldTimeline, tsDB);
    const memoryOverviewInstruction = memoryIntent === "overview"
      ? buildMemoryOverviewResponseInstruction()
      : null;
    const stickerInstructionContext = buildStickerInstructionContext();
    const runtimeContexts = [
      identityBoundaryContext,
      identityContext,
      memoryContext,
      timelineContext.message,
      memoryOverviewInstruction,
      stickerInstructionContext,
      drawGameContext
    ].filter(Boolean);
    if (runtimeContexts.length) {
      const firstConversationMessage = llmMessages.findIndex(message => message.role !== "system");
      llmMessages.splice(
        firstConversationMessage < 0 ? llmMessages.length : firstConversationMessage,
        0,
        ...runtimeContexts
      );
    }
    assertLastUserMessagePreserved(
      llmMessages,
      p4Metadata.fileIds?.length ? latestUserContentOf(llmSourceMessages) : latestUserContent
    );

    console.log("chat request summary", {
      messageCount: originalMessages.length,
      lastRoles: originalMessages.slice(-3).map(message => message?.role || "unknown"),
      lastUserContentLength: normalizeContentToText(latestUserContent).length,
      filePreviewLengths: (p4Metadata.files || []).map(file =>
        Math.min(String(file.extractedTextPreview || "").length, 500)
      ),
      fileExtractedTextLengths: (p4Metadata.files || []).map(file =>
        Number(file.extractedTextLength) || 0
      ),
      model: typeof body.model === "string" ? body.model : "",
      hasImages: hasImageContent(originalMessages),
      memoryInjectedCount: Array.isArray(memoryRetrieval?.items) ? memoryRetrieval.items.length : 0,
      timelineEventCount: timelineContext.selected.length
    });

    if (!TARGET_API_URL || !process.env.TARGET_API_KEY) {
      return reply.code(500).send({ error: "TARGET_API_URL / TARGET_API_KEY 未配置" });
    }

    // 请求模型
    const response = await fetch(TARGET_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TARGET_API_KEY}`
      },
      body: JSON.stringify({ ...body, messages: llmMessages })
    });

    if (!response.body) {
      sessionTurn?.fail("", "UPSTREAM_BODY_MISSING");
      return reply.code(response.status).send({ error: "上游 API 没有返回可读取的响应体" });
    }

if (body.stream) {
const accumulator = sessionTurn ? createSseAccumulator() : null;
const requestOrigin = req.headers.origin;
reply.raw.writeHead(response.status, {
  "Content-Type": response.headers.get("content-type") || "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  ...(ALLOWED_FRONTEND_ORIGINS.has(requestOrigin) ? { "Access-Control-Allow-Origin": requestOrigin } : {}),
  "Vary": "Origin"
});
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    accumulator?.push(value);
    reply.raw.write(value);
  }
  if (accumulator) {
    const observed = accumulator.finish();
    streamedAssistantContent = observed.content;
    streamedAssistantThinking = observed.thinking;
    if (response.ok && observed.doneReceived && observed.content) {
      sessionTurn.complete(observed.content, observed.thinking);
    } else if (response.ok) {
      sessionTurn.interrupt(observed.content, observed.thinking);
    } else {
      sessionTurn.fail(observed.content, `UPSTREAM_HTTP_${response.status}`, observed.thinking);
    }
  }
  reply.raw.end();
} else {

  const json = await response.json();
  const assistantContent = json?.choices?.[0]?.message?.content;
  const assistantThinking = json?.choices?.[0]?.message?.reasoning_content
    ?? json?.choices?.[0]?.message?.reasoning ?? json?.choices?.[0]?.message?.thinking ?? null;
  if (sessionTurn) {
    if (response.ok && typeof assistantContent === "string" && assistantContent) {
      sessionTurn.complete(assistantContent, assistantThinking);
    } else {
      sessionTurn.fail(typeof assistantContent === "string" ? assistantContent : "", `UPSTREAM_HTTP_${response.status}`, assistantThinking);
    }
  }
  return reply.code(response.status).send(json);

}

} catch (err) {

  console.error("chat request failed", {
    code: typeof err?.code === "string" ? err.code : "REQUEST_FAILED",
    name: typeof err?.name === "string" ? err.name : "Error",
    statusCode: Number(err?.statusCode) || 500
  });

  if (sessionTurn) {
    if (err?.name === "AbortError" || req.raw.aborted || reply.raw.destroyed) {
      sessionTurn.interrupt(streamedAssistantContent, streamedAssistantThinking);
    } else {
      sessionTurn.fail(streamedAssistantContent, err?.code || "REQUEST_FAILED", streamedAssistantThinking);
    }
  }

  if (!reply.sent) {
    return reply.code(err.statusCode || 500).send({ error: err.message });
 }
}
});

// ========================
// 内部接口：记录唤醒事件
// ========================
app.post("/internal/wake-event", async (req, reply) => {
  try {
    const { content } = req.body;
    if (!content) return reply.code(400).send({ error: "content is required" });
    appendSpecialEvent(content);
    reply.send({ success: true });
} catch (err) {
  console.error(err);

  if (!reply.sent) {
    return reply.code(500).send({ error: err.message });
  }
}
});

// ========================
// 读取 .env 值
// ========================
function readEnvValue(key) {
  try {
    const envContent = fs.readFileSync(ENV_FILE, "utf-8");
    const lines = envContent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(key + "=")) return trimmed.substring(key.length + 1).trim();
    }
  } catch {}
  return process.env[key] || "";
}

function readEnvValueOrDefault(key, fallback) {
  const value = readEnvValue(key);
  return value === "" ? fallback : value;
}

function normalizePositiveInteger(value, key, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1) return String(Math.floor(n));
  return readEnvValueOrDefault(key, fallback);
}

function normalizeHour(value, key, fallback, min, max) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= min && n <= max) return String(Math.floor(n));
  return readEnvValueOrDefault(key, fallback);
}

function normalizeBooleanString(value, key, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(raw)) return "true";
  if (["false", "0", "no", "off"].includes(raw)) return "false";
  return readEnvValueOrDefault(key, fallback);
}

function normalizeWeatherUnits(value) {
  return String(value || "").trim().toLowerCase() === "fahrenheit" ? "fahrenheit" : "metric";
}

// ========================
// HTTP Basic Auth
// ========================
function basicAuth(req, reply, done) {
  const auth = req.headers.authorization || "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) {
    reply.code(401).header("WWW-Authenticate", 'Basic realm="Admin"').send("Unauthorized");
    return;
  }
  const decoded = Buffer.from(encoded, "base64").toString();
  const colonIndex = decoded.indexOf(":");
  const user = decoded.substring(0, colonIndex);
  const password = decoded.substring(colonIndex + 1);
  if (user === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
    done();
  } else {
    reply.code(401).header("WWW-Authenticate", 'Basic realm="Admin"').send("Unauthorized");
  }
}

// ========================
// 管理页面 GET /admin
// ========================
app.get("/admin", { preHandler: basicAuth }, async (req, reply) => {
  const serverUptime = Math.floor(process.uptime());
  const wakeUpStatus = wakeUpLastHeartbeat
    ? `在线（上次心跳: ${new Date(wakeUpLastHeartbeat).toLocaleString("zh-CN")}）`
    : "离线或未启动";

  const currentUrl = readEnvValue("TARGET_API_URL");
  const currentModel = readEnvValue("MODEL_NAME");
  const currentIcon = readEnvValue("CUSTOM_ICON_URL");
  const wakeConfig = {
    dayWakeAfter: readEnvValueOrDefault("DAY_WAKE_AFTER_MINUTES", "60"),
    nightWakeAfter: readEnvValueOrDefault("NIGHT_WAKE_AFTER_MINUTES", "120"),
    dayCheckInterval: readEnvValueOrDefault("DAY_CHECK_INTERVAL_MINUTES", "10"),
    nightCheckInterval: readEnvValueOrDefault("NIGHT_CHECK_INTERVAL_MINUTES", "120"),
    dayStartHour: readEnvValueOrDefault("WAKE_DAY_START_HOUR", "10"),
    dayEndHour: readEnvValueOrDefault("WAKE_DAY_END_HOUR", "24")
  };
  const weatherConfig = {
    enabled: readEnvValueOrDefault("WEATHER_ENABLED", "false"),
    locationName: readEnvValue("WEATHER_LOCATION_NAME"),
    lat: readEnvValue("WEATHER_LAT"),
    lon: readEnvValue("WEATHER_LON"),
    units: readEnvValueOrDefault("WEATHER_UNITS", "metric")
  };

  const authToken = Buffer.from(`${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`).toString("base64");

  const presets = loadPresets().map(({ target_key, ...preset }) => preset);
  const presetsJson = safeJsonForInlineScript(presets);
  const authHeaderJson = safeJsonForInlineScript(`Basic ${authToken}`);

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HEARTBEAT · Runtime</title>
  <!-- 引入思源宋体 -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: "Noto Serif SC", Georgia, "Times New Roman", serif;
      background: linear-gradient(135deg, #f8f0f3 0%, #f5e6eb 100%);
      background-image: 
        radial-gradient(circle at 20% 80%, rgba(230, 190, 200, 0.15) 0%, transparent 50%),
        radial-gradient(circle at 80% 20%, rgba(210, 170, 180, 0.1) 0%, transparent 50%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 30px 20px;
    }

    .container {
      max-width: 480px;
      width: 100%;
      background: rgba(255, 255, 255, 0.75);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 40px 32px;
      box-shadow: 
        0 2px 10px rgba(180, 120, 130, 0.05),
        0 15px 40px rgba(180, 120, 130, 0.15),
        0 0 0 1px rgba(255, 255, 255, 0.8) inset;
      transition: all 0.4s ease;
    }

    .container:hover {
      box-shadow: 
        0 2px 10px rgba(180, 120, 130, 0.08),
        0 20px 50px rgba(180, 120, 130, 0.2),
        0 0 0 1px rgba(255, 255, 255, 0.9) inset;
    }

    h2 {
      text-align: center;
      font-size: 32px;
      font-weight: 700;
      color: #8a4a58;
      margin-bottom: 4px;
      letter-spacing: 6px;
      font-family: "Times New Roman", "Georgia", "Noto Serif SC", serif;
      font-style: normal;
      text-transform: uppercase;
    }

    .subtitle {
      text-align: center;
      font-size: 12px;
      color: #a87a85;
      margin-bottom: 32px;
      letter-spacing: 4px;
      text-transform: uppercase;
      font-style: italic;
      opacity: 0.85;
    }

    .status {
      background: rgba(255, 250, 252, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 14px;
      padding: 16px 20px;
      margin-bottom: 24px;
      border: 1px solid rgba(230, 200, 208, 0.4);
    }

    .status p {
      margin: 6px 0;
      font-size: 13px;
      color: #6d5057;
      font-weight: 400;
      line-height: 1.5;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .status strong {
      color: #8a4a58;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    label {
      display: block;
      margin-top: 16px;
      font-weight: 500;
      font-size: 11px;
      color: #8b6b72;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    input {
      width: 100%;
      padding: 10px 14px;
      margin-top: 6px;
      border: 1px solid rgba(200, 160, 170, 0.3);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.7);
      font-family: "Noto Serif SC", serif;
      font-size: 13px;
      color: #5a4046;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }

    input:focus {
      outline: none;
      border-color: #c89aa6;
      box-shadow: 0 0 0 3px rgba(200, 154, 166, 0.1);
      background: rgba(255, 255, 255, 0.95);
      transform: translateY(-1px);
    }

    input::placeholder {
      color: #b8a0a6;
      font-style: italic;
      font-size: 12px;
    }

    select {
      width: 100%;
      padding: 10px 14px;
      margin-top: 6px;
      border: 1px solid rgba(200, 160, 170, 0.3);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.7);
      font-family: "Noto Serif SC", serif;
      font-size: 13px;
      color: #5a4046;
    }

    button {
      width: 100%;
      margin-top: 16px;
      padding: 12px;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      letter-spacing: 1.5px;
      font-family: "Noto Serif SC", serif;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      text-transform: uppercase;
    }

    button.save {
      background: linear-gradient(135deg, #d8a0ad 0%, #c8909d 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(180, 120, 130, 0.2);
    }

    button.save:hover {
      background: linear-gradient(135deg, #c8909d 0%, #b8808d 100%);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(180, 120, 130, 0.3);
    }

    button.save:active {
      transform: translateY(0);
      box-shadow: 0 2px 8px rgba(180, 120, 130, 0.2);
    }

    button.restart {
      background: linear-gradient(135deg, #e8909d 0%, #d8808d 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(200, 100, 120, 0.25);
      margin-top: 28px;
    }

    button.restart:hover {
      background: linear-gradient(135deg, #d8808d 0%, #c8707d 100%);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(200, 100, 120, 0.35);
    }

    button.restart:active {
      transform: translateY(0);
      box-shadow: 0 2px 8px rgba(200, 100, 120, 0.25);
    }

    .note {
      margin-top: 16px;
      font-size: 10px;
      color: #a88a92;
      text-align: center;
      font-style: italic;
      letter-spacing: 1px;
      opacity: 0.7;
    }

    /* 预设区域 */
    .presets-box {
      background: rgba(255, 250, 252, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
      border: 1px solid rgba(230, 200, 208, 0.3);
    }

    .presets-box h3 {
      margin: 0 0 14px 0;
      font-size: 12px;
      color: #8a4a58;
      font-weight: 500;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    .preset-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }

    .preset-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .preset-btn {
      flex: 1;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      border: 1px solid rgba(220, 180, 190, 0.3);
      border-radius: 10px;
      text-align: left;
      font-size: 13px;
      color: #6d5057;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      font-family: "Noto Serif SC", serif;
    }

    .preset-btn:hover {
      background: rgba(255, 245, 248, 0.9);
      border-color: #c89aa6;
      box-shadow: 0 4px 12px rgba(180, 120, 130, 0.15);
      transform: translateY(-1px);
    }

    .preset-btn span {
      color: #9a7a82;
      font-size: 11px;
      margin-left: 8px;
      font-style: italic;
    }

    .preset-del {
      padding: 8px 12px;
      background: rgba(255, 240, 243, 0.6);
      border: 1px solid rgba(240, 200, 210, 0.4);
      border-radius: 8px;
      font-size: 11px;
      color: #a85a68;
      cursor: pointer;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .preset-del:hover {
      background: rgba(255, 230, 235, 0.8);
      border-color: #e8a0b0;
      color: #9a4a58;
    }

    .add-preset {
      border-top: 1px solid rgba(220, 180, 190, 0.3);
      padding-top: 16px;
    }

    .add-preset strong {
      font-size: 11px;
      color: #8a4a58;
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    .add-preset input {
      margin-top: 6px;
      background: rgba(255, 255, 255, 0.8);
    }

    .add-preset button {
      background: linear-gradient(135deg, #c89aa6 0%, #b88a96 100%);
      color: white;
      box-shadow: 0 4px 10px rgba(160, 100, 110, 0.2);
      font-size: 12px;
      padding: 10px;
    }

    .add-preset button:hover {
      background: linear-gradient(135deg, #b88a96 0%, #a87a86 100%);
    }

    .config-box {
      background: rgba(255, 250, 252, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 16px;
      padding: 20px;
      border: 1px solid rgba(230, 200, 208, 0.3);
    }

    .section-title {
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid rgba(220, 180, 190, 0.3);
      font-size: 12px;
      color: #8a4a58;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .hint {
      margin-top: 8px;
      font-size: 11px;
      color: #9a7a82;
      line-height: 1.6;
    }

    /* 加载动画 */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .container {
      animation: fadeIn 0.6s ease-out;
    }

    .status, .presets-box, .config-box {
      animation: fadeIn 0.8s ease-out;
    }

    .restart {
      animation: fadeIn 1s ease-out;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>HEARTBEAT</h2>
    <div class="subtitle">Runtime · AI Residency</div>

    <div class="status">
      <p>Gateway <strong>运行中 (${serverUptime}秒)</strong></p>
      <p>Auto Wakeup <strong>${wakeUpStatus}</strong></p>
    </div>

    <!-- 预设方案 -->
    <div class="presets-box">
      <h3>预设方案</h3>
      <div class="preset-list" id="presetList"></div>
      <div class="add-preset">
        <strong>保存当前配置为新预设</strong>
        <input id="presetName" placeholder="预设名称，例如：DeepSeek / Claude">
        <button onclick="savePreset()">保存为预设</button>
      </div>
    </div>

    <!-- 配置表单 -->
    <div class="config-box">
      <form id="configForm" onsubmit="saveConfig(event)">
        <label>API URL</label>
        <input name="target_url" id="f_url" value="${escapeHtml(currentUrl)}">
        <label>API Key</label>
        <input name="target_key" id="f_key" placeholder="留空不修改">
        <label>Model Name</label>
        <input name="model_name" id="f_model" value="${escapeHtml(currentModel)}">
        <label>Bark Key</label>
        <input name="bark_key" id="f_bark" placeholder="留空不修改">
        <label>Bark Icon URL</label>
        <input name="custom_icon" id="f_icon" value="${escapeHtml(currentIcon)}" placeholder="可选">

        <div class="section-title">Wake Settings</div>
        <div class="grid-2">
          <div>
            <label>白天多久未回复后唤醒（分钟）</label>
            <input type="number" min="1" name="day_wake_after" id="f_day_wake_after" value="${escapeHtml(wakeConfig.dayWakeAfter)}">
          </div>
          <div>
            <label>夜间多久未回复后唤醒（分钟）</label>
            <input type="number" min="1" name="night_wake_after" id="f_night_wake_after" value="${escapeHtml(wakeConfig.nightWakeAfter)}">
          </div>
          <div>
            <label>白天检查间隔（分钟）</label>
            <input type="number" min="1" name="day_check_interval" id="f_day_check_interval" value="${escapeHtml(wakeConfig.dayCheckInterval)}">
          </div>
          <div>
            <label>夜间检查间隔（分钟）</label>
            <input type="number" min="1" name="night_check_interval" id="f_night_check_interval" value="${escapeHtml(wakeConfig.nightCheckInterval)}">
          </div>
          <div>
            <label>白天开始小时</label>
            <input type="number" min="0" max="23" name="wake_day_start_hour" id="f_wake_day_start_hour" value="${escapeHtml(wakeConfig.dayStartHour)}">
          </div>
          <div>
            <label>白天结束小时</label>
            <input type="number" min="1" max="24" name="wake_day_end_hour" id="f_wake_day_end_hour" value="${escapeHtml(wakeConfig.dayEndHour)}">
          </div>
        </div>

        <div class="section-title">Weather</div>
        <label>天气注入</label>
        <select name="weather_enabled" id="f_weather_enabled">
          <option value="false" ${weatherConfig.enabled === "true" ? "" : "selected"}>关闭</option>
          <option value="true" ${weatherConfig.enabled === "true" ? "selected" : ""}>开启</option>
        </select>
        <label>位置名称</label>
        <input name="weather_location_name" id="f_weather_location_name" value="${escapeHtml(weatherConfig.locationName)}" placeholder="例如：London">
        <div class="grid-2">
          <div>
            <label>纬度 Latitude</label>
            <input name="weather_lat" id="f_weather_lat" value="${escapeHtml(weatherConfig.lat)}" placeholder="例如：51.5072">
          </div>
          <div>
            <label>经度 Longitude</label>
            <input name="weather_lon" id="f_weather_lon" value="${escapeHtml(weatherConfig.lon)}" placeholder="例如：-0.1276">
          </div>
        </div>
        <label>单位</label>
        <select name="weather_units" id="f_weather_units">
          <option value="metric" ${weatherConfig.units === "fahrenheit" ? "" : "selected"}>摄氏度 / km/h</option>
          <option value="fahrenheit" ${weatherConfig.units === "fahrenheit" ? "selected" : ""}>华氏度 / mph</option>
        </select>
        <div class="hint">天气使用 Open-Meteo 免费接口，不需要 API Key；只有开启后才会按你填写的经纬度读取天气。</div>
        <button type="submit" class="save">保存配置</button>
      </form>
    </div>

    <button onclick="restartServices()" class="restart">一键重启所有服务</button>
    <div class="note">修改配置后先保存，再点重启按钮生效</div>
  </div>

  <script>
    // ====== 以下脚本保持不变 ======
    const AUTH_HEADER = ${authHeaderJson};
    let presets = ${presetsJson};

    function escapeHtmlText(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function renderPresets() {
      const list = document.getElementById("presetList");
      if (!presets.length) {
        list.innerHTML = '<div style="color:#aaa;font-size:12px;font-style:italic;">还没有预设，保存当前配置即可创建。</div>';
        return;
      }
      list.innerHTML = presets.map((p, idx) => {
        return '<div class="preset-item">' +
          '<button class="preset-btn" onclick="applyPreset(' + idx + ')">' + escapeHtmlText(p.name) + '<span>' + escapeHtmlText(p.model_name) + '</span></button>' +
          '<button class="preset-del" onclick="deletePreset(' + idx + ')">删除</button>' +
        '</div>';
      }).join("");
    }

    function applyPreset(idx) {
      const p = presets[idx];
      document.getElementById("f_url").value = p.target_url || "";
      document.getElementById("f_model").value = p.model_name || "";
      if (p.target_key) document.getElementById("f_key").value = p.target_key;
      document.querySelector(".config-box").scrollIntoView({ behavior: "smooth" });
    }

    async function saveConfig(event) {
      event.preventDefault();
      const payload = {
        target_url: document.getElementById("f_url").value.trim(),
        target_key: document.getElementById("f_key").value.trim(),
        model_name: document.getElementById("f_model").value.trim(),
        bark_key: document.getElementById("f_bark").value.trim(),
        custom_icon: document.getElementById("f_icon").value.trim(),
        day_wake_after: document.getElementById("f_day_wake_after").value.trim(),
        night_wake_after: document.getElementById("f_night_wake_after").value.trim(),
        day_check_interval: document.getElementById("f_day_check_interval").value.trim(),
        night_check_interval: document.getElementById("f_night_check_interval").value.trim(),
        wake_day_start_hour: document.getElementById("f_wake_day_start_hour").value.trim(),
        wake_day_end_hour: document.getElementById("f_wake_day_end_hour").value.trim(),
        weather_enabled: document.getElementById("f_weather_enabled").value,
        weather_location_name: document.getElementById("f_weather_location_name").value.trim(),
        weather_lat: document.getElementById("f_weather_lat").value.trim(),
        weather_lon: document.getElementById("f_weather_lon").value.trim(),
        weather_units: document.getElementById("f_weather_units").value
      };

      if (!payload.target_url || !payload.model_name) {
        alert("请填写 API 地址和模型名称");
        return;
      }

      try {
        const resp = await fetch("/admin/save", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": AUTH_HEADER },
          body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (result.success) {
          document.getElementById("f_key").value = "";
          document.getElementById("f_bark").value = "";
          alert("配置已保存，现在可以点击重启按钮让新配置生效。");
        } else {
          alert("保存失败：" + (result.error || "未知错误"));
        }
      } catch (e) {
        alert("请求失败：" + e.message);
      }
    }

    async function savePreset() {
      const name = document.getElementById("presetName").value.trim();
      const target_url = document.getElementById("f_url").value.trim();
      const target_key = document.getElementById("f_key").value.trim();
      const model_name = document.getElementById("f_model").value.trim();
      if (!name) { alert("请填写预设名称"); return; }
      if (!target_url || !model_name) { alert("请先填写 API 地址和模型名称"); return; }

      const resp = await fetch("/admin/presets/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": AUTH_HEADER },
        body: JSON.stringify({ name, target_url, target_key, model_name })
      });
      const r = await resp.json();
      if (r.success) {
        const existing = presets.findIndex(p => p.name === name);
        const entry = { name, target_url, target_key, model_name };
        if (existing >= 0) presets[existing] = entry;
        else presets.push(entry);
        renderPresets();
        document.getElementById("presetName").value = "";
        alert("预设已保存：" + name);
      } else {
        alert("保存失败：" + (r.error || "未知错误"));
      }
    }

    async function deletePreset(idx) {
      const p = presets[idx];
      if (!confirm("删除预设「" + p.name + "」？")) return;
      await fetch("/admin/presets/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": AUTH_HEADER },
        body: JSON.stringify({ name: p.name })
      });
      presets.splice(idx, 1);
      renderPresets();
    }

    async function restartServices() {
      if (!confirm("确定要重启 Gateway 和 wake_up 吗？")) return;
      try {
        const resp = await fetch("/admin/restart", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": AUTH_HEADER },
          body: "{}"
        });
        const result = await resp.json();
        if (result.success) {
          alert("重启成功！页面稍后自动刷新。");
          setTimeout(() => location.reload(), 3000);
        } else {
          alert("重启失败：" + (result.error || "未知错误"));
        }
      } catch (e) {
        alert("请求失败：" + e.message);
      }
    }

    renderPresets();
  </script>
</body>
</html>`;

  reply.type("text/html").send(html);
});
// ========================
// 管理保存 POST /admin/save
// ========================
app.post("/admin/save", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const {
      target_url,
      target_key,
      model_name,
      bark_key,
      custom_icon,
      day_wake_after,
      night_wake_after,
      day_check_interval,
      night_check_interval,
      wake_day_start_hour,
      wake_day_end_hour,
      weather_enabled,
      weather_location_name,
      weather_lat,
      weather_lon,
      weather_units
    } = req.body || {};

    if (!target_url || !model_name) {
      return reply.code(400).send({ error: "target_url / model_name 必填" });
    }

    const finalTargetKey = target_key || readEnvValue("TARGET_API_KEY");
    const finalBarkKey = bark_key || readEnvValue("BARK_KEY");

    // 批注 2026-06-26：公开版把唤醒策略和天气信息开放到管理页；保存时做轻量校验，避免空值把运行中的唤醒节奏写坏。
    writeEnvUpdates({
      TARGET_API_URL: target_url,
      TARGET_API_KEY: finalTargetKey,
      MODEL_NAME: model_name,
      BARK_KEY: finalBarkKey,
      CUSTOM_ICON_URL: custom_icon || "",
      DAY_WAKE_AFTER_MINUTES: normalizePositiveInteger(day_wake_after, "DAY_WAKE_AFTER_MINUTES", "60"),
      NIGHT_WAKE_AFTER_MINUTES: normalizePositiveInteger(night_wake_after, "NIGHT_WAKE_AFTER_MINUTES", "120"),
      DAY_CHECK_INTERVAL_MINUTES: normalizePositiveInteger(day_check_interval, "DAY_CHECK_INTERVAL_MINUTES", "10"),
      NIGHT_CHECK_INTERVAL_MINUTES: normalizePositiveInteger(night_check_interval, "NIGHT_CHECK_INTERVAL_MINUTES", "120"),
      WAKE_DAY_START_HOUR: normalizeHour(wake_day_start_hour, "WAKE_DAY_START_HOUR", "10", 0, 23),
      WAKE_DAY_END_HOUR: normalizeHour(wake_day_end_hour, "WAKE_DAY_END_HOUR", "24", 1, 24),
      WEATHER_ENABLED: normalizeBooleanString(weather_enabled, "WEATHER_ENABLED", "false"),
      WEATHER_LOCATION_NAME: weather_location_name || "",
      WEATHER_LAT: weather_lat || "",
      WEATHER_LON: weather_lon || "",
      WEATHER_UNITS: normalizeWeatherUnits(weather_units),
      ADMIN_USER: readEnvValue("ADMIN_USER"),
      ADMIN_PASSWORD: readEnvValue("ADMIN_PASSWORD")
    });
    console.log("\n✅ .env 已更新，可通过管理页重启服务\n");

    if (wantsJsonResponse(req)) {
      return reply.send({ success: true });
    }

    reply.type("text/html").send(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>已保存</title></head>
<body style="text-align:center;font-family:-apple-system,sans-serif;padding:40px;">
  <h2>✅ 配置已保存</h2>
  <p>现在可以返回管理页，点击重启按钮让新配置生效。</p>
  <a href="/admin">← 返回设置</a>
</body></html>`);
  } catch (err) {
    console.error(err);
    reply.code(500).send({ error: err.message });
  }
});

// ========================
// 保存预设方案
// ========================
app.post("/admin/presets/save", { preHandler: basicAuth }, async (req, reply) => {
  const { name, target_url, target_key, model_name } = req.body || {};
  if (!name || !target_url || !model_name) {
    return reply.code(400).send({ error: "name / target_url / model_name 必填" });
  }
  const presets = loadPresets();
  const existing = presets.findIndex(p => p.name === name);
  const entry = { name, target_url, target_key: target_key || "", model_name };
  if (existing >= 0) presets[existing] = entry;
  else presets.push(entry);
  savePresets(presets);
  reply.send({ success: true });
});

// ========================
// 删除预设方案
// ========================
app.post("/admin/presets/delete", { preHandler: basicAuth }, async (req, reply) => {
  const { name } = req.body || {};
  const presets = loadPresets().filter(p => p.name !== name);
  savePresets(presets);
  reply.send({ success: true });
});

// ========================
// 心跳接口
// ========================
app.post("/internal/heartbeat", async (req, reply) => {
  wakeUpLastHeartbeat = Date.now();
  reply.send({ status: "ok" });
});

// ========================
// 管理页一键重启
// ========================
app.post("/admin/restart", { preHandler: basicAuth }, async (req, reply) => {
  const restartCommand = readRestartCommand();

  // 立即回复，避免重启时连接中断
  reply.send({ success: true, output: `重启指令已发送：${restartCommand}` });
  
  // 稍后重启。默认只重启本项目的两个进程；可通过 RESTART_COMMAND 自定义。
  const { exec } = require("child_process");
  exec(restartCommand, (err, stdout, stderr) => {
    if (err) {
      console.error("重启失败:", stderr);
    } else {
      console.log("服务已重启:", stdout);
    }
  });
});

// ========================
// 测试 Bark
// ========================
app.get("/test-bark", async (req, reply) => {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const formattedTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  appendSpecialEvent(`（${formattedTime} 刚刚给用户发了 Bark：这是一条测试推送。）`);
  reply.send({ success: true });
});

// ========================
// 启动服务
// ========================
if (require.main === module) {
  app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`✅ Gateway 运行在 ${address}`);
  });
}

module.exports = {
  app,
  aiTaskRunner,
  latestUserContentOf,
  memoryQueryOf,
  extractTimestampWithMemory,
  selectTimelineContextEvents,
  buildTimelineEventContext,
  buildStickerInstructionContext,
  assertLastUserMessagePreserved
};
