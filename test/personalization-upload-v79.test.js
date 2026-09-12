"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Fastify=require('fastify');
const Gateway=require('../frontend-p4b/assets/js/theme-gateway');
const {SyncClient}=require('../frontend-p4b/assets/js/personalization-sync');
const {ThemeAssetStore}=require('../theme-asset-service');
const {registerThemeAssetRoutes}=require('../theme-asset-routes');
const images=require('./fixtures/personalization-images-v79.json');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v79-upload-')),events=[],calls=[],received=[];
 const store=new ThemeAssetStore({rootDir:root,eventStore:{create:e=>events.push(e)}}),original=store.upload.bind(store);
 store.upload=(bytes,options)=>{received.push({bytes,options});return original(bytes,options)};
 const app=Fastify({logger:false});await app.register(require('@fastify/multipart'));registerThemeAssetRoutes(app,{store,apiKey:'fake-key'});await app.ready();
 t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true})});
 const w={Blob,File,FormData,atob,location:{origin:'http://fixture.test',hostname:'fixture.test'},AppConfig:{getGatewayConnection:()=>({baseUrl:'http://fixture.test',auth:{token:'fake-key'}})},fetch:async(url,options)=>{
  assert.equal(url,'http://fixture.test/api/theme/assets/upload');assert.equal(options.headers.get('Authorization'),'Bearer fake-key');
  assert.equal(options.headers.has('Content-Type'),false);assert.ok(options.body instanceof FormData);assert.deepEqual([...options.body.keys()],['file']);
  const req=new Request(url,options);assert.match(req.headers.get('content-type'),/^multipart\/form-data; boundary=/);
  const response=await app.inject({url:'/api/theme/assets/upload',method:req.method,headers:Object.fromEntries(req.headers),payload:Buffer.from(await req.arrayBuffer())});calls.push(response.statusCode);
  return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.json()};
 }};return {w,calls,received,store,events};
}
for(const [slot,type] of [['userAvatar','png'],['chenAvatar','jpeg'],['chatBackground','webp']])test(`v79 ${slot} ${type} data URL uses real multipart validator`,async t=>{
 const f=await fixture(t);const payload=await Gateway.uploadThemeAsset(images[type],f.w);
 assert.match(payload.data.id,/^[0-9a-f-]{36}$/);assert.deepEqual(f.calls,[200]);assert.equal(f.received[0].options.mimeType,'image/'+type);
 assert.deepEqual(f.received[0].bytes,Buffer.from(images[type].split(',')[1],'base64'));assert.equal(f.store.list().length,1);
});
test('v79 Workshop File and migration data URL share identical upload bytes and MIME',async t=>{
 const f=await fixture(t),bytes=Buffer.from(images.png.split(',')[1],'base64');
 await Gateway.uploadThemeAsset(new File([bytes],'fixture.png',{type:'image/png'}),f.w);await Gateway.uploadThemeAsset(images.png,f.w);
 assert.deepEqual(f.received[0].bytes,f.received[1].bytes);assert.equal(f.received[0].options.mimeType,f.received[1].options.mimeType);
});
test('v79 previous inline uploader also satisfies multipart for known-good fixtures (no assumed boundary defect)',async t=>{
 const f=await fixture(t);for(const data of Object.values(images)){const [header,content]=data.split(','),mime=header.slice(5,header.indexOf(';')),bytes=Uint8Array.from(atob(content),c=>c.charCodeAt(0)),body=new FormData();body.append('file',new Blob([bytes],{type:mime}),`personalization.${mime.split('/')[1]}`);await Gateway.requestFirstParty('/api/theme/assets/upload',{method:'POST',body},f.w);}assert.deepEqual(f.calls,[200,200,200]);
});
for(const [input,code] of [['data:image/gif;base64,R0lGODlh','LOCAL_ASSET_TYPE_UNSUPPORTED'],['data:image/png;base64,%%%','LOCAL_ASSET_MALFORMED'],['data:image/png;base64,A===','LOCAL_ASSET_MALFORMED'],['https://external.example/private.png','LOCAL_ASSET_UNSUPPORTED']])test(`v79 rejects ${code} before upload`,async t=>{
 const f=await fixture(t);await assert.rejects(Gateway.uploadThemeAsset(input,f.w),e=>e.code===code);assert.equal(f.calls.length,0);
});
test('v79 same-origin object URL and Blob use canonical uploader; unreadable and foreign URLs fail safely',async t=>{
 const f=await fixture(t),fetch=f.w.fetch,blob=new Blob([Buffer.from(images.png.split(',')[1],'base64')],{type:'image/png'});let reads=0;
 f.w.fetch=async(url,options)=>url.startsWith('blob:')?(reads++,{ok:true,blob:async()=>blob}):fetch(url,options);
 await Gateway.uploadThemeAsset('blob:http://fixture.test/fixture-id',f.w);await Gateway.uploadThemeAsset(blob,f.w);assert.deepEqual(f.calls,[200,200]);
 await assert.rejects(Gateway.uploadThemeAsset('blob:https://foreign.example/id',f.w),e=>e.code==='LOCAL_ASSET_UNREADABLE');assert.equal(reads,1);
 f.w.fetch=async()=>{throw Error('private source detail')};await assert.rejects(Gateway.uploadThemeAsset('blob:http://fixture.test/expired',f.w),e=>e.code==='LOCAL_ASSET_UNREADABLE'&&!e.message.includes('private'));
});
function candidate(){return {identity:{userAvatar:{imageData:images.png},chenAvatar:{imageData:images.jpeg}},appearance:{chatBackground:{imageData:images.webp}}};}
function client(upload){const c=Object.create(SyncClient.prototype);Object.assign(c,{busy:false,cloud:null,images:new Map(),pending:{},meta:{},onStatus:()=>{},capture:candidate,preferences:{loadSync:()=>({avatar:{}})},backup:{ensure:async identity=>({verified:structuredClone(identity)})},upload,now:()=>new Date(0),apply:()=>{},persist:()=>{}});return c;}
test('v79 canonical asset references reused without upload, including voice background',async()=>{
 const c=client(async()=>{throw Error('unexpected upload')}),ref='/api/theme/assets/11111111-1111-4111-8111-111111111111';
 const input={identity:{userAvatar:{imageData:ref}},voicePortable:{voiceSession:{backgroundAssetId:ref.split('/').at(-1)}}};assert.deepEqual(await c.prepare(input),input);
});
test('v79 a slot upload failure stops migration before bootstrap and retains uninitialized state',async()=>{
 let uploads=0,posts=0;const c=client(async()=>{if(++uploads===2)throw Object.assign(Error('private'),{status:415,code:'THEME_ASSET_MAGIC_INVALID'});return '/api/theme/assets/11111111-1111-4111-8111-111111111111'});
 c.request=async(p,o)=>{if(o?.method==='POST')posts++;return {data:{initialized:false,state:null}}};await c.bootstrap();
 assert.equal(uploads,2);assert.equal(posts,0);assert.equal(c.cloud,null);assert.equal(c.serverInitialized,false);assert.deepEqual(c.migrationError,{stage:'asset-upload',slot:'chenAvatar',status:415,code:'THEME_ASSET_MAGIC_INVALID'});
});
test('v79 all three images migrate before exactly one bootstrap; candidate never contains legacy images',async t=>{
 const f=await fixture(t);let posts=0;const c=client(async source=>'/api/theme/assets/'+(await Gateway.uploadThemeAsset(source,f.w)).data.id);
 c.request=async(p,o)=>{if(!o?.method)return {data:{initialized:false,state:null}};posts++;assert.equal(f.calls.length,3);assert.equal(o.method,'POST');assert.equal(p,'/api/personalization/bootstrap');const sections=JSON.parse(o.body).sections;assert.doesNotMatch(o.body,/data:|base64|fake-key/);return {data:{initialized:true,state:{sections:Object.fromEntries(Object.entries(sections).map(([key,data])=>[key,{data,revision:1}]))}}}};
 // Include the portable section expected by the success application loop.
 const base=c.capture;c.capture=()=>({...base(),voicePortable:{}});await c.bootstrap();assert.equal(posts,1);assert.equal(c.status,'synced');assert.equal(c.serverInitialized,true);
});
for(const [slot,data] of [['userAvatar',{identity:{userAvatar:{imageData:images.png}}}],['chatBackground',{appearance:{chatBackground:{imageData:images.png}}}],['voiceBackground',{voicePortable:{voiceSession:{backgroundAssetId:images.png}}}],['themeVisualSlot',{appearance:{activeTheme:{visualSlots:{pageBackground:{url:images.png}}}}}]])test(`v79 safe diagnostic identifies ${slot}`,async()=>{
 const c=client(async()=>{throw Object.assign(Error('private image'),{status:415,code:'private-data'})});await assert.rejects(c.prepare(data));assert.deepEqual(c.migrationError,{stage:'asset-upload',slot,status:415,code:'SYNC_REQUEST_FAILED'});
});
test('v79 legacy blob references remain migration candidates instead of silently becoming null',()=>{
 const {JSDOM}=require('jsdom'),Prefs=require('../ai-companion-frontend/storage/user-preference-store'),Themes=require('../frontend-p4b/assets/js/theme-store'),Voice=require('../frontend-p4b/assets/js/voice-adapter');const dom=new JSDOM('',{url:'https://fixture.test'});
 try{const storage=dom.window.localStorage,preferences=new Prefs.UserPreferenceStore({storage,eventTarget:null});storage.setItem(Prefs.STORAGE_KEY,JSON.stringify({avatar:{userAvatar:{imageData:'blob:https://fixture.test/user'},chenAvatar:{imageData:'blob:https://fixture.test/chen'}},chatBackground:{imageData:'blob:https://fixture.test/background'}}));
 const c=new SyncClient({preferences,themes:new Themes.ThemeStore({storage,documentRef:dom.window.document}),voice:new Voice.VoiceSettingsStore(storage),storage,request:async()=>{},upload:async()=>{}}),candidate=c.capture();assert.equal(candidate.identity.userAvatar.imageData,'blob:https://fixture.test/user');assert.equal(candidate.identity.chenAvatar.imageData,'blob:https://fixture.test/chen');assert.equal(candidate.appearance.chatBackground.imageData,'blob:https://fixture.test/background');}finally{dom.window.close()}
});
test('v79 only explicit bootstrap flags avatars for normalization; crop is unchanged',async()=>{
 const options=[],c=client(async(source,option)=>{options.push(option);return '/api/theme/assets/11111111-1111-4111-8111-111111111111'});
 const data=candidate();data.identity.userAvatar.crop={x:23,y:61};data.identity.userAvatar.scale=1.4;
 const prepared=await c.prepare(data,true);assert.deepEqual(options,[{normalizeAvatar:true},{normalizeAvatar:true},{normalizeAvatar:false}]);
 assert.deepEqual(prepared.identity.userAvatar.crop,data.identity.userAvatar.crop);assert.equal(prepared.identity.userAvatar.scale,1.4);assert.equal(data.identity.userAvatar.imageData,images.png);
 c.images.clear();options.length=0;await c.prepare(data);assert.ok(options.every(o=>o.normalizeAvatar===false));
});
test('v79 backup storage failure leaves original untouched and prevents bootstrap',async()=>{
 let posts=0;const c=client(async()=>'/api/theme/assets/11111111-1111-4111-8111-111111111111');
 c.backup={ensure:async()=>{throw Object.assign(Error(),{name:'QuotaExceededError'})}};
 c.request=async(p,o)=>{if(o?.method==='POST')posts++;return {data:{initialized:false,state:null}}};
 await c.bootstrap();assert.equal(posts,0);assert.equal(c.migrationError.code,'LOCAL_STORAGE_QUOTA_EXCEEDED');assert.equal(c.serverInitialized,false);assert.equal(c.capture().identity.userAvatar.imageData,images.png);
});
