"use strict";

const crypto = require("node:crypto");

function safeEqual(actual,expected){const a=Buffer.from(String(actual)),b=Buffer.from(String(expected));return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function envelope(data,meta={}){return{data,meta,error:null};}
function sendError(req,reply,error){const status=error.statusCode||500;if(status>=500)req.log.error({errorName:error.name,errorCode:error.code,jobId:error.job?.id},"AI operation failed");const safeConfigurationError=new Set(["AI_MODEL_NOT_CONFIGURED","AI_MODEL_NAME_MISSING","AI_QUEUE_STOPPED"]).has(error.code);return reply.code(status).send({data:null,meta:{},error:{code:error.code||"INTERNAL_ERROR",message:status>=500&&!safeConfigurationError?"AI 记忆服务暂时不可用":error.message}});}

function registerAiRoutes(app,{store,runner,config,adapter=runner?.service?.adapter,apiKey=process.env.GATEWAY_API_KEY,
  adminUser=process.env.ADMIN_USER,adminPassword=process.env.ADMIN_PASSWORD}){
  const auth=(req,reply,done)=>{if(!apiKey)return reply.code(503).send({data:null,meta:{},error:{code:"GATEWAY_KEY_MISSING",message:"GATEWAY_API_KEY 未配置"}});if(!safeEqual(req.headers.authorization||"",`Bearer ${apiKey}`))return reply.code(401).header("WWW-Authenticate","Bearer").send({data:null,meta:{},error:{code:"UNAUTHORIZED",message:"Invalid gateway API key"}});done();};
  const adminAuth=(req,reply,done)=>{if(!adminUser||!adminPassword)return reply.code(503).send({data:null,meta:{},error:{code:"ADMIN_CREDENTIALS_MISSING",message:"管理员凭据未配置"}});const value=String(req.headers.authorization||"");let credentials="";if(value.startsWith("Basic ")){try{credentials=Buffer.from(value.slice(6),"base64").toString("utf8");}catch{}}const separator=credentials.indexOf(":");const user=separator<0?"":credentials.slice(0,separator),password=separator<0?"":credentials.slice(separator+1);if(!safeEqual(user,adminUser)||!safeEqual(password,adminPassword))return reply.code(401).header("WWW-Authenticate",'Basic realm="AI Admin"').send({data:null,meta:{},error:{code:"UNAUTHORIZED",message:"Invalid administrator credentials"}});done();};
  const route=handler=>async(req,reply)=>{try{return await handler(req,reply);}catch(error){return sendError(req,reply,error);}};

  app.get("/api/v1/chat/sessions/:id/summary",{preHandler:auth},route(req=>envelope(store.activeSummary(req.params.id))));
  app.post("/api/v1/chat/sessions/:id/summary/generate",{preHandler:auth},route(async req=>{const out=await runner.run("session_summary",req.params.id,{force:Boolean(req.body?.force)});return envelope(out.result,{job:out.job});}));
  app.delete("/api/v1/chat/sessions/:id/summary",{preHandler:auth},route(req=>envelope(store.deleteSummary(req.params.id))));

  app.get("/api/v1/memory-candidates",{preHandler:auth},route(req=>{const out=store.listCandidates(req.query||{});return envelope(out.items,out.meta);}));
  app.get("/api/v1/memory-candidates/:id",{preHandler:auth},route(req=>envelope(store.getCandidate(req.params.id))));
  app.post("/api/v1/chat/sessions/:id/memory-candidates/generate",{preHandler:auth},route(async req=>{const out=await runner.run("memory_extraction",req.params.id);return envelope(out.result,{job:out.job});}));
  app.post("/api/v1/memory-candidates/:id/approve",{preHandler:auth},route(req=>envelope(store.approveCandidate(req.params.id,req.body?.candidate||req.body||{},req.body?.reviewedBy||"user"))));
  app.post("/api/v1/memory-candidates/:id/reject",{preHandler:auth},route(req=>envelope(store.setCandidateStatus(req.params.id,"reject",req.body?.reviewedBy||"user"))));
  app.post("/api/v1/memory-candidates/:id/reopen",{preHandler:auth},route(req=>envelope(store.setCandidateStatus(req.params.id,"reopen",req.body?.reviewedBy||"user"))));
  app.delete("/api/v1/memory-candidates/:id",{preHandler:auth},route(req=>envelope(store.deleteCandidate(req.params.id,req.body?.reviewedBy||"user"))));

  app.get("/api/v1/ai-jobs",{preHandler:auth},route(req=>{const out=store.listJobs(req.query||{});return envelope(out.items,out.meta);}));
  app.get("/api/v1/ai-jobs/:id",{preHandler:auth},route(req=>envelope(store.getJob(req.params.id))));
  app.post("/api/v1/ai-jobs/:id/cancel",{preHandler:auth},route(req=>envelope(runner.cancel(req.params.id))));
  app.get("/api/v1/ai-models/status",{preHandler:auth},route(()=>{
    const adapterStatus=adapter?.configurationStatus?.()||{provider:adapter?.provider||runner?.service?.provider||"unknown",
      endpointConfigured:false,apiKeyConfigured:false,transportConfigured:false,configured:Boolean(adapter?.isConfigured?.())};
    return envelope({provider:adapterStatus.provider,adapterConfigured:Boolean(adapterStatus.configured),
      endpointConfigured:Boolean(adapterStatus.endpointConfigured),apiKeyConfigured:Boolean(adapterStatus.apiKeyConfigured),
      transportConfigured:Boolean(adapterStatus.transportConfigured),summaryModelConfigured:Boolean(config.summaryModel),
      memoryExtractionModelConfigured:Boolean(config.extractionModel)});
  }));
  app.post("/admin/ai/models/test",{preHandler:adminAuth},route(async req=>{
    const feature=String(req.body?.feature||"");
    if(!new Set(["summary","memory_extraction"]).has(feature)){const error=new Error("feature 必须是 summary 或 memory_extraction");error.statusCode=400;error.code="AI_TEST_FEATURE_INVALID";throw error;}
    const model=feature==="summary"?config.summaryModel:config.extractionModel;
    if(!model){const error=new Error(feature==="summary"?"SUMMARY_MODEL 未配置":"MEMORY_EXTRACTION_MODEL 未配置");error.statusCode=503;error.code="AI_MODEL_NAME_MISSING";throw error;}
    const raw=await adapter.generate({model,system:'连接测试。仅输出 JSON 对象 {"ok":true}。',input:{operation:"configuration_test"}});
    let output;try{output=JSON.parse(raw);}catch{const error=new Error("模型测试响应不是有效 JSON");error.statusCode=502;error.code="AI_TEST_OUTPUT_INVALID";throw error;}
    return envelope({feature,provider:adapter.provider||runner?.service?.provider||"unknown",configured:true,responseValid:Boolean(output&&typeof output==="object"&&!Array.isArray(output))});
  }));
  app.get("/admin/ai/metrics",{preHandler:adminAuth},route(()=>{
    const aggregate=(where,grouped=false)=>store.db.prepare(`SELECT ${grouped?"job_type,":""} COUNT(*) total_jobs,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed_jobs,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_jobs,
      COALESCE(SUM(prompt_tokens),0) prompt_tokens,
      COALESCE(SUM(completion_tokens),0) completion_tokens,
      COALESCE(SUM(total_tokens),0) total_tokens,
      COALESCE(ROUND(AVG(latency_ms)),0) average_latency_ms
      FROM ai_jobs ${where}`).all();
    const map=row=>({totalJobs:Number(row.total_jobs),completedJobs:Number(row.completed_jobs||0),failedJobs:Number(row.failed_jobs||0),
      promptTokens:Number(row.prompt_tokens),completionTokens:Number(row.completion_tokens),totalTokens:Number(row.total_tokens),
      averageLatencyMs:Number(row.average_latency_ms)});
    const total=map(aggregate("")[0]);
    const byJobType=aggregate("GROUP BY job_type ORDER BY job_type",true).map(row=>({jobType:row.job_type,...map(row)}));
    return envelope({total,byJobType});
  }));
  app.get("/api/v1/ai-automation/status",{preHandler:auth},route(()=>{
    const queued=Number(store.db.prepare("SELECT COUNT(*) n FROM ai_jobs WHERE status='queued'").get().n);
    const running=Number(store.db.prepare("SELECT COUNT(*) n FROM ai_jobs WHERE status='running'").get().n);
    const recent=store.db.prepare("SELECT error_code FROM ai_jobs WHERE error_code IS NOT NULL ORDER BY completed_at DESC LIMIT 1").get();
    return envelope({automationEnabled:config.automationEnabled,summaryAutoEnabled:config.summaryEnabled,
      memoryExtractionAutoEnabled:config.extractionEnabled,summaryModelConfigured:Boolean(config.summaryModel),
      memoryExtractionModelConfigured:Boolean(config.extractionModel),queue:{queued,running},recentErrorCode:recent?.error_code||null});
  }));
  return{auth,adminAuth};
}

module.exports={registerAiRoutes};
