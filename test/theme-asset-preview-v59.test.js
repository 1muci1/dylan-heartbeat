"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Fastify = require("fastify");
const { test } = require("node:test");
const { registerThemeAssetRoutes } = require("../theme-asset-routes");
const { ThemeAssetLocalizer, ThemeAssetPreviewService, ThemeAssetPreviewStore, ThemeAssetStore } = require("../theme-asset-service");

const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
const response = (body = png, headers = { "content-type": "image/png" }) => ({ ok:true,status:200,headers:{get:key=>headers[key.toLowerCase()] || null},arrayBuffer:async()=>body });

test("preview service stores a safe temporary PNG without exposing its source URL", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"theme-preview-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const localizer=new ThemeAssetLocalizer({lookup:async()=>[{address:"203.0.113.8"}],fetchFn:async()=>response()});
  const service=new ThemeAssetPreviewService({localizer,store:new ThemeAssetPreviewStore({rootDir:dir})});
  const result=await service.preview([{id:"asset_1",kind:"bubbleDecoration",selector:".echoes-bubble-other::before",sourceUrl:"https://images.example/secret.png"}]);
  assert.match(result.items[0].previewUrl,/^\/api\/theme\/assets\/preview\/[0-9a-f-]{36}$/u);
  assert.equal(result.items[0].width,null);assert.equal(result.items[0].height,null);
  assert.doesNotMatch(JSON.stringify(result),/images\.example|secret\.png/u);
  const file=service.store.resolve(result.items[0].previewUrl.split("/").pop());assert.equal(fs.statSync(file.filename).mode&0o777,0o600);assert.equal(fs.statSync(dir).mode&0o777,0o700);
});

test("preview rejects private, link-local, mapped IPv6, and unsafe protocols", async () => {
  for(const address of ["127.0.0.1","10.0.0.2","172.16.4.2","192.168.1.2","169.254.1.1","::1","::ffff:127.0.0.1"]){
    const service=new ThemeAssetPreviewService({localizer:new ThemeAssetLocalizer({lookup:async()=>[{address}],fetchFn:async()=>response()})});
    assert.equal((await service.preview([{id:"x",sourceUrl:"https://safe-name.example/a.png"}])).failed[0].reason,"THEME_ASSET_SSRF_BLOCKED",address);
  }
  const service=new ThemeAssetPreviewService({localizer:new ThemeAssetLocalizer()});
  for(const sourceUrl of ["file:///etc/passwd","data:image/png;base64,AA==","ftp://example.com/a.png"]) assert.equal((await service.preview([{id:"x",sourceUrl}])).failed[0].reason,"THEME_ASSET_SCHEME_FORBIDDEN");
});

test("preview rejects unsupported or oversized remote content", async () => {
  for(const [mime,body] of [["image/svg+xml",Buffer.from("<svg/>")],["image/gif",Buffer.from("GIF89a")],["text/html",Buffer.from("<html>")],["text/plain",Buffer.from("text")]]){
    const service=new ThemeAssetPreviewService({localizer:new ThemeAssetLocalizer({lookup:async()=>[{address:"203.0.113.8"}],fetchFn:async()=>response(body,{"content-type":mime})})});
    assert.equal((await service.preview([{id:"x",sourceUrl:"https://images.example/a"}])).failed[0].reason,"THEME_ASSET_CONTENT_TYPE_INVALID",mime);
  }
  const service=new ThemeAssetPreviewService({localizer:new ThemeAssetLocalizer({lookup:async()=>[{address:"203.0.113.8"}],fetchFn:async()=>response(png,{"content-type":"image/png","content-length":String(2*1024*1024+1)})})});
  assert.equal((await service.preview([{id:"x",sourceUrl:"https://images.example/a.png"}])).failed[0].reason,"THEME_ASSET_TOO_LARGE");
});

test("preview route requires auth while random preview GET serves only cached images", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"theme-preview-route-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const previewStore=new ThemeAssetPreviewStore({rootDir:dir});const saved=previewStore.save(png,"image/png");const app=Fastify({logger:false});
  registerThemeAssetRoutes(app,{apiKey:"test-key",localizer:{localize:async()=>({localized:[],failed:[]})},store:new ThemeAssetStore({rootDir:path.join(dir,"formal")}),previewStore,previewService:{preview:async()=>({items:[{previewUrl:saved.previewUrl,status:"ready"}],failed:[]})}});t.after(()=>app.close());
  assert.equal((await app.inject({method:"POST",url:"/api/theme/assets/preview",payload:{assets:[]}})).statusCode,401);
  assert.equal((await app.inject({method:"POST",url:"/api/theme/assets/preview",headers:{authorization:"Bearer test-key"},payload:{assets:[{sourceUrl:"https://example.test/a.png"}]}})).statusCode,200);
  const image=await app.inject({method:"GET",url:saved.previewUrl});assert.equal(image.statusCode,200);assert.equal(image.headers["content-type"],"image/png");
  for(const id of ["not-exist","%21%40invalid","11111111-1111-4111-8111-111111111111"]){
    const missing=await app.inject({method:"GET",url:`/api/theme/assets/preview/${id}`});
    assert.equal(missing.statusCode,404,id);assert.equal(missing.json().error.code,"THEME_ASSET_NOT_FOUND",id);
  }
});

test("preview POST keeps invalid payload validation at 400", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"theme-preview-empty-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const previewStore=new ThemeAssetPreviewStore({rootDir:dir});const app=Fastify({logger:false});
  registerThemeAssetRoutes(app,{apiKey:"test-key",localizer:{localize:async()=>({localized:[],failed:[]})},store:new ThemeAssetStore({rootDir:path.join(dir,"formal")}),previewStore,previewService:new ThemeAssetPreviewService({localizer:{download:async()=>{throw new Error("not called");}},store:previewStore})});t.after(()=>app.close());
  const result=await app.inject({method:"POST",url:"/api/theme/assets/preview",headers:{authorization:"Bearer test-key"},payload:{assets:[]}});
  assert.equal(result.statusCode,400);assert.equal(result.json().error.code,"THEME_ASSET_INVALID");
});

test("preview cache removes expired and excess files", t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"theme-preview-clean-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let now=Date.now();const store=new ThemeAssetPreviewStore({rootDir:dir,maxAgeMs:100,maxItems:2,now:()=>now});
  store.save(png,"image/png");now+=200;store.save(png,"image/png");assert.equal(fs.readdirSync(dir).filter(name=>!name.startsWith(".")).length,1);
  store.save(png,"image/png");store.save(png,"image/png");assert.ok(fs.readdirSync(dir).filter(name=>!name.startsWith(".")).length<=2);
});

test("preview routes and logs do not expose source URLs, tokens, or stacks", () => {
  const routes=fs.readFileSync(path.join(__dirname,"..","theme-asset-routes.js"),"utf8");
  assert.match(routes,/\/api\/theme\/assets\/preview/u);assert.match(routes,/errorCode:error\.code/u);
  assert.doesNotMatch(routes,/req\.log\.(?:info|error)\([^\n]*(?:sourceUrl|authorization|stack)/iu);
  assert.match(fs.readFileSync(path.join(__dirname,"..",".gitignore"),"utf8"),/runtime-data\/theme-asset-previews\//u);
});
