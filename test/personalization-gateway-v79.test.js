"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {requestFirstParty,resolveGatewayUrl}=require('../frontend-p4b/assets/js/theme-gateway');
const {errorStatus}=require('../frontend-p4b/assets/js/personalization-sync');
const canonical='https://api.xiaowo.homes',location={hostname:'chat.xiaowo.homes',origin:'https://chat.xiaowo.homes'};
const empty={ok:true,data:{initialized:false,state:null}};
const gatewayConfig={baseUrl:canonical,auth:{token:'fake-gateway-key'}};
const saved={getGatewayConnection:()=>gatewayConfig};
for(const baseUrl of [canonical+'/v1','https://provider.example/v1'])test(`all sync methods resolve canonical origin with ${baseUrl}`,async()=>{
  const calls=[],w={location,AppConfig:{...saved,getProviderConfig:()=>({baseUrl,auth:{token:'fake-provider-secret'}})},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>empty}}};
  for(const [method,path] of [['GET','/api/personalization'],['POST','/api/personalization/bootstrap'],['PATCH','/api/personalization']]){
    await requestFirstParty(path,{method},w);
    const {url,options}=calls.at(-1);assert.equal(url,resolveGatewayUrl(path,{locationRef:location}));
    assert.equal(options.method,method);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
    assert.equal(options.headers.get('Authorization'),'Bearer fake-gateway-key');
  }
});
test('Provider changes never change sync URL or forward third-party credentials',async()=>{
  let baseUrl=canonical+'/v1';const calls=[],w={location,AppConfig:{...saved,getProviderConfig:()=>({baseUrl,auth:{token:'fake-secret'}})},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>empty}}};
  await requestFirstParty('/api/personalization',{},w);baseUrl='https://third.example/v1';await requestFirstParty('/api/personalization',{headers:{Authorization:'Bearer third-party'}},w);
  assert.equal(calls[0].url,calls[1].url);assert.equal(calls[1].options.headers.get('Authorization'),'Bearer fake-gateway-key');
});
for(const [status,expected] of [[401,'auth'],[403,'forbidden'],[404,'unavailable'],[409,'conflict'],[500,'serverError'],[503,'serverError']])test(`HTTP ${status} classified as ${expected}, never offline`,async()=>{
  const w={location,AppConfig:saved,fetch:async()=>({ok:false,status,json:async()=>({})})};await assert.rejects(requestFirstParty('/api/personalization',{},w),e=>errorStatus(e)===expected && errorStatus(e,true)===expected);
});
for(const payload of [null,{}, {ok:true,data:{}},{ok:true,data:{initialized:false}},{ok:true,data:{initialized:true,state:{}}}])test('malformed sync response is not offline',async()=>{
  const w={location,AppConfig:saved,fetch:async()=>({ok:true,json:async()=>payload})};await assert.rejects(requestFirstParty('/api/personalization',{},w),e=>errorStatus(e)==='invalidResponse');
});
test('fetch TypeError is offline; unrelated exceptions are not offline',async()=>{
  const w={location,AppConfig:saved,fetch:async()=>{throw new TypeError('fake network failure')}};
  await assert.rejects(requestFirstParty('/api/personalization',{},w),e=>errorStatus(e)==='offline');
  assert.equal(errorStatus(Error('fake internal failure')),'requestError');
  assert.equal(errorStatus(new TypeError('fake processing failure')),'requestError');
});
for(const [status,text] of [[401,'同步认证已失效，请重新连接映我 Gateway。'],[403,'当前设备无权访问同步服务。'],[404,'同步服务暂不可用。'],[500,'同步服务暂时异常，请稍后再试。'],[409,'冲突：另一台设备已经更新了此设置。'],[0,'当前离线，正在使用本地设置。'],[200,'同步服务响应异常。']])test(`Settings DOM renders safe message for ${status}`,async()=>{
  const fs=require('node:fs'),{JSDOM}=require('jsdom');
  const dom=new JSDOM(fs.readFileSync('ai-companion-frontend/space/index.html','utf8'),{url:'https://chat.xiaowo.homes/space/',runScripts:'outside-only'}),w=dom.window;
  try {
    w.Headers=Headers;w.AppConfig={...saved,getProviderConfig:()=>({baseUrl:canonical+'/v1',auth:{token:'fake-gateway-key'}})};
    w.fetch=async()=>{if(!status)throw new TypeError('fake network failure');return {ok:status===200,status,json:async()=>({})}};
    for(const file of ['frontend-p4b/assets/js/theme-store.js','ai-companion-frontend/storage/user-preference-store.js','frontend-p4b/assets/js/voice-adapter.js','frontend-p4b/assets/js/theme-gateway.js','frontend-p4b/assets/js/avatar-backup.js','frontend-p4b/assets/js/personalization-sync.js'])w.eval(fs.readFileSync(file,'utf8'));
    for(let i=0;i<30&&w.PersonalizationSync.busy;i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(w.document.querySelector('[data-sync-status]').textContent,text);
    assert.equal(w.document.querySelector('[data-sync-bootstrap]').hidden,true);
  } finally {w.close();}
});
