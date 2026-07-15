"use strict";

const { AiMemoryError } = require("./ai-memory-store");

function bool(value) { return ["true","1","yes","on"].includes(String(value||"").trim().toLowerCase()); }
function integer(value,fallback,min=1,max=Number.MAX_SAFE_INTEGER){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}

function readAiConfig(env=process.env){return{
  automationEnabled:bool(env.AI_AUTOMATION_ENABLED),summaryEnabled:bool(env.SESSION_AUTO_SUMMARY_ENABLED),
  extractionEnabled:bool(env.MEMORY_AUTO_EXTRACTION_ENABLED),summaryThreshold:integer(env.SUMMARY_MESSAGE_THRESHOLD,40),
  summaryNewThreshold:integer(env.SUMMARY_NEW_MESSAGE_THRESHOLD,20),extractionThreshold:integer(env.MEMORY_EXTRACTION_MESSAGE_THRESHOLD,30),
  maxAttempts:integer(env.AI_JOB_MAX_ATTEMPTS,2,1,10),timeoutMs:integer(env.AI_JOB_TIMEOUT_MS,60000,100,600000),
  concurrency:integer(env.AI_JOB_CONCURRENCY,1,1,8),summaryModel:String(env.SUMMARY_MODEL||"").trim(),
  extractionModel:String(env.MEMORY_EXTRACTION_MODEL||"").trim()
};}

class AiTaskRunner {
  constructor({store,service,config=readAiConfig(),logger=null}){this.store=store;this.service=service;this.config=config;this.logger=logger;this.controllers=new Map();this.accepting=true;this.active=0;}
  stop(){this.accepting=false;for(const controller of this.controllers.values())controller.abort();}

  async run(jobType,sessionId,options={}){
    if(!this.accepting)throw new AiMemoryError("AI 任务队列正在关闭",503,"AI_QUEUE_STOPPED");
    const duplicate=this.store.db.prepare("SELECT id FROM ai_jobs WHERE job_type=? AND session_id=? AND status IN ('queued','running')").get(jobType,sessionId);
    if(duplicate)throw new AiMemoryError("该 Session 已有同类型任务",409,"AI_JOB_CONFLICT");
    if(this.active>=this.config.concurrency)throw new AiMemoryError("AI 任务并发已满",429,"AI_JOB_CONCURRENCY_LIMIT");
    const inputCount=Number(this.store.db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE session_id=? AND status='completed'").get(sessionId)?.n||0);
    const model=jobType==="session_summary"?this.config.summaryModel:this.config.extractionModel;
    if(!model)throw new AiMemoryError(jobType==="session_summary"?"SUMMARY_MODEL 未配置":"MEMORY_EXTRACTION_MODEL 未配置",503,"AI_MODEL_NAME_MISSING");
    const job=this.store.createJob(jobType,sessionId,inputCount,this.service.provider,model);this.active++;
    let lastError;let timedOut=false;
    try{
      for(let attempt=1;attempt<=this.config.maxAttempts;attempt++){
        const controller=new AbortController();this.controllers.set(job.id,controller);
        if(this.store.getJob(job.id).status==="cancelled")throw new AiMemoryError("任务已取消",409,"AI_JOB_CANCELLED");
        this.store.updateJob(job.id,"running",{attemptCount:attempt});
        const timer=setTimeout(()=>controller.abort(new Error("timeout")),this.config.timeoutMs);
        try{
          const runOptions={...options,sourceJobId:job.id,signal:controller.signal,isCancelled:()=>this.store.getJob(job.id).status==="cancelled"};
          const result=jobType==="session_summary"?await this.service.generateSummary(sessionId,runOptions):await this.service.extractCandidates(sessionId,runOptions);
          clearTimeout(timer);if(this.store.getJob(job.id).status==="cancelled")return{job:this.store.getJob(job.id),result:null};
          return{job:this.store.updateJob(job.id,"completed",{attemptCount:attempt}),result};
        }catch(error){clearTimeout(timer);lastError=error;timedOut=controller.signal.aborted&&this.store.getJob(job.id).status!=="cancelled";if(error.code==="AI_JOB_CANCELLED"||this.store.getJob(job.id).status==="cancelled")return{job:this.store.getJob(job.id),result:null};if(attempt>=this.config.maxAttempts||error.code==="AI_OUTPUT_INVALID"||error.code==="SUMMARY_NO_NEW_MESSAGES")break;}
      }
      const code=timedOut?"AI_JOB_TIMEOUT":(lastError?.code||"AI_JOB_FAILED");
      const failed=this.store.updateJob(job.id,"failed",{attemptCount:this.store.getJob(job.id).attemptCount,errorCode:code,errorMessage:timedOut?"AI 任务超时":lastError?.message});
      throw Object.assign(lastError||new Error("AI 任务失败"),{job:failed,code});
    }finally{this.controllers.delete(job.id);this.active--;}
  }

  cancel(id){const job=this.store.cancelJob(id);this.controllers.get(id)?.abort();return job;}

  evaluateSession(sessionId){
    if(!this.config.automationEnabled||!this.accepting)return[];
    const total=Number(this.store.db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE session_id=? AND status='completed'").get(sessionId)?.n||0);const scheduled=[];
    const summary=this.store.activeSummary(sessionId);const newCount=summary?Number(this.store.db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE session_id=? AND status='completed' AND id>?").get(sessionId,summary.coveredUntilMessageId).n):total;
    if(this.config.summaryEnabled&&total>=this.config.summaryThreshold&&(!summary||newCount>=this.config.summaryNewThreshold))scheduled.push("session_summary");
    if(this.config.extractionEnabled&&total>=this.config.extractionThreshold)scheduled.push("memory_extraction");
    for(const type of scheduled)queueMicrotask(()=>this.run(type,sessionId).catch(error=>this.logger?.error?.({code:error.code,jobType:type,sessionId},"automatic AI job failed")));
    return scheduled;
  }
}

module.exports={AiTaskRunner,bool,integer,readAiConfig};
