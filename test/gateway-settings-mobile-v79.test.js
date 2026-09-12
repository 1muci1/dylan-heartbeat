"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
async function fixture(t){
 const dom=new JSDOM(fs.readFileSync('frontend-p4b/settings.html','utf8'),{url:'https://chat.xiaowo.homes/settings.html',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());await new Promise(resolve=>w.addEventListener('DOMContentLoaded',resolve,{once:true}));
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.Headers=Headers;w.AppProvider={};
 for(const file of ['frontend-p4b/assets/js/data.js','ai-companion-frontend/shared/provider-config-panel.js','frontend-p4b/assets/js/theme-gateway.js'])w.eval(fs.readFileSync(file,'utf8'));
 w.AppConfig.saveProviderConfig({type:'gateway',mode:'real',baseUrl:'https://third.example/v1',model:'fake',auth:{type:'bearer',token:'fake-third-party'}});
 const calls=[];w.fetch=async(url,options)=>{calls.push({url,options});return {ok:options.headers.get('Authorization')==='Bearer fake-valid',status:401,json:async()=>({ok:true,data:{initialized:false,state:null}})};};
 w.eval(fs.readFileSync('frontend-p4b/assets/js/settings.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 const d=w.document,dialog=d.querySelector('[data-gateway-dialog]'),form=dialog.querySelector('form'),status=d.querySelector('[data-gateway-status]');
 const save=async()=>{form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(resolve=>setImmediate(resolve));};
 return {w,d,dialog,form,status,calls,save};
}
test('Gateway entry owns credential form; missing and failed credentials give safe feedback without replacing connection',async t=>{
 const f=await fixture(t);f.d.querySelector('[data-sync-connect]').click();assert.ok(f.dialog.open);assert.equal(f.d.querySelector('[data-global-provider-dialog]').open,false);
 assert.equal(f.form.elements.credential.value,'');await f.save();assert.match(f.status.textContent,/GATEWAY_NOT_CONNECTED/);assert.equal(f.calls.length,0);
 f.form.elements.credential.value='fake-valid';await f.save();assert.equal(f.dialog.open,false);assert.equal(f.w.AppConfig.getGatewayConnection().auth.token,'fake-valid');
 const before=JSON.stringify(f.w.AppConfig.getGatewayConnection());f.d.querySelector('[data-open-gateway]').click();f.form.elements.credential.value='fake-invalid';await f.save();assert.ok(f.dialog.open);assert.match(f.status.textContent,/GATEWAY_AUTH_FAILED/);assert.equal(JSON.stringify(f.w.AppConfig.getGatewayConnection()),before);
 assert.ok(f.calls.every(c=>c.options.headers.get('Authorization')!=='Bearer fake-third-party'));assert.ok(f.calls.every(c=>!c.options.method||c.options.method==='GET'));
 assert.equal(f.w.AppConfig.getProviderConfig().baseUrl,'https://third.example/v1');
});
test('network and local storage failures remain visible and never expose response details',async t=>{
 const f=await fixture(t);f.d.querySelector('[data-open-gateway]').click();f.form.elements.credential.value='fake-valid';
 f.w.fetch=async()=>{throw new TypeError('private response fixture');};await f.save();assert.match(f.status.textContent,/GATEWAY_CONNECTION_FAILED/);assert.doesNotMatch(f.status.textContent,/private response/);assert.equal(f.form.querySelector('[type=submit]').disabled,false);assert.ok(f.dialog.open);
 f.w.fetch=async()=>({ok:true,json:async()=>({ok:true,data:{initialized:false,state:null}})});
 f.w.Storage.prototype.setItem=function(){throw new f.w.DOMException('fixture','QuotaExceededError');};
 await f.save();assert.match(f.status.textContent,/STORAGE_QUOTA_EXCEEDED/);assert.equal(f.w.AppConfig.getGatewayConnection(),null);assert.ok(f.dialog.open);
});
