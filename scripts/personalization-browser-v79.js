"use strict";
// Isolated acceptance server + two fresh Chromium profiles. Never accesses production APIs.
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{spawn}=require("node:child_process"),assert=require("node:assert/strict");
const Fastify=require("fastify"),{PersonalizationStore}=require("../personalization-store"),{registerPersonalizationRoutes}=require("../personalization-routes"),{ThemeAssetStore}=require("../theme-asset-service"),{registerThemeAssetRoutes}=require("../theme-asset-routes");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"v79-profiles-")),output=process.env.V79_BROWSER_OUTPUT||"/tmp/v79-browser";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<150;i++){try{const result=await fn();if(result)return result;}catch{}await pause(100);}throw Error(`Timed out: ${label}`);}
async function main(){
  fs.mkdirSync(output,{recursive:true});const events=[],assetStore=new ThemeAssetStore({rootDir:path.join(temporary,"assets"),eventStore:{create:e=>events.push(e)}}),store=new PersonalizationStore({rootDir:path.join(temporary,"personalization"),assetStore,eventStore:{create:e=>events.push(e)}});
  let fakeCloud=null;let bootstrapCalls=0;const syncReads=[];let syncWrites=0,uploadCalls=0,rejectUpload=0;
  const app=Fastify({logger:false});app.addHook("onRequest",async (req,reply)=>{if(req.url==="/api/theme/assets/upload"&&req.method==="POST"){uploadCalls++;if(uploadCalls===rejectUpload)return reply.code(415).send({ok:false,error:{code:"THEME_ASSET_MAGIC_INVALID"}});}if(req.url.startsWith("/api/personalization")){if(req.method==="GET")syncReads.push({path:req.url,validAuth:req.headers.authorization==="Bearer fake-browser-key",thirdParty:req.headers.authorization?.includes("third-party")===true});else syncWrites++;}if(req.method==="POST"&&req.url==="/api/personalization/bootstrap")bootstrapCalls++;});app.addHook("onRequest",async(req,reply)=>{if(fakeCloud&&req.url==="/api/personalization"&&req.method==="GET"&&req.headers.authorization==="Bearer fake-browser-key")return reply.send({ok:true,data:{initialized:true,state:fakeCloud}});});await app.register(require("@fastify/multipart"));registerPersonalizationRoutes(app,{store,apiKey:"fake-browser-key"});registerThemeAssetRoutes(app,{store:assetStore,personalizationStore:store,apiKey:"fake-browser-key"});
  const mime={".html":"text/html",".js":"application/javascript",".css":"text/css",".svg":"image/svg+xml",".json":"application/json",".png":"image/png"};
  app.get("/*",(req,reply)=>{let pathname=new URL(req.url,"http://localhost").pathname;if(pathname.startsWith("/api/")||pathname.startsWith("/v1/"))return {ok:true,data:{items:[]}};if(pathname.endsWith("/"))pathname+="index.html";const allowed=["storage","avatar","shared","space","game","collaboration","theme"];const base=allowed.includes(pathname.split("/")[1])?"ai-companion-frontend":"frontend-p4b",file=path.resolve(root,base,"."+pathname);if(!file.startsWith(path.join(root,base)+path.sep)||!fs.existsSync(file))return reply.code(404).send("");return reply.type(mime[path.extname(file)]||"application/octet-stream").send(fs.readFileSync(file));});
  const origin=await app.listen({port:0,host:"127.0.0.1"}),children=[],clients=[];
  async function browser(name,mobile,providerBase=origin,savedGateway=false){
    const profile=path.join(temporary,name),chrome=process.env.V79_CHROMIUM||"/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
    const child=spawn(chrome,["--headless=new","--no-sandbox","--disable-dev-shm-usage","--disable-background-networking","--disable-component-update","--no-first-run","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});children.push(child);
    const port=await until(()=>{const file=path.join(profile,"DevToolsActivePort");return fs.existsSync(file)&&Number(fs.readFileSync(file,"utf8").split("\n")[0]);},"Chromium launch");
    const targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json()),socket=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);let id=0;const pending=new Map();
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}};await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    const send=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,message=>message.error?reject(Error(message.error.message)):resolve(message.result));socket.send(JSON.stringify({id:current,method,params}));});
    const evaluate=async expression=>{const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error("Browser expression failed: "+expression.slice(0,120));return result.result.value;};
    await send("Page.enable");await send("Runtime.enable");await send("Network.enable");await send("Network.setBlockedURLs",{urls:["https://*","http://*.xiaowo.homes/*"]});
    await send("Emulation.setDeviceMetricsOverride",{width:mobile?390:1365,height:mobile?844:900,deviceScaleFactor:1,mobile});
    await send("Page.addScriptToEvaluateOnNewDocument",{source:`if(location.origin===${JSON.stringify(origin)}&&!localStorage.getItem('xinban-provider-config-v1'))localStorage.setItem('xinban-provider-config-v1',JSON.stringify({type:'gateway',mode:'real',baseUrl:${JSON.stringify(providerBase)},gatewayConnection:${JSON.stringify(savedGateway?{baseUrl:origin,auth:{type:"bearer",token:"fake-browser-key"}}:null)},endpoint:'/v1/chat/completions',model:'fake',displayName:'Test',auth:{type:'bearer',token:${JSON.stringify(providerBase===origin?'fake-browser-key':'fake-third-party-token')}}}));`});
    const navigate=async page=>{await send("Page.navigate",{url:origin+page});await until(()=>evaluate("Boolean(window.PersonalizationSync && !PersonalizationSync.busy && ['synced','uninitialized','disconnected'].includes(PersonalizationSync.status))"),name+" sync ready "+page).catch(async error=>{console.log(JSON.stringify(await evaluate("({status:window.PersonalizationSync?.status,body:document.querySelector('[data-sync-status]')?.textContent,modules:[!!window.CompanionUserPreferences,!!window.XinbanThemeStore,!!window.CompanionVoice,!!window.XinbanThemeGateway],ready:document.readyState,hasAuth:AppConfig.getProviderConfig().auth.token==='fake-browser-key'})")));console.log(JSON.stringify(await evaluate("XinbanThemeGateway.request('/api/personalization',{},window).then(p=>({initialized:p.data?.initialized})).catch(e=>({code:e.code,status:e.status,message:e.message}))")));throw error;});};
    const screenshot=async filename=>{const result=await send("Page.captureScreenshot",{format:"png"});fs.writeFileSync(path.join(output,filename),Buffer.from(result.data,"base64"));};
    const client={send,evaluate,navigate,screenshot,socket,close:()=>{socket.close();child.kill("SIGTERM");}};clients.push(client);return client;
  }
const stableSettings=async c=>{await c.navigate('/settings.html');await until(()=>c.evaluate("sessionStorage.getItem('p4b-sw-controller-refresh-v79')==='1'&&!!navigator.serviceWorker.controller&&!!window.PersonalizationSync&&!PersonalizationSync.busy"),'first SW activation refresh');await c.navigate('/settings.html');};
  try {
    if(process.env.V79_GATEWAY_MOBILE_ONLY==="1"){
      const c=await browser('gateway-mobile-independent',true,'https://third-party.example/v1');
      await stableSettings(c);
      const tap=async selector=>{
        const point=await c.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
        await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      };
      await c.send('Emulation.setTouchEmulationEnabled',{enabled:true});
      const layout=[];
      for(const [width,height] of [[390,844],[360,780],[390,420]]){
        await c.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
        await tap('[data-sync-connect]');
        await until(()=>c.evaluate("document.querySelector('[data-gateway-dialog]').open"),'gateway open');
        const check=await c.evaluate(`(()=>{const d=document.querySelector('[data-gateway-dialog]'),b=d.querySelector('[type=submit]'),s=d.querySelector('[data-gateway-status]'),r=b.getBoundingClientRect(),sr=s.getBoundingClientRect();return {buttonVisible:r.top>=0&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),statusVisible:sr.top>=0&&sr.bottom<=innerHeight,noOverflow:document.documentElement.scrollWidth<=innerWidth,providerClosed:!document.querySelector('[data-global-provider-dialog]').open};})()`);
        assert.ok(Object.values(check).every(Boolean),JSON.stringify({width,height,...check}));
        const before=syncReads.length;
        await tap('[data-gateway-dialog] [type=submit]');
        assert.match(await c.evaluate("document.querySelector('[data-gateway-status]').textContent"),/GATEWAY_NOT_CONNECTED/);
        assert.equal(syncReads.length,before);
        layout.push({width,height,...check});await c.screenshot(`gateway-mobile-${width}-${height}.png`);
        await tap('[data-gateway-close]');
      }
      await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await tap('[data-sync-connect]');
      await c.evaluate("document.querySelector('[name=credential]').value='fake-invalid'");
      await tap('[data-gateway-dialog] [type=submit]');
      await until(()=>c.evaluate("document.querySelector('[data-gateway-status]').textContent.includes('GATEWAY_AUTH_FAILED')"),'visible auth failure');
      assert.equal(await c.evaluate("AppConfig.getGatewayConnection()"),null);
      await c.evaluate("document.querySelector('[name=credential]').value='fake-browser-key'");
      await tap('[data-gateway-dialog] [type=submit]');
      await until(()=>c.evaluate("!document.querySelector('[data-gateway-dialog]').open && PersonalizationSync.status==='uninitialized' && !PersonalizationSync.busy"),'saved connection and refreshed card');
      assert.equal(await c.evaluate("document.querySelector('[data-sync-device]').textContent.includes('已连接')"),true,"device card connected");
      assert.equal(await c.evaluate("AppConfig.getProviderConfig().baseUrl"),'https://third-party.example/v1');
      await c.evaluate("document.querySelector('[data-open-gateway]').click();document.querySelector('[name=credential]').value='fake-invalid'");
      await tap('[data-gateway-dialog] [type=submit]');
      await until(()=>c.evaluate("document.querySelector('[data-gateway-status]').textContent.includes('GATEWAY_AUTH_FAILED')"),'rotation rejected');
      assert.equal(await c.evaluate("AppConfig.getGatewayConnection().auth.token==='fake-browser-key'"),true);
      await tap('[data-gateway-close]');
      await c.evaluate("document.querySelector('[data-open-global-provider]').click();document.querySelector('[name=baseUrl]').value='https://another-provider.example/v1';document.querySelector('[name=token]').value='fake-third-party-new';document.querySelector('[data-provider-config-form]').requestSubmit()");
      await until(()=>c.evaluate("AppConfig.getProviderConfig().baseUrl==='https://another-provider.example/v1'"),'provider save regression');
      assert.equal(await c.evaluate("AppConfig.getGatewayConnection().auth.token==='fake-browser-key'"),true);
      assert.equal(await c.evaluate("JSON.stringify(PersonalizationSync.capture()).includes('fake-browser-key')"),false);
      await c.navigate('/settings.html');
      assert.equal(await c.evaluate("PersonalizationSync.status"),'uninitialized');
      const sections=await c.evaluate("PersonalizationSync.capture()");
      fakeCloud={version:1,revision:1,updatedAt:new Date().toISOString(),sections:Object.fromEntries(Object.entries(sections).map(([key,data])=>[key,{revision:1,updatedAt:new Date().toISOString(),data}]))};
      await c.evaluate("PersonalizationSync.sync()");
      assert.equal(await c.evaluate("document.querySelector('[data-sync-status]').textContent"),'已同步');
      assert.equal(await c.evaluate("document.querySelector('[data-sync-device]').textContent"),'本设备已连接');
      assert.equal(syncWrites,0);assert.equal(bootstrapCalls,0);assert.equal(uploadCalls,0);
      assert.equal(syncReads.some(r=>r.thirdParty),false);
      assert.equal(syncReads.filter(r=>!r.validAuth).length,2);
      const report={passed:true,layout,missingCredential:true,invalidCredential:true,validCredential:true,failedRotationPreservesConnection:true,providerSavePreservesConnection:true,cardRefresh:true,noCredentialInPersonalization:true,bootstrapCalls,syncWrites,uploadCalls,productionTouched:false};
      fs.writeFileSync(path.join(output,'gateway-mobile-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
    }
    if(process.env.V79_BACKUP_ONLY==="1"){
      const images=require('../test/fixtures/personalization-images-v79.json');
      const a=await browser('backup-small',false);await stableSettings(a);await a.navigate('/space/');
      await a.evaluate(`(()=>{const p=new CompanionUserPreferences.UserPreferenceStore();p.saveAvatar({imageData:${JSON.stringify(images.png)},crop:{x:23,y:61,zoom:1.4},scale:1.4},'user');p.saveAvatar({imageData:${JSON.stringify(images.jpeg)},crop:{x:62,y:31},scale:1.2},'chen');window.fixtureOriginal=PersonalizationSync.originalAvatars();})()`);
      console.log('backup fixture: small originals');
      const small=await a.evaluate(`(async()=>{const c=PersonalizationSync,original=localStorage.getItem('xinban-user-preferences-v1');const first=await c.backup.ensure(fixtureOriginal);for(let i=0;i<4;i++)await c.backup.ensure(fixtureOriginal);const restored=await c.backup.restore(first.id);return {id:first.id,equal:JSON.stringify(restored)===JSON.stringify(fixtureOriginal),unchanged:original===localStorage.getItem('xinban-user-preferences-v1'),legacyAbsent:localStorage.getItem('personalization-original-avatars-v79')===null};})()`);
      assert.equal(small.equal,true);assert.equal(small.unchanged,true);assert.equal(small.legacyAbsent,true);
      const counts=async c=>c.evaluate(`(async()=>{const db=await PersonalizationSync.backup.open();try{return await Promise.all(['snapshots','images'].map(name=>new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).count();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);})));}finally{db.close();}})()`);
      assert.deepEqual(await counts(a),[1,2]);
      await a.navigate('/settings.html');assert.equal(await a.evaluate(`PersonalizationSync.backup.restore(${JSON.stringify(small.id)}).then(v=>v.userAvatar.crop.zoom===1.4&&v.chenAvatar.scale===1.2)`),true);
      // Existing legacy backup is read-only and usable even if IndexedDB is unavailable.
      assert.equal(await a.evaluate(`(async()=>{const c=PersonalizationSync,v=c.originalAvatars(),text=JSON.stringify([v]);localStorage.setItem('personalization-original-avatars-v79',text);const legacy=new CompanionAvatarBackup.AvatarBackupStore({indexedDB:null,storage:localStorage});const r=await legacy.ensure(v);return r.kind==='legacy'&&localStorage.getItem('personalization-original-avatars-v79')===text;})()`),true);
      console.log('backup fixture: legacy and reload passed');
      a.close();
      const b=await browser('backup-large-quota',false);await stableSettings(b);
      // Deterministic synthetic raster only; sufficiently large to reproduce localStorage duplication.
      await b.evaluate(`(()=>{const c=document.createElement('canvas');c.width=512;c.height=512;const x=c.getContext('2d'),d=x.createImageData(512,512);let seed=17;for(let i=0;i<d.data.length;i+=4){for(let k=0;k<3;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;d.data[i+k]=seed>>>24;}d.data[i+3]=255;}x.putImageData(d,0,0);window.fixtureLarge=c.toDataURL('image/png');const p=new CompanionUserPreferences.UserPreferenceStore();p.saveAvatar({imageData:fixtureLarge,crop:{x:23,y:61,zoom:1.4},scale:1.4},'user');p.saveAvatar({imageData:fixtureLarge,crop:{x:62,y:31},scale:1.2},'chen');window.fixtureIdentity=PersonalizationSync.originalAvatars();window.fixtureBefore=localStorage.getItem('xinban-user-preferences-v1');let pad='';while(true){try{pad+='x'.repeat(32768);localStorage.setItem('fixture-capacity',pad);}catch(e){if(e.name!=='QuotaExceededError')throw e;break;}}})()`);
      console.log('backup fixture: localStorage filled');
      const large=await b.evaluate(`(async()=>{let reproduced=false;try{localStorage.setItem('personalization-original-avatars-v79',JSON.stringify([fixtureIdentity]));}catch(e){reproduced=e.name==='QuotaExceededError';}const first=await PersonalizationSync.backup.ensure(fixtureIdentity);for(let i=0;i<4;i++)await PersonalizationSync.backup.ensure(fixtureIdentity);return {reproduced,equal:JSON.stringify(await PersonalizationSync.backup.restore(first.id))===JSON.stringify(fixtureIdentity),unchanged:fixtureBefore===localStorage.getItem('xinban-user-preferences-v1'),legacyAbsent:localStorage.getItem('personalization-original-avatars-v79')===null,bytes:fixtureLarge.length};})()`);
      assert.equal(large.reproduced,true);assert.equal(large.equal,true);assert.equal(large.unchanged,true);assert.equal(large.legacyAbsent,true);assert.ok(large.bytes>1000000);assert.deepEqual(await counts(b),[1,1]);
      console.log('backup fixture: large originals passed');
      const synthetic=await b.evaluate('fixtureLarge');b.close();
      const c=await browser('backup-idb-quota',false);await stableSettings(c);
      // Transfer only synthetic fixture into this independent profile.
      await c.evaluate(`(()=>{const p=new CompanionUserPreferences.UserPreferenceStore();p.saveAvatar({imageData:${JSON.stringify(synthetic)},crop:{x:23,y:61,zoom:1.4},scale:1.4},'user');p.saveAvatar({imageData:${JSON.stringify(images.jpeg)},crop:{x:62,y:31},scale:1.2},'chen');p.saveChatBackground({imageData:${JSON.stringify(images.webp)}});window.fixtureBefore=localStorage.getItem('xinban-user-preferences-v1');window.fixtureIdentity=PersonalizationSync.originalAvatars();})()`);
      // Safe UI mapping for the historical localStorage error; no state writes on failure.
      await c.evaluate(`(async()=>{const backup=PersonalizationSync.backup;PersonalizationSync.backup={ensure:async()=>{throw new DOMException('fixture','QuotaExceededError');}};await PersonalizationSync.bootstrap();PersonalizationSync.backup=backup;})()`);
      assert.match(await c.evaluate("document.querySelector('[data-sync-status]').textContent"),/本机头像备份空间不足，云端尚未初始化。原有头像和设置已保留。/);
      assert.equal(bootstrapCalls,0);assert.equal(uploadCalls,0);
      console.log('backup fixture: inject IndexedDB quota failure');
      await c.evaluate(`(()=>{window.fixturePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===CompanionAvatarBackup.DB_NAME)throw new DOMException('fixture quota','QuotaExceededError');return fixturePut.apply(this,args);};})()`);
      await c.evaluate('PersonalizationSync.bootstrap()');
      const idb=await c.evaluate('PersonalizationSync.migrationError');assert.equal(idb?.stage,'avatar-backup');assert.equal(idb?.code,'INDEXEDDB_QUOTA_EXCEEDED');
      await c.evaluate('PersonalizationSync.bootstrap()');
      assert.equal(bootstrapCalls,0);assert.equal(uploadCalls,0);assert.equal(store.read(),null);
      assert.equal(await c.evaluate("fixtureBefore===localStorage.getItem('xinban-user-preferences-v1')"),true);
      assert.equal(await c.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),false);
      assert.equal(await c.evaluate("document.querySelector('[data-sync-export-avatars]').hidden"),false);
      assert.deepEqual(await counts(c),[0,0]);
      const exportDir=path.join(temporary,'exports');fs.mkdirSync(exportDir);
      await c.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:exportDir});
      await c.evaluate("document.querySelector('[data-sync-export-avatars]').click()");
      const exported=path.join(exportDir,'yingwo-avatar-backup-v79.json');await until(()=>fs.existsSync(exported),'manual recovery export');
      const recovered=JSON.parse(fs.readFileSync(exported,'utf8'));assert.equal(recovered.identity.userAvatar.imageData,synthetic);assert.equal(recovered.identity.chenAvatar.imageData,images.jpeg);assert.deepEqual(recovered.identity.userAvatar.crop,{x:23,y:61,zoom:1.4});assert.equal(bootstrapCalls,0);
      console.log('backup fixture: quota and export passed');
      await c.evaluate('IDBObjectStore.prototype.put=window.fixturePut');
      // Fail second upload after successful backup; retry must reuse the first verified reference.
      rejectUpload=2;await c.evaluate('PersonalizationSync.bootstrap()');assert.equal(uploadCalls,2);assert.equal(bootstrapCalls,0);assert.equal(await c.evaluate('PersonalizationSync.migrationError.stage'),'asset-upload');
      assert.deepEqual(await counts(c),[1,2]);rejectUpload=0;
      await c.evaluate('PersonalizationSync.bootstrap()');assert.equal(bootstrapCalls,1);assert.equal(uploadCalls,4);assert.equal(assetStore.list().length,3);assert.equal(await c.evaluate('PersonalizationSync.status'),'synced');assert.deepEqual(await counts(c),[1,2]);
      assert.equal(await c.evaluate('PersonalizationSync.backup.restore(PersonalizationSync.lastBackup.id).then(v=>JSON.stringify(v)===JSON.stringify(fixtureIdentity))'),true);
      assert.deepEqual(store.read().sections.identity.data.userAvatar.crop,{x:23,y:61});assert.equal(store.read().sections.identity.data.userAvatar.scale,1.4);
      const report={passed:true,smallBackup:true,largeDataUrlBytes:large.bytes,realLocalStorageQuotaReproduced:true,noBase64LocalStorageBackup:true,bothOriginalsRecoverable:true,cropPreserved:true,reloadRestore:true,legacyCompatible:true,indexedDBQuotaInjected:true,quotaFailureBootstrapCalls:0,quotaFailureUploads:0,manualExport:true,repeatSnapshotCounts:[1,2],sameImageBlobCount:1,uploadAttempts:uploadCalls,assets:3,bootstrapCalls,productionTouched:false};
      fs.writeFileSync(path.join(output,'backup-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
    }
    if(process.env.V79_SCHEMA_ONLY==="1"){
      const a=await browser("schema-fresh",false);await a.navigate("/space/");
      const images=require('../test/fixtures/personalization-images-v79.json');
      const ref='/api/theme/assets/'+assetStore.upload(Buffer.from(images.png.split(',')[1],'base64'),{mimeType:'image/png',filename:'fixture.png'}).id;
      await a.evaluate(`(()=>{const p=new CompanionUserPreferences.UserPreferenceStore(),s=new AvatarStudio.AvatarStudio({persistenceAdapter:p});
        for(const [id,imageData] of [['user',${JSON.stringify(images.png)}],['chen',${JSON.stringify(images.jpeg)}]])s.save({...s.defaultChen(),id,crop:{x:23,y:61,zoom:1.4},frame:{...s.defaultChen().frame,border:'minimal'}},{imageData});
        p.saveChatBackground({imageData:${JSON.stringify(images.webp)},overlay:.3});
        const t=JSON.parse(JSON.stringify(XinbanThemeStore.getActive()));t.visualSlots.enabledByUser=true;t.visualSlots.pageBackground={...t.visualSlots.pageBackground,enabled:true,url:${JSON.stringify(ref)}};t.customDesign.regions['home.hero']={enabled:true,image:{enabled:true,url:${JSON.stringify(ref)}}};XinbanThemeStore.applyTheme(t);
        const v=new CompanionVoice.VoiceSettingsStore(localStorage);v.save({...v.load(),voiceName:'fixture-device-local',voiceURI:'fixture-device-local',rate:1.2});
      })()`);
      await stableSettings(a);
      await a.evaluate("(()=>{const c=PersonalizationSync;c.fixtureCapture=c.capture.bind(c);c.capture=()=>{const v=c.fixtureCapture();v.identity.chenAvatar.crop.zoom=1.4;return v;};})()");
      await a.evaluate("document.querySelector('[data-sync-bootstrap]').click()");
      await until(()=>a.evaluate("!PersonalizationSync.busy&&!!PersonalizationSync.migrationError"),'real validator rejects local crop.zoom');
      assert.equal(store.read(),null);assert.equal(uploadCalls,3);assert.equal(bootstrapCalls,1);
      assert.match(await a.evaluate("document.querySelector('[data-sync-status]').textContent"),/HTTP 400.*INVALID_PERSONALIZATION/);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),false);
      await a.evaluate("PersonalizationSync.capture=PersonalizationSync.fixtureCapture;document.querySelector('[data-sync-bootstrap]').click()");
      await until(()=>a.evaluate("!PersonalizationSync.busy&&PersonalizationSync.status==='synced'"),'real bootstrap validator succeeds').catch(async error=>{console.log(JSON.stringify(await a.evaluate("({status:PersonalizationSync.status,detail:PersonalizationSync.migrationError,initialized:PersonalizationSync.serverInitialized})")));throw error;});
      assert.equal(store.get().initialized,true);assert.equal(bootstrapCalls,2);assert.equal(uploadCalls,3);
      const data=store.read().sections;for(const name of ['userAvatar','chenAvatar']){assert.deepEqual(data.identity.data[name].crop,{x:23,y:61});assert.equal(data.identity.data[name].scale,1.4);assert.equal(data.identity.data[name].border,'minimal');}
      assert.equal(data.appearance.data.activeTheme.visualSlots.pageBackground.url,ref);assert.equal(data.appearance.data.activeTheme.customDesign.regions['home.hero'].image.url,ref);
      assert.doesNotMatch(JSON.stringify(data),/data:|base64|fixture-device-local|voiceURI|voiceName/);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),true);
      await a.navigate('/space/');assert.equal(await a.evaluate("new AvatarStudio.AvatarStudio({persistenceAdapter:new CompanionUserPreferences.UserPreferenceStore()}).defaultChen().crop.zoom"),1.4);
      const report={passed:true,realValidator:true,threeSections:true,themePreserved:true,scalePreserved:true,localSecretsExcluded:true,failedBootstrapButtonVisible:true,bootstrapCalls,uploadCalls,productionTouched:false};
      fs.writeFileSync(path.join(output,'schema-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
    }
    if(process.env.V79_ERRORS_ONLY==="1"){
      const a=await browser("errors-fresh",false);await stableSettings(a);
      await a.evaluate(`(()=>{const original=PersonalizationSync.capture.bind(PersonalizationSync);PersonalizationSync.capture=()=>{const value=original();value.appearance.ui.mode="fixture-invalid-mode";return value;};})()`);
      await a.evaluate("document.querySelector('[data-sync-bootstrap]').click()");
      await until(()=>a.evaluate("!PersonalizationSync.busy&&!!PersonalizationSync.migrationError"),"bootstrap error visible");
      const detail=await a.evaluate("PersonalizationSync.migrationError"),message=await a.evaluate("document.querySelector('[data-sync-status]').textContent");
      assert.deepEqual(detail,{stage:"bootstrap",slot:null,status:400,code:"INVALID_PERSONALIZATION"});
      assert.match(message,/提交初始配置.*HTTP 400.*INVALID_PERSONALIZATION/);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),false);
      assert.equal(store.read(),null);assert.equal(uploadCalls,0);assert.equal(bootstrapCalls,1);
      const versions=await a.evaluate("[...document.scripts].map(s=>new URL(s.src||location.href).pathname+new URL(s.src||location.href).search).filter(s=>/personalization|avatar-migration|theme-gateway/.test(s))");
      assert.ok(versions.some(s=>s.includes('personalization-sync.js?v=v79-p4b-sync8')));
      await a.evaluate("navigator.serviceWorker.ready.then(()=>true)");await a.navigate('/settings.html');
      const cache=await a.evaluate("caches.keys()");assert.ok(cache.includes('xinban-shell-v79-p4b-sync9'));
      const cached=await a.evaluate("caches.match('/assets/js/personalization-sync.js?v=v79-p4b-sync8').then(r=>r.text()).then(s=>s.includes('stageLabel'))");assert.equal(cached,true);
      const report={passed:true,detail,message,versions,cache,bootstrapCalls,uploadCalls,initialized:false,productionTouched:false};
      fs.writeFileSync(path.join(output,'errors-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
    }
    if(process.env.V79_MIGRATION_ONLY==="1"){
      const a=await browser("migration-a",false);await a.navigate("/space/");
      const images=await a.evaluate(`(()=>{const image=(type,color)=>{const c=document.createElement('canvas');c.width=16;c.height=16;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,16,16);x.fillStyle='#3529cd';x.fillRect(1,2,7,11);x.fillStyle='#f1da63';x.fillRect(9,0,6,5);return c.toDataURL(type);};return {png:image('image/png','#f08369'),jpeg:image('image/jpeg','#527f91'),webp:image('image/webp','#aacbb2')};})()`);
      fs.writeFileSync(path.join(output,"migration-images.json"),JSON.stringify(images,null,2));
      // A complete JPEG with legacy trailing bytes: browser renders it, strict upload rejects its terminal marker.
      const legacy='data:image/jpeg;base64,'+Buffer.concat([Buffer.from(images.jpeg.split(',')[1],'base64'),Buffer.from([0,0])]).toString('base64');
      assert.throws(()=>assetStore.upload(Buffer.from(legacy.split(',')[1],'base64'),{mimeType:'image/jpeg',filename:'legacy.jpg'}),error=>error.code==='THEME_ASSET_STRUCTURE_INVALID');
      const diagnostics=await a.evaluate(`CompanionAvatarMigration.diagnose(${JSON.stringify(legacy)})`);
      assert.equal(diagnostics.decoded,true);assert.equal(diagnostics.mimeMatches,true);assert.equal(diagnostics.checks.terminalEOI,false);
      const normalization=await a.evaluate(`(async()=>{
        const source=${JSON.stringify(legacy)},blob=await CompanionAvatarMigration.normalize(source);
        const pixels=async url=>{const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(0,0,c.width,c.height).data];};
        const url=URL.createObjectURL(blob);try{return {mime:blob.type,equal:JSON.stringify(await pixels(source))===JSON.stringify(await pixels(url))};}finally{URL.revokeObjectURL(url);}
      })()`);
      assert.deepEqual(normalization,{mime:'image/png',equal:true});
      // Invalid raster / disguised content must never reach the upload endpoint or bootstrap.
      const broken='data:image/png;base64,'+Buffer.from(images.png.split(',')[1],'base64').subarray(0,33).toString('base64');
      for(const [source,code] of [[broken,'LOCAL_ASSET_DECODE_FAILED'],[images.png.replace('image/png','image/jpeg'),'THEME_ASSET_MAGIC_INVALID'],['data:image/svg+xml;base64,PHN2Zy8+','LOCAL_ASSET_TYPE_UNSUPPORTED']]){
        await a.evaluate(`new CompanionUserPreferences.UserPreferenceStore().saveAvatar({imageData:${JSON.stringify(source)}},'user')`);
        await a.evaluate("PersonalizationSync.bootstrap()");
        assert.equal(bootstrapCalls,0);assert.equal(uploadCalls,0);assert.equal(await a.evaluate("PersonalizationSync.migrationError.code"),code);
        assert.equal(await a.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),false);
      }
      // Canvas access and encoding failures surface safely, without uploading anything.
      for(const mode of ['throw','null']){
        const result=await a.evaluate(`(async()=>{const original=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(cb){${mode==='throw'?'throw new DOMException("blocked","SecurityError");':'cb(null);'}};try{await CompanionAvatarMigration.normalize(${JSON.stringify(legacy)});return 'unexpected';}catch(e){return e.code;}finally{HTMLCanvasElement.prototype.toBlob=original;}})()`);
        assert.equal(result,'LOCAL_ASSET_CANVAS_FAILED');
      }

      await a.evaluate(`(()=>{const images=${JSON.stringify(images)},p=new CompanionUserPreferences.UserPreferenceStore();p.saveAvatar({imageData:${JSON.stringify(legacy)},crop:{x:23,y:61},scale:1.4},'user');p.saveAvatar({imageData:images.jpeg},'chen');p.saveChatBackground({imageData:images.webp});})()`);
      rejectUpload=2;
      await a.evaluate("document.querySelector('[data-sync-bootstrap]').click()");
      await until(()=>a.evaluate("!PersonalizationSync.busy&&!!PersonalizationSync.migrationError"),"slot upload failure");
      assert.equal(bootstrapCalls,0);assert.equal(store.read(),null);assert.equal(uploadCalls,2);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),false);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-now]').hidden"),true);
      assert.match(await a.evaluate("document.querySelector('[data-sync-status]').textContent"),/沉头像.*HTTP 415.*THEME_ASSET_MAGIC_INVALID/);
      const failed=await a.evaluate("PersonalizationSync.migrationError");
      assert.equal(await a.evaluate("new CompanionUserPreferences.UserPreferenceStore().getUserAvatarImage()"),legacy);
      const migrated=assetStore.list()[0],migratedFile=assetStore.resolve(migrated.id);
      const uploaded='data:'+migrated.mime+';base64,'+fs.readFileSync(migratedFile.filename).toString('base64');
      // Compare actual CSS avatar rendering, including crop and zoom, before/after migration.
      await a.evaluate(`(()=>{const n=document.createElement('div');n.id='visual-avatar';n.style.cssText='position:fixed;z-index:999999;left:0;top:0;width:96px;height:96px;background-position:23% 61%;background-size:140%;background-repeat:no-repeat;background-image:url('+JSON.stringify(${JSON.stringify(legacy)})+')';document.body.append(n);})()`);
      await pause(100);
      const before=await a.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:96,height:96,scale:1}});
      await a.evaluate(`document.querySelector('#visual-avatar').style.backgroundImage='url('+JSON.stringify(${JSON.stringify(uploaded)})+')'`);await pause(100);
      const after=await a.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:96,height:96,scale:1}});
      assert.equal(before.data,after.data);fs.writeFileSync(path.join(output,'avatar-visual-before.png'),Buffer.from(before.data,'base64'));fs.writeFileSync(path.join(output,'avatar-visual-after.png'),Buffer.from(after.data,'base64'));
      await a.evaluate("document.querySelector('#visual-avatar').remove()");
      await a.screenshot("migration-415.png");
      rejectUpload=0;
      await a.evaluate("document.querySelector('[data-sync-bootstrap]').click()");
      await until(()=>a.evaluate("!PersonalizationSync.busy&&PersonalizationSync.status==='synced'"),"all images migrated");
      assert.equal(bootstrapCalls,1);assert.equal(store.get().initialized,true);assert.equal(assetStore.list().length,3);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),true);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-now]').hidden"),false);
      assert.deepEqual(assetStore.list().map(x=>x.mime).sort(),['image/jpeg','image/png','image/webp']);
      await a.screenshot("migration-synced.png");
      assert.deepEqual(store.read().sections.identity.data.userAvatar.crop,{x:23,y:61});
      assert.equal(store.read().sections.identity.data.userAvatar.scale,1.4);
      assert.equal(await a.evaluate("PersonalizationSync.backup.restore(PersonalizationSync.lastBackup.id).then(v=>v.userAvatar.imageData)"),legacy);
      const report={passed:true,diagnostics,normalization,visualScreenshotEqual:true,cropRetained:true,originalBackedUp:true,invalidAvatarBootstrapCalls:0,failure:{...failed,bootstrapCalls:0,initializationButtonVisible:true,syncNowVisible:false},success:{bootstrapCalls,assets:3,mimeTypes:['image/png','image/jpeg','image/webp'],status:'synced'},productionTouched:false};
      fs.writeFileSync(path.join(output,"migration-report.json"),JSON.stringify(report,null,2));console.log("v79 migration Chromium acceptance passed");return;
    }
    if(process.env.V79_CONNECTIONS_ONLY==="1"){
      for(const [name,mobile,providerBase,savedGateway,expected] of [["A",false,origin,false,"uninitialized"],["B",true,"https://third-party.example/v1",true,"uninitialized"],["C",true,"https://third-party.example/v1",false,"disconnected"]]){
        const before=syncReads.length,c=await browser(name,mobile,providerBase,savedGateway);await c.navigate("/space/");
        assert.equal(await c.evaluate("PersonalizationSync.status"),expected,`Profile ${name}: `+JSON.stringify(await c.evaluate("({saved:!!AppConfig.getGatewayConnection(),providerOrigin:new URL(AppConfig.getProviderConfig().baseUrl).origin,canonical:XinbanThemeGateway.resolveGatewayUrl('/api/personalization',{locationRef:location}),hasSavedAuth:!!AppConfig.getGatewayConnection()?.auth?.token})")));
        assert.equal(await c.evaluate("document.querySelector('[data-personalization-sync]').getBoundingClientRect().height>0"),true);
        if(name==="C"){
          assert.equal(syncReads.length,before);
          assert.equal(await c.evaluate("document.querySelector('[data-sync-status]').textContent"),"尚未连接映我同步服务。");
          assert.equal(await c.evaluate("document.querySelector('[data-sync-connect]').hidden"),false);
          assert.equal(await c.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),true);
        }else{
          assert.ok(syncReads.length>before);assert.equal(await c.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),false);
          if(name==="B"){
            await c.evaluate("AppConfig.saveProviderConfig({...AppConfig.getProviderConfig(),baseUrl:'https://another-provider.example/v1',auth:{type:'bearer',token:'another-fake-third-party'}})");
            await c.navigate("/space/");assert.equal(await c.evaluate("PersonalizationSync.status"),"uninitialized");
          }
        }
        await c.screenshot(`gateway-profile-${name}.png`);
        if(name==="C"){
          await c.evaluate("document.querySelector('[data-sync-connect]').click()");
          await until(()=>c.evaluate("location.pathname==='/settings.html' && document.querySelector('[data-gateway-dialog]')?.open"),"existing Gateway configuration dialog");
          await c.evaluate("document.querySelector('[name=credential]').value='fake-browser-key';document.querySelector('[data-gateway-dialog] form').requestSubmit()");
          await until(()=>c.evaluate("!!AppConfig.getGatewayConnection()?.auth?.token"),"explicit Gateway connection");
          assert.equal(await c.evaluate("AppConfig.getProviderConfig().baseUrl"),providerBase);
          await c.navigate("/space/");assert.equal(await c.evaluate("PersonalizationSync.status"),"uninitialized");
          await c.navigate("/settings.html?connection=gateway#model");
          await until(()=>c.evaluate("document.querySelector('[data-gateway-dialog]')?.open"),"disconnect dialog");
          await c.evaluate("document.querySelector('[data-disconnect-gateway]').click()");
          await c.navigate("/space/");assert.equal(await c.evaluate("PersonalizationSync.status"),"disconnected");
        }
      }
      assert.ok(syncReads.every(r=>r.validAuth));assert.equal(syncWrites,0);assert.equal(bootstrapCalls,0);assert.equal(store.read(),null);
      const report={passed:true,profiles:["A Gateway: uninitialized","B third-party with saved Gateway: uninitialized","C third-party without Gateway: disconnected, no request"],canonicalOrigin:origin,allReadsUseGatewayCredential:true,providerSwitchPreservesConnection:true,existingDialogConnectAndDisconnect:true,bootstrapCalls,syncWrites,initialized:false,productionTouched:false};
      fs.writeFileSync(path.join(output,"connections-report.json"),JSON.stringify(report,null,2));console.log("v79 A/B/C read-only connection acceptance passed");return;
    }
    const a=await browser("desktop-a",false);await a.navigate("/index.html");
    await a.evaluate("document.querySelector('a[href=\"/space/\"]').click()");
    await until(()=>a.evaluate("location.pathname==='/space/' && PersonalizationSync.status==='uninitialized' && !PersonalizationSync.busy"),"real Settings navigation");
    const visible = selector => `(()=>{const n=document.querySelector(${JSON.stringify(selector)});return !!n && !n.hidden && n.getBoundingClientRect().height>0 && getComputedStyle(n).visibility!=='hidden';})()`;
    for(const width of [1365,390]){
      await a.send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width===390});
      assert.equal(await a.evaluate(visible('[data-personalization-sync]')),true);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-status]').textContent"),"尚未初始化");
      assert.equal(await a.evaluate(visible('[data-sync-bootstrap]')),true);
      assert.equal(await a.evaluate("document.querySelector('[data-sync-now]').hidden"),true);
      assert.equal(await a.evaluate("document.documentElement.scrollWidth > innerWidth+1"),false);
      await a.screenshot(`settings-uninitialized-${width}.png`);
    }
    for(const selector of ['[data-theme-modes]','[data-avatar-upload]','[data-background-url]','[data-font-url]','[data-reset-space]'])assert.equal(await a.evaluate(visible(selector)),true);
    await a.send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
    assert.equal(store.read(),null);assert.equal(bootstrapCalls,0);
    await a.evaluate(`(()=>{const image=color=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,80,80);return canvas.toDataURL('image/png');};const p=new CompanionUserPreferences.UserPreferenceStore();p.saveAvatar({imageData:image('#e8875b'),crop:{x:23,y:61},scale:1.4},'user');p.saveAvatar({imageData:image('#508ca0'),crop:{x:60,y:30},scale:1.2},'chen');p.saveChatBackground({imageData:image('#bddbc3'),position:'center',size:'cover',overlay:.35});XinbanThemeStore.applyTheme(XinbanThemes.PRESET_THEMES[1]);})()`);
    assert.equal(store.read(),null);await a.evaluate("document.querySelector('[data-sync-bootstrap]').click()");await until(()=>store.read()&&a.evaluate("PersonalizationSync.status==='synced'&&!PersonalizationSync.busy"),"bootstrap");
    assert.equal(bootstrapCalls,1);
    assert.equal(await a.evaluate("document.querySelector('[data-sync-status]').textContent"),"已同步");
    assert.equal(await a.evaluate(visible('[data-sync-now]')),true);
    assert.equal(await a.evaluate("document.querySelector('[data-sync-bootstrap]').hidden"),true);
    assert.notEqual(await a.evaluate("document.querySelector('[data-sync-time]').textContent"),"尚未同步");
    await a.screenshot("settings-synced-desktop.png");
    const cloudA=store.read(),avatarA=cloudA.sections.identity.data,backgroundA=cloudA.sections.appearance.data.chatBackground.imageData;
    const b=await browser("mobile-b",true);await b.navigate("/index.html");
    assert.deepEqual(await b.evaluate("PersonalizationSync.capture().identity"),avatarA);assert.equal(await b.evaluate("PersonalizationSync.capture().appearance.chatBackground.imageData"),backgroundA);assert.equal(await b.evaluate("XinbanThemeStore.getActive().id"),cloudA.sections.appearance.data.activeTheme.id);
    await until(()=>b.evaluate("[...document.querySelectorAll('[data-relationship-avatar]')].every(n=>n.classList.contains('has-avatar-image'))"),"mobile avatar images loaded");await b.screenshot("mobile-home.png");
    await b.navigate("/space/");assert.equal(await b.evaluate(visible("[data-sync-now]")),true);await b.screenshot("settings-synced-mobile.png");await b.evaluate(`(()=>{const p=new CompanionUserPreferences.UserPreferenceStore();p.saveChatBackground({imageData:${JSON.stringify(avatarA.chenAvatar.imageData)}});})()`);await until(()=>store.read().sections.appearance.revision===2,"mobile background patch");
    await a.evaluate("PersonalizationSync.sync()");assert.equal(await a.evaluate("PersonalizationSync.capture().appearance.chatBackground.imageData"),avatarA.chenAvatar.imageData);assert.deepEqual(store.read().sections.identity.data,avatarA);assert.equal(store.read().sections.identity.revision,1);
    await b.navigate("/chat.html");await until(()=>b.evaluate("document.querySelector('.chat-avatar')?.classList.contains('has-avatar-image')"),"Chat avatar");assert.ok((await b.evaluate("document.querySelector('.chat-shell').style.getPropertyValue('--chat-bg-image')")).includes(avatarA.chenAvatar.imageData));
    await b.evaluate("document.querySelector('[data-open-voice-session]').click()");await until(()=>b.evaluate("Boolean(document.querySelector('[data-vs-avatar] img')?.complete)"),"Voice avatar");await b.screenshot("mobile-voice.png");
    const overflow=await b.evaluate("document.documentElement.scrollWidth > innerWidth+1");assert.equal(overflow,false);
    await a.navigate("/index.html");await a.screenshot("desktop-home.png");
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify({passed:true,separateProfiles:true,bootstrapExplicit:true,avatarMatch:true,cropMatch:true,backgroundRoundTrip:true,themeMatch:true,homeChatVoice:true,mobileOverflow:false,identityRevision:store.read().sections.identity.revision,appearanceRevision:store.read().sections.appearance.revision,assetCount:assetStore.list().length,productionTouched:false},null,2));
    console.log("v79 two-profile acceptance passed; artifacts: "+output);
  } finally {for(const c of clients)c.socket.close();for(const child of children)child.kill("SIGTERM");await app.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
