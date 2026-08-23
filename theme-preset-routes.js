"use strict";

const crypto = require("node:crypto");
const { ThemePresetError } = require("./theme-preset-service");
const equal=(actual,expected)=>{const left=Buffer.from(String(actual)),right=Buffer.from(String(expected));return left.length===right.length&&crypto.timingSafeEqual(left,right);};
function registerThemePresetRoutes(app,{store,apiKey=process.env.GATEWAY_API_KEY}={}) {
  const auth=(req,reply,done)=>{if(!apiKey)return reply.code(503).send({ok:false,error:{code:"GATEWAY_KEY_MISSING",message:"主题预设服务暂不可用"}});if(!equal(req.headers.authorization||"",`Bearer ${apiKey}`))return reply.code(401).header("WWW-Authenticate","Bearer").send({ok:false,error:{code:"UNAUTHORIZED",message:"Unauthorized"}});done();};
  const run=handler=>async(req,reply)=>{try{return await handler(req,reply);}catch(raw){const error=raw instanceof ThemePresetError?raw:new ThemePresetError("主题预设服务暂不可用",500,"THEME_PRESET_INTERNAL_ERROR");if(error.statusCode>=500)req.log.error({errorCode:error.code},"theme preset operation failed");if(error.code==="THEME_PRESET_INVALID_FIELD")return reply.code(error.statusCode).send({error:error.code,field:error.field});return reply.code(error.statusCode).send({ok:false,error:{code:error.code,message:error.message}});}};
  app.get("/api/theme/presets",{preHandler:auth},run(()=>({ok:true,data:{items:store.list()}})));
  app.post("/api/theme/presets",{preHandler:auth},run(req=>({ok:true,data:store.create(req.body)})));
  app.post("/api/theme/presets/import",{preHandler:auth},run(req=>({ok:true,data:store.import(req.body)})));
  app.get("/api/theme/presets/:id",{preHandler:auth},run(req=>({ok:true,data:store.public(store.get(req.params.id))})));
  app.patch("/api/theme/presets/:id",{preHandler:auth},run(req=>({ok:true,data:store.update(req.params.id,req.body)})));
  app.delete("/api/theme/presets/:id",{preHandler:auth},run(req=>({ok:true,data:store.delete(req.params.id)})));
  app.post("/api/theme/presets/:id/copy",{preHandler:auth},run(req=>({ok:true,data:store.copy(req.params.id)})));
  app.post("/api/theme/presets/:id/apply-preview",{preHandler:auth},run(req=>({ok:true,data:store.previewApply(req.params.id)})));
  app.post("/api/theme/presets/:id/apply",{preHandler:auth},run(req=>({ok:true,data:store.apply(req.params.id)})));
  app.get("/api/theme/presets/:id/export",{preHandler:auth},run(req=>({ok:true,data:store.export(req.params.id)})));
}
module.exports={registerThemePresetRoutes};
