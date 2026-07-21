"use strict";

const crypto = require("node:crypto");
const { MEMORY_TYPES, hashContent, isoDate } = require("./structured-memory-store");

const CANDIDATE_STATUSES = new Set(["pending", "approved", "rejected", "duplicate", "deleted"]);
const JOB_STATUSES = new Set(["queued", "running", "completed", "failed", "cancelled"]);
const JOB_TYPES = new Set(["session_summary", "memory_extraction", "proactive_response"]);
const MAX_TITLE = 200;
const MAX_CONTENT = 20000;
const MAX_REASON = 2000;

class AiMemoryError extends Error {
  constructor(message, statusCode = 400, code = "AI_MEMORY_ERROR") {
    super(message);
    this.name = "AiMemoryError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, field, max, nullable = false) {
  if (value == null || value === "") {
    if (nullable) return null;
    throw new AiMemoryError(`${field} 不能为空`);
  }
  if (typeof value !== "string") throw new AiMemoryError(`${field} 必须是字符串`);
  const text = value.trim();
  if (!text && !nullable) throw new AiMemoryError(`${field} 不能为空`);
  if (text.length > max) throw new AiMemoryError(`${field} 不能超过 ${max} 字符`, 422, "AI_OUTPUT_INVALID");
  return text || null;
}

function candidateType(value) {
  const type = String(value || "").toUpperCase();
  if (!MEMORY_TYPES.has(type)) throw new AiMemoryError("候选记忆类型无效", 422, "AI_OUTPUT_INVALID");
  return type;
}

function candidateImportance(value) {
  const number = Number(value ?? 3);
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new AiMemoryError("importance 必须是 1 到 5", 422, "AI_OUTPUT_INVALID");
  return number;
}

function candidateConfidence(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new AiMemoryError("confidence 必须是 0 到 1", 422, "AI_OUTPUT_INVALID");
  return number;
}

function publicCandidate(row) {
  return {
    id: row.id, sessionId: row.session_id, sourceMessageStartId: row.source_message_start_id,
    sourceMessageEndId: row.source_message_end_id, type: row.type, title: row.title,
    content: row.content, occurredAt: row.occurred_at, importance: Number(row.importance),
    confidence: row.confidence == null ? null : Number(row.confidence), reason: row.reason,
    status: row.status, approvedMemoryId: row.approved_memory_id, modelProvider: row.model_provider,
    modelName: row.model_name, promptVersion: row.prompt_version, createdAt: row.created_at,
    sourceJobId: row.source_job_id,
    reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by, deletedAt: row.deleted_at
  };
}

function publicSummary(row) {
  return row ? { id: row.id, sessionId: row.session_id, summary: row.summary,
    coveredUntilMessageId: row.covered_until_message_id, sourceMessageCount: Number(row.source_message_count),
    status: row.status, modelProvider: row.model_provider, modelName: row.model_name,
    promptVersion: row.prompt_version, sourceJobId: row.source_job_id, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

function publicJob(row) {
  return { id: row.id, jobType: row.job_type, sessionId: row.session_id, status: row.status,
    inputMessageCount: Number(row.input_message_count), attemptCount: Number(row.attempt_count),
    provider: row.provider, model: row.model, startedAt: row.started_at, completedAt: row.completed_at,
    errorCode: row.error_code, errorMessage: row.error_message, createdAt: row.created_at };
}

class AiMemoryStore {
  constructor({ database, memoryStore, eventStore = null, logger = null }) {
    if (!database || !memoryStore) throw new TypeError("database 和 memoryStore 必填");
    this.db = database;
    this.memoryStore = memoryStore;
    this.eventStore = eventStore;
    this.logger = logger;
  }

  recordJobEvent(input) {
    if (!this.eventStore) return null;
    try {
      return this.eventStore.create(input, { source: "ai-memory-store" });
    } catch (error) {
      this.logger?.error?.({ errorCode: error.code, eventType: input.eventType, subjectId: input.subjectId }, "AI Job Event 写入失败");
      return null;
    }
  }

  recordCandidateEvent(input) {
    if (!this.eventStore) return null;
    try {
      return this.eventStore.create(input, { source: "memory-candidate" });
    } catch (error) {
      this.logger?.error?.({ errorCode: error.code, eventType: input.eventType, subjectId: input.subjectId }, "Memory Candidate Event 写入失败");
      return null;
    }
  }

  requireSession(id) {
    const row = this.db.prepare("SELECT id FROM chat_sessions WHERE id=?").get(String(id));
    if (!row) throw new AiMemoryError("Session 不存在", 404, "SESSION_NOT_FOUND");
    return row.id;
  }

  activeSummary(sessionId) {
    this.requireSession(sessionId);
    return publicSummary(this.db.prepare("SELECT * FROM session_summaries WHERE session_id=? AND status='active' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1").get(sessionId));
  }

  saveSummary(sessionId, value) {
    this.requireSession(sessionId);
    const summary = cleanText(value.summary, "summary", 12000);
    const covered = Number(value.coveredUntilMessageId);
    if (!Number.isSafeInteger(covered) || covered < 1) throw new AiMemoryError("coveredUntilMessageId 无效", 422, "AI_OUTPUT_INVALID");
    const message = this.db.prepare("SELECT id FROM chat_messages WHERE id=? AND session_id=?").get(covered, sessionId);
    if (!message) throw new AiMemoryError("摘要覆盖消息不属于该 Session", 422, "AI_OUTPUT_INVALID");
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE session_summaries SET status='superseded',updated_at=? WHERE session_id=? AND status='active'").run(now, sessionId);
      this.db.prepare(`INSERT INTO session_summaries
        (id,session_id,summary,covered_until_message_id,source_message_count,status,model_provider,model_name,prompt_version,source_job_id,created_at,updated_at)
        VALUES (?,?,?,?,?,'active',?,?,?,?,?,?)`).run(id, sessionId, summary, covered, Number(value.sourceMessageCount || 0),
          value.provider || null, value.model || null, value.promptVersion || null, value.sourceJobId || null, now, now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.activeSummary(sessionId);
  }

  deleteSummary(sessionId) {
    this.requireSession(sessionId);
    const now = new Date().toISOString();
    const result = this.db.prepare("UPDATE session_summaries SET status='deleted',deleted_at=?,updated_at=? WHERE session_id=? AND status='active'").run(now, now, sessionId);
    if (!result.changes) throw new AiMemoryError("当前摘要不存在", 404, "SUMMARY_NOT_FOUND");
    return { sessionId, status: "deleted" };
  }

  validateCandidate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AiMemoryError("候选格式无效", 422, "AI_OUTPUT_INVALID");
    const allowed = new Set(["type","title","content","occurredAt","importance","confidence","reason","id","sessionId",
      "sourceMessageStartId","sourceMessageEndId","status","approvedMemoryId","modelProvider","modelName","promptVersion",
      "sourceJobId","createdAt","reviewedAt","reviewedBy","deletedAt"]);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new AiMemoryError("候选包含未知字段", 422, "AI_OUTPUT_INVALID");
    const content = cleanText(input.content, "content", MAX_CONTENT);
    let occurredAt = null;
    try { occurredAt = isoDate(input.occurredAt, "occurredAt"); }
    catch { throw new AiMemoryError("occurredAt 格式无效", 422, "AI_OUTPUT_INVALID"); }
    return { type: candidateType(input.type), title: cleanText(input.title, "title", MAX_TITLE, true), content,
      occurredAt, importance: candidateImportance(input.importance),
      confidence: candidateConfidence(input.confidence), reason: cleanText(input.reason, "reason", MAX_REASON, true),
      contentHash: hashContent(content) };
  }

  insertCandidates(sessionId, inputs, metadata = {}) {
    this.requireSession(sessionId);
    if (!Array.isArray(inputs)) throw new AiMemoryError("candidates 必须是数组", 422, "AI_OUTPUT_INVALID");
    if (inputs.length > 10) throw new AiMemoryError("每次最多返回 10 条候选", 422, "AI_OUTPUT_INVALID");
    const values = inputs.map(input => this.validateCandidate(input));
    const created = [], duplicates = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of values) {
        const memory = this.db.prepare("SELECT id FROM memory_items WHERE content_hash=?").get(item.contentHash);
        const candidate = this.db.prepare("SELECT id FROM memory_candidates WHERE content_hash=? AND status IN ('pending','approved') AND deleted_at IS NULL").get(item.contentHash);
        if (memory || candidate || created.some(row => row.contentHash === item.contentHash)) {
          duplicates.push({ contentHash: item.contentHash, memoryId: memory?.id || null, candidateId: candidate?.id || null });
          continue;
        }
        const id = crypto.randomUUID(), now = new Date().toISOString();
        this.db.prepare(`INSERT INTO memory_candidates
          (id,session_id,source_message_start_id,source_message_end_id,type,title,content,occurred_at,importance,confidence,reason,status,content_hash,model_provider,model_name,prompt_version,source_job_id,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?)`).run(id, sessionId, metadata.startId || null, metadata.endId || null,
          item.type, item.title, item.content, item.occurredAt, item.importance, item.confidence, item.reason,
          item.contentHash, metadata.provider || null, metadata.model || null, metadata.promptVersion || null, metadata.sourceJobId || null, now);
        created.push({ id, contentHash: item.contentHash });
        this.recordCandidateEvent({eventType:"memory_candidate.created",subjectType:"memory_candidate",subjectId:id,
          payload:{type:item.type,importance:item.importance},dedupeKey:`memory-candidate:${id}:created`,occurredAt:now});
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { candidates: created.map(item => this.getCandidate(item.id)), duplicates };
  }

  getCandidate(id, includeDeleted = true) {
    const row = this.db.prepare(`SELECT * FROM memory_candidates WHERE id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`).get(String(id));
    if (!row) throw new AiMemoryError("候选记忆不存在", 404, "CANDIDATE_NOT_FOUND");
    return publicCandidate(row);
  }

  listCandidates(query = {}) {
    const page = Number(query.page || 1), limit = Number(query.limit || 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AiMemoryError("分页参数无效");
    const where = [], params = [];
    if (query.status) { const status = String(query.status); if (!CANDIDATE_STATUSES.has(status)) throw new AiMemoryError("status 无效"); where.push("status=?"); params.push(status); }
    else where.push("deleted_at IS NULL");
    if (query.type) { where.push("type=?"); params.push(candidateType(query.type)); }
    if (query.sessionId) { where.push("session_id=?"); params.push(String(query.sessionId)); }
    if (query.keyword) { const k=String(query.keyword).trim().slice(0,200).replace(/[\\%_]/g,m=>`\\${m}`); where.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')"); params.push(`%${k}%`,`%${k}%`); }
    const orders={newest:"created_at DESC,id DESC",oldest:"created_at ASC,id ASC",confidence:"confidence DESC,created_at DESC"};
    const order=orders[query.sort||"newest"];if(!order)throw new AiMemoryError("sort 无效");
    const sql=where.length?`WHERE ${where.join(" AND ")}`:"";
    const total=Number(this.db.prepare(`SELECT COUNT(*) n FROM memory_candidates ${sql}`).get(...params).n);
    const rows=this.db.prepare(`SELECT * FROM memory_candidates ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit);
    return { items:rows.map(publicCandidate),meta:{page,limit,total,totalPages:Math.ceil(total/limit)} };
  }

  approveCandidate(id, edits = {}, reviewer = "user") {
    const current = this.getCandidate(id);
    if (current.status === "approved") throw new AiMemoryError("候选已经批准", 409, "CANDIDATE_ALREADY_APPROVED");
    if (current.status !== "pending") throw new AiMemoryError("只有 pending 候选可以批准", 409, "CANDIDATE_NOT_PENDING");
    const item = this.validateCandidate({ ...current, ...edits });
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT id FROM memory_items WHERE content_hash=?").get(item.contentHash);
      if (existing) {
        this.db.prepare("UPDATE memory_candidates SET status='duplicate',reviewed_at=?,reviewed_by=? WHERE id=?").run(now, reviewer, id);
        this.db.exec("COMMIT");
        return this.getCandidate(id);
      }
      const correlationId=crypto.randomUUID();
      const memory = this.memoryStore.create({ type:item.type,title:item.title,content:item.content,occurredAt:item.occurredAt,
        importance:item.importance,source:"ai-candidate",sourceSessionId:current.sessionId },{suppressEvent:true});
      this.db.prepare(`UPDATE memory_candidates SET type=?,title=?,content=?,occurred_at=?,importance=?,reason=?,content_hash=?,
        status='approved',approved_memory_id=?,reviewed_at=?,reviewed_by=? WHERE id=?`).run(item.type,item.title,item.content,item.occurredAt,
          item.importance,item.reason,item.contentHash,memory.id,now,reviewer,id);
      if(this.eventStore){
        this.db.exec("SAVEPOINT candidate_approval_events");
        try{
          this.eventStore.create({eventType:"memory.created",subjectType:"memory",subjectId:memory.id,
            payload:{type:memory.type,importance:memory.importance,source:memory.source},dedupeKey:`memory:${memory.id}:created`,
            correlationId,occurredAt:memory.createdAt},{source:"memory-candidate"});
          this.eventStore.create({eventType:"memory_candidate.approved",subjectType:"memory_candidate",subjectId:id,
            payload:{type:item.type,importance:item.importance,memoryId:memory.id},dedupeKey:`memory-candidate:${id}:approved`,
            correlationId,occurredAt:now},{source:"memory-candidate"});
          this.db.exec("RELEASE SAVEPOINT candidate_approval_events");
        }catch(error){
          this.db.exec("ROLLBACK TO SAVEPOINT candidate_approval_events");
          this.db.exec("RELEASE SAVEPOINT candidate_approval_events");
          this.logger?.error?.({errorCode:error.code,candidateId:id},"Candidate approve Event 写入失败");
        }
      }
      this.db.exec("COMMIT");
      return this.getCandidate(id);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  setCandidateStatus(id, action, reviewer = "user") {
    const current=this.getCandidate(id);const now=new Date().toISOString();
    if(action==="reject"&&current.status!=="pending")throw new AiMemoryError("只有 pending 候选可以拒绝",409,"CANDIDATE_NOT_PENDING");
    if(action==="reopen"&&!new Set(["rejected","duplicate"]).has(current.status))throw new AiMemoryError("只有 rejected/duplicate 候选可以重新打开",409,"CANDIDATE_NOT_REOPENABLE");
    const status=action==="reject"?"rejected":"pending";
    this.db.prepare("UPDATE memory_candidates SET status=?,reviewed_at=?,reviewed_by=?,deleted_at=NULL WHERE id=?").run(status,now,reviewer,id);
    const candidate=this.getCandidate(id);
    if(action==="reject")this.recordCandidateEvent({eventType:"memory_candidate.rejected",subjectType:"memory_candidate",subjectId:id,
      payload:{reasonCode:"USER_REJECTED"},dedupeKey:`memory-candidate:${id}:rejected`,occurredAt:now});
    return candidate;
  }

  deleteCandidate(id, reviewer="user") {
    this.getCandidate(id);const now=new Date().toISOString();
    this.db.prepare("UPDATE memory_candidates SET status='deleted',deleted_at=?,reviewed_at=?,reviewed_by=? WHERE id=?").run(now,now,reviewer,id);
    return this.getCandidate(id);
  }

  createJob(jobType, sessionId, inputCount, provider, model) {
    if(!JOB_TYPES.has(jobType))throw new AiMemoryError("jobType 无效");this.requireSession(sessionId);
    const existing=this.db.prepare("SELECT id FROM ai_jobs WHERE job_type=? AND session_id=? AND status IN ('queued','running')").get(jobType,sessionId);
    if(existing)throw new AiMemoryError("该 Session 已有同类型任务",409,"AI_JOB_CONFLICT");
    const id=crypto.randomUUID(),now=new Date().toISOString();
    this.db.prepare("INSERT INTO ai_jobs (id,job_type,session_id,status,input_message_count,provider,model,created_at) VALUES (?,?,?,'queued',?,?,?,?)")
      .run(id,jobType,sessionId,Number(inputCount||0),provider||null,model||null,now);
    const job=this.getJob(id);
    this.recordJobEvent({eventType:"ai_job.queued",subjectType:"ai_job",subjectId:job.id,
      payload:{jobType:job.jobType,status:"queued"},dedupeKey:`ai-job:${job.id}:queued`,occurredAt:job.createdAt});
    return job;
  }

  createProactiveJob(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AiMemoryError("主动任务输入无效", 422, "AI_JOB_INPUT_INVALID");
    const allowed = new Set(["eventId", "reasonCode", "candidateType"]);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new AiMemoryError("主动任务输入包含禁止字段", 422, "AI_JOB_INPUT_INVALID");
    const eventId = cleanText(input.eventId, "eventId", 200);
    const reasonCode = cleanText(input.reasonCode, "reasonCode", 100);
    const candidateType = cleanText(input.candidateType, "candidateType", 100);
    const id = crypto.randomUUID(), now = new Date().toISOString();
    this.db.prepare("INSERT INTO ai_jobs (id,job_type,session_id,status,input_message_count,provider,model,created_at) VALUES (?,'proactive_response',NULL,'queued',0,NULL,NULL,?)")
      .run(id, now);
    const job = this.getJob(id);
    this.recordJobEvent({ eventType: "ai_job.proactive_queued", subjectType: "ai_job", subjectId: job.id,
      payload: { jobType: "proactive_response", reasonCode }, dedupeKey: `ai-job:${job.id}:proactive-queued`, occurredAt: now });
    return Object.assign(job, { payload: { eventId, reasonCode, candidateType } });
  }

  getJob(id) { const row=this.db.prepare("SELECT * FROM ai_jobs WHERE id=?").get(String(id));if(!row)throw new AiMemoryError("AI Job 不存在",404,"AI_JOB_NOT_FOUND");return publicJob(row); }
  updateJob(id,status,values={}) { if(!JOB_STATUSES.has(status))throw new AiMemoryError("job status 无效");const now=new Date().toISOString();const result=this.db.prepare(`UPDATE ai_jobs SET status=?,attempt_count=COALESCE(?,attempt_count),started_at=COALESCE(?,started_at),completed_at=?,error_code=?,error_message=? WHERE id=?`).run(status,values.attemptCount??null,status==="running"?now:null,new Set(["completed","failed","cancelled"]).has(status)?now:null,values.errorCode||null,values.errorMessage?String(values.errorMessage).slice(0,500):null,id);if(!result.changes)throw new AiMemoryError("AI Job 不存在",404,"AI_JOB_NOT_FOUND");return this.getJob(id); }
  cancelJob(id) { const job=this.getJob(id);if(!new Set(["queued","running"]).has(job.status))throw new AiMemoryError("该任务不可取消",409,"AI_JOB_NOT_CANCELLABLE");const cancelled=this.updateJob(id,"cancelled");this.recordJobEvent({eventType:"ai_job.cancelled",subjectType:"ai_job",subjectId:cancelled.id,payload:{jobType:cancelled.jobType,previousStatus:job.status},dedupeKey:`ai-job:${cancelled.id}:cancelled`,occurredAt:cancelled.completedAt});return cancelled; }
  listJobs(query={}) { const page=Number(query.page||1),limit=Number(query.limit||20);if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)throw new AiMemoryError("分页参数无效");const where=[],params=[];if(query.jobType){if(!JOB_TYPES.has(query.jobType))throw new AiMemoryError("jobType 无效");where.push("job_type=?");params.push(query.jobType)}if(query.status){if(!JOB_STATUSES.has(query.status))throw new AiMemoryError("status 无效");where.push("status=?");params.push(query.status)}if(query.sessionId){where.push("session_id=?");params.push(String(query.sessionId))}const sql=where.length?`WHERE ${where.join(" AND ")}`:"";const total=Number(this.db.prepare(`SELECT COUNT(*) n FROM ai_jobs ${sql}`).get(...params).n);const rows=this.db.prepare(`SELECT * FROM ai_jobs ${sql} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit);return{items:rows.map(publicJob),meta:{page,limit,total,totalPages:Math.ceil(total/limit)}}; }
}

module.exports = { AiMemoryError, AiMemoryStore, CANDIDATE_STATUSES, JOB_STATUSES, JOB_TYPES, publicCandidate };
