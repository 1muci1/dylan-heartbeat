"use strict";
const crypto=require("node:crypto");
const {PersonalizationError}=require("./personalization-store");
function registerPersonalizationRoutes(app,{store,apiKey=process.env.GATEWAY_API_KEY}={}) {
  const auth=(req,reply,done)=>{
    reply.header("Cache-Control","no-store");
    if(!apiKey)return reply.code(503).send({ok:false,error:{code:"GATEWAY_KEY_MISSING"}});
    const actual=Buffer.from(req.headers.authorization||""),expected=Buffer.from(`Bearer ${apiKey}`);
    if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return reply.code(401).header("WWW-Authenticate","Bearer").send({ok:false,error:{code:"UNAUTHORIZED"}});
    done();
  };
  const run=handler=>(req,reply)=>{try{return {ok:true,data:handler(req)};}catch(error){const known=error instanceof PersonalizationError;return reply.code(known?error.statusCode:503).send({ok:false,error:{code:known?error.code:"PERSONALIZATION_UNAVAILABLE"}});}};
  app.get("/api/personalization",{preHandler:auth},run(()=>store.get()));
  // Explicit, authenticated writes; no automatic bootstrap or whole-document overwrite.
  app.post("/api/personalization/bootstrap",{preHandler:auth,bodyLimit:256*1024},run(req=>store.bootstrap(req.body)));
  app.patch("/api/personalization",{preHandler:auth,bodyLimit:256*1024},run(req=>store.patch(req.body)));
}
module.exports={registerPersonalizationRoutes};
