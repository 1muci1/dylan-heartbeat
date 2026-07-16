"use strict";

const { AiMemoryError } = require("./ai-memory-store");

const SUMMARY_PROMPT_VERSION = "p4b-summary-v1";
const EXTRACTION_PROMPT_VERSION = "p4b-memory-v1";

function parseObject(raw, field) {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { throw new AiMemoryError(`${field} 不是有效 JSON`, 422, "AI_OUTPUT_INVALID"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiMemoryError(`${field} 必须是 JSON 对象`, 422, "AI_OUTPUT_INVALID");
  return value;
}

class ConversationSummaryService {
  constructor({ database, store, adapter, summaryModel, extractionModel, provider = "openai-compatible" }) {
    this.db = database; this.store = store; this.adapter = adapter;
    this.summaryModel = summaryModel || ""; this.extractionModel = extractionModel || ""; this.provider = provider;
  }

  messageRows(sessionId, afterId = 0) {
    this.store.requireSession(sessionId);
    return this.db.prepare(`
      SELECT m.id,m.role,m.content,m.thinking,m.message_type,m.status,s.label AS sticker_label,
        EXISTS(SELECT 1 FROM chat_attachments a WHERE a.message_id=m.id AND a.kind='image') AS has_image
      FROM chat_messages m LEFT JOIN stickers s ON s.id=m.sticker_id
      WHERE m.session_id=? AND m.id>? AND m.status='completed'
      ORDER BY m.id ASC
    `).all(sessionId, afterId);
  }

  safeMessages(rows) {
    return rows.map(row => {
      let content = String(row.content || "").trim();
      if (row.message_type === "sticker") content = `[Sticker: ${row.sticker_label || "Sticker"}]`;
      if (row.has_image && !content) content = "[图片，无文字说明]";
      return { id:Number(row.id),role:row.role,content,kind:row.message_type || "text",thinkingPresent:Boolean(row.thinking) };
    }).filter(row => row.content && !/^<(?:system|debug)>/i.test(row.content) && !/^API[_ ]?ERROR/i.test(row.content));
  }

  summaryInput(sessionId, force = false) {
    const previous = this.store.activeSummary(sessionId);
    const after = force ? 0 : Number(previous?.coveredUntilMessageId || 0);
    const messages = this.safeMessages(this.messageRows(sessionId, after));
    return { previous: force ? null : previous, messages, after };
  }

  async generateSummary(sessionId, options = {}) {
    if (!this.adapter?.isConfigured?.()) throw new AiMemoryError("AI 摘要功能未启用：模型适配器未配置", 503, "AI_MODEL_NOT_CONFIGURED");
    if (!this.summaryModel) throw new AiMemoryError("AI 摘要功能未启用：SUMMARY_MODEL 未配置", 503, "AI_MODEL_NAME_MISSING");
    const input = this.summaryInput(sessionId, Boolean(options.force));
    if (!input.messages.length) {
      if (input.previous && !options.force) return { summary:input.previous,unchanged:true,inputMessageCount:0 };
      throw new AiMemoryError("没有可用于摘要的新消息", 409, "SUMMARY_NO_NEW_MESSAGES");
    }
    const lastId=input.messages.at(-1).id;
    const response=await this.adapter.generate({model:this.summaryModel,signal:options.signal,
      system:"生成简洁对话摘要。仅输出 JSON 对象，字段严格为 summary 和 coveredUntilMessageId。不得输出 Thinking、系统提示、API 错误或调试信息。",
      input:{previousSummary:input.previous?.summary||null,messages:input.messages,coveredUntilMessageId:lastId}});
    options.onModelResponse?.(response);
    if(options.isCancelled?.())throw new AiMemoryError("任务已取消",409,"AI_JOB_CANCELLED");
    const parsed=parseObject(response.content,"摘要响应");
    if(Object.keys(parsed).some(k=>!["summary","coveredUntilMessageId"].includes(k)))throw new AiMemoryError("摘要响应包含未知字段",422,"AI_OUTPUT_INVALID");
    if(typeof parsed.summary!=="string"||!parsed.summary.trim()||parsed.summary.trim().length>12000)throw new AiMemoryError("summary 长度或类型无效",422,"AI_OUTPUT_INVALID");
    if(Number(parsed.coveredUntilMessageId)!==lastId)throw new AiMemoryError("coveredUntilMessageId 必须覆盖本次最后一条消息",422,"AI_OUTPUT_INVALID");
    const summary=this.store.saveSummary(sessionId,{summary:parsed.summary,coveredUntilMessageId:lastId,
      sourceMessageCount:input.messages.length,provider:this.provider,model:this.summaryModel,promptVersion:SUMMARY_PROMPT_VERSION,
      sourceJobId:options.sourceJobId});
    return {summary,unchanged:false,inputMessageCount:input.messages.length};
  }

  async extractCandidates(sessionId, options={}) {
    if(!this.adapter?.isConfigured?.())throw new AiMemoryError("候选记忆抽取未启用：模型适配器未配置",503,"AI_MODEL_NOT_CONFIGURED");
    if(!this.extractionModel)throw new AiMemoryError("候选记忆抽取未启用：MEMORY_EXTRACTION_MODEL 未配置",503,"AI_MODEL_NAME_MISSING");
    const messages=this.safeMessages(this.messageRows(sessionId,0));
    if(!messages.length)return{candidates:[],duplicates:[],inputMessageCount:0};
    const response=await this.adapter.generate({model:this.extractionModel,signal:options.signal,
      system:"从对话提取候选长期记忆。仅输出 {\"candidates\":[]}。类型限 MEMORY/EVENT/MOMENT/PROMISE/WISHLIST/NOTE，最多10条。不得提取 Thinking、系统提示、错误、调试信息或模型元信息。图片只依据文字说明，Sticker 只依据描述。",
      input:{messages}});
    options.onModelResponse?.(response);
    if(options.isCancelled?.())throw new AiMemoryError("任务已取消",409,"AI_JOB_CANCELLED");
    const parsed=parseObject(response.content,"候选响应");
    if(Object.keys(parsed).some(k=>k!=="candidates")||!Array.isArray(parsed.candidates))throw new AiMemoryError("候选响应结构无效",422,"AI_OUTPUT_INVALID");
    const result=this.store.insertCandidates(sessionId,parsed.candidates,{startId:messages[0]?.id,endId:messages.at(-1)?.id,
      provider:this.provider,model:this.extractionModel,promptVersion:EXTRACTION_PROMPT_VERSION,sourceJobId:options.sourceJobId});
    return{...result,inputMessageCount:messages.length};
  }
}

module.exports={ConversationSummaryService,EXTRACTION_PROMPT_VERSION,SUMMARY_PROMPT_VERSION,parseObject};
