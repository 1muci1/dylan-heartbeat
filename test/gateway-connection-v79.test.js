"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const api=require('../frontend-p4b/assets/js/theme-gateway');
const config=token=>({type:'gateway',mode:'real',baseUrl:'https://api.xiaowo.homes/v1',auth:{type:'bearer',token}});
const empty={ok:true,data:{initialized:false,state:null}};
function setup(t){const dom=new JSDOM('',{url:'https://chat.xiaowo.homes',runScripts:'outside-only'}),w=dom.window;w.eval(fs.readFileSync('frontend-p4b/assets/js/data.js','utf8'));w.fetch=async()=>({ok:true,json:async()=>empty});t.after(()=>w.close());return w;}
test('validated existing Gateway connection persists independently through Provider switches and reload',async t=>{
 const w=setup(t),events=[];w.addEventListener('provider-config-change',e=>events.push(e.detail));w.addEventListener('gateway-connection-change',e=>events.push(e.detail));
 w.AppConfig.saveProviderConfig(config('fake-existing-gateway'));
 await api.ensureConnection(w);
 const before=JSON.stringify(w.AppConfig.getGatewayConnection());
 w.AppConfig.saveProviderConfig({...config('fake-third-party'),baseUrl:'https://third.example/v1',gatewayConnection:{auth:{token:'bad-override'}}});
 assert.equal(JSON.stringify(w.AppConfig.getGatewayConnection()),before);
 w.eval(fs.readFileSync('frontend-p4b/assets/js/data.js','utf8'));
 assert.equal(JSON.stringify(w.AppConfig.getGatewayConnection()),before);
 assert.equal(JSON.stringify(w.AppConfig.getProviderConfig()).includes('fake-existing-gateway'),false);
 assert.equal(JSON.stringify(events).includes('fake-existing-gateway'),false);
 assert.equal(JSON.stringify(events).includes('fake-third-party'),false);
 let used=false;w.fetch=async(url,options)=>{used=url==='https://api.xiaowo.homes/api/personalization'&&options.headers.get('Authorization')==='Bearer fake-existing-gateway';return {ok:true,json:async()=>empty}};
 await api.requestFirstParty('/api/personalization',{},w);assert.ok(used);
});
test('failed validation preserves saved connection; successful rotation updates it',async t=>{
 const w=setup(t);await api.connect(config('fake-old'),w);const before=JSON.stringify(w.AppConfig.getGatewayConnection());
 w.fetch=async()=>({ok:false,status:401,json:async()=>({})});await assert.rejects(api.connect(config('fake-new'),w));assert.equal(JSON.stringify(w.AppConfig.getGatewayConnection()),before);
 w.fetch=async()=>({ok:true,json:async()=>empty});await api.connect(config('fake-new'),w);assert.ok(w.AppConfig.getGatewayConnection().auth.token==='fake-new');
});
test('explicit disconnect prevents automatic remigration; missing connection never fetches',async t=>{
 const w=setup(t);w.AppConfig.saveProviderConfig(config('fake-existing'));await api.ensureConnection(w);api.disconnect(w);let calls=0;w.fetch=async()=>{calls++;throw Error('unexpected')};
 await api.ensureConnection(w);await assert.rejects(api.requestFirstParty('/api/personalization',{},w),e=>e.code==='GATEWAY_NOT_CONNECTED');assert.equal(calls,0);
});
test('third-party-only device does not migrate credentials or make any sync request',async t=>{
 const w=setup(t);w.AppConfig.saveProviderConfig({...config('fake-third'),baseUrl:'https://third.example/v1'});let calls=0;w.fetch=async()=>{calls++;throw Error('unexpected')};await api.ensureConnection(w);
 for(const method of ['GET','POST','PATCH'])await assert.rejects(api.requestFirstParty('/api/personalization',{method},w),e=>e.code==='GATEWAY_NOT_CONNECTED');
 assert.equal(calls,0);assert.equal(w.AppConfig.getGatewayConnection(),null);
});
