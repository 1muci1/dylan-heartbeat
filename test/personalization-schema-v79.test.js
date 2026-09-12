"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM}=require('jsdom'),Fastify=require('fastify');
const {SyncClient}=require('../frontend-p4b/assets/js/personalization-sync'),Gateway=require('../frontend-p4b/assets/js/theme-gateway');
const {UserPreferenceStore}=require('../ai-companion-frontend/storage/user-preference-store'),{AvatarStudio,AVATAR_BORDERS}=require('../ai-companion-frontend/avatar/avatar-studio');
const Themes=require('../frontend-p4b/assets/js/theme-store'),Voice=require('../frontend-p4b/assets/js/voice-adapter');
const {PersonalizationStore,validateSection}=require('../personalization-store'),{registerPersonalizationRoutes}=require('../personalization-routes');
const {ThemeAssetStore}=require('../theme-asset-service'),{registerThemeAssetRoutes}=require('../theme-asset-routes');
const images=require('./fixtures/personalization-images-v79.json');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v79-schema-')),dom=new JSDOM('',{url:'http://fixture.test'}),storage=dom.window.localStorage,events=[],calls=[],bodies=[];
 const eventStore={create:e=>events.push(e)},assets=new ThemeAssetStore({rootDir:path.join(root,'assets'),eventStore}),store=new PersonalizationStore({rootDir:path.join(root,'cloud'),eventStore,assetStore:assets});
 const app=Fastify({logger:false});await app.register(require('@fastify/multipart'));registerPersonalizationRoutes(app,{store,apiKey:'fake-key'});registerThemeAssetRoutes(app,{store:assets,personalizationStore:store,apiKey:'fake-key'});await app.ready();
 t.after(async()=>{await app.close();dom.window.close();fs.rmSync(root,{recursive:true,force:true})});
 const w={Blob,File,FormData,atob,location:{origin:'http://fixture.test',hostname:'fixture.test'},AppConfig:{getGatewayConnection:()=>({baseUrl:'http://fixture.test',auth:{token:'fake-key'}})},fetch:async(url,options)=>{
  const req=new Request(url,options),route=new URL(url).pathname;assert.equal(new URL(url).origin,'http://fixture.test');
  if(route==='/api/personalization/bootstrap')bodies.push(JSON.parse(options.body));
  const response=await app.inject({url:route,method:req.method,headers:Object.fromEntries(req.headers),...(req.method==='GET'?{}:{payload:Buffer.from(await req.arrayBuffer())})});calls.push({route,method:req.method,status:response.statusCode});
  return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.json()};
 }};
 const preferences=new UserPreferenceStore({storage,eventTarget:null}),studio=new AvatarStudio({persistenceAdapter:preferences}),themes=new Themes.ThemeStore({storage,documentRef:dom.window.document}),voice=new Voice.VoiceSettingsStore(storage);
 const client=new SyncClient({backup:{ensure:async identity=>({verified:structuredClone(identity)})},preferences,themes,voice,storage,request:(route,options)=>Gateway.requestFirstParty(route,options,w),upload:async source=>'/api/theme/assets/'+(await Gateway.uploadThemeAsset(source,w)).data.id});
 for(const [id,imageData] of [['user',images.png],['chen',images.jpeg]])studio.save({...studio.defaultChen(),id,crop:{x:23,y:61,zoom:1.4},frame:{...studio.defaultChen().frame,border:'minimal'}},{imageData});
 preferences.saveChatBackground({imageData:images.webp,position:'center',size:'cover',overlay:.3,blur:2,imageOpacity:.8});
 const themeAsset='/api/theme/assets/'+assets.upload(Buffer.from(images.png.split(',')[1],'base64'),{mimeType:'image/png',filename:'fixture.png'}).id;
 const theme=JSON.parse(JSON.stringify(Themes.DEFAULT_THEME));theme.assets.backgroundImage=images.webp;theme.visualSlots.enabledByUser=true;theme.visualSlots.pageBackground={...theme.visualSlots.pageBackground,enabled:true,url:themeAsset};theme.customDesign.regions['home.hero']={...Themes.DESIGN_REGION_DEFAULT,enabled:true,image:{...Themes.DESIGN_REGION_DEFAULT.image,enabled:true,url:themeAsset}};themes.applyTheme(theme);
 voice.save({...voice.load(),voiceURI:'fake-device-only',voiceName:'fake-device-only',voiceLang:'fake-device-only',voiceSession:{continuousConversation:true,autoSpeak:true,backgroundMode:'custom',backgroundAssetId:themeAsset.split('/').at(-1)}});
 storage.setItem('xinban-provider-config-v1',JSON.stringify({auth:{token:'fake-private-secret'}}));
 return {client,preferences,studio,themes,voice,storage,store,assets,calls,bodies,events};
}
test('AvatarStudio local crop.zoom reproduces real validator rejection; wire mapping preserves scale and all three sections',async t=>{
 const f=await fixture(t),local=f.preferences.getAvatar('chen');assert.equal(typeof local.crop.zoom,'number');
 const candidate=f.client.capture(),prepared=await f.client.prepare(candidate,true);
 for(const name of ['userAvatar','chenAvatar']){
  const old={...prepared.identity[name],crop:{...prepared.identity[name].crop,zoom:local.crop.zoom}};
  assert.throws(()=>validateSection('identity',{[name]:old}),e=>e.code==='INVALID_PERSONALIZATION');
  assert.deepEqual(prepared.identity[name].crop,{x:23,y:61});assert.equal(prepared.identity[name].scale,1.4);
 }
 for(const section of ['identity','appearance','voicePortable'])assert.doesNotThrow(()=>validateSection(section,prepared[section]));
 // Exercise the actual captured JSON body, multipart uploads, route, validator, and persisted state.
 await f.client.start();await f.client.bootstrap();assert.equal(f.client.status,'synced');assert.equal(f.store.get().initialized,true);assert.equal(f.store.read().revision,1);
 assert.equal(f.calls.filter(c=>c.route==='/api/theme/assets/upload').length,3);assert.equal(f.assets.list().length,4);
 assert.equal(f.bodies.length,1);const body=f.bodies[0];assert.deepEqual(Object.keys(body),['sections']);assert.deepEqual(Object.keys(body.sections),['identity','appearance','voicePortable']);
 assert.doesNotMatch(JSON.stringify(body),/data:|base64|fake-private-secret|fake-device-only|voiceURI|voiceName|voiceLang|gatewayConnection/);
 for(const section of Object.keys(body.sections))assert.deepEqual(f.store.read().sections[section].data,validateSection(section,body.sections[section]));
 const appearance=body.sections.appearance;assert.deepEqual(appearance.activeTheme.tokens,candidate.appearance.activeTheme.tokens);assert.equal(appearance.activeTheme.visualSlots.pageBackground.enabled,true);assert.equal(appearance.activeTheme.customDesign.regions['home.hero'].image.enabled,true);
 assert.match(appearance.chatBackground.imageData,/^\/api\/theme\/assets\//);assert.match(appearance.activeTheme.visualSlots.pageBackground.url,/^\/api\/theme\/assets\//);assert.match(appearance.activeTheme.customDesign.regions['home.hero'].image.url,/^\/api\/theme\/assets\//);
 assert.equal(f.studio.defaultChen().crop.zoom,1.4);assert.equal(f.preferences.getAvatar('chen').border,'minimal');
 // Cloud GET data and PATCH use the same canonical section schema, not revision wrappers as data.
 assert.match(body.sections.voicePortable.voiceSession.backgroundAssetId,/^[0-9a-f-]{36}$/);
 assert.match(appearance.activeTheme.assets.backgroundImage,/^\/api\/theme\/assets\//);
 const get=await f.client.request('/api/personalization');assert.equal(get.data.state.version,1);
 const patch=await f.client.request('/api/personalization',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({section:'identity',baseRevision:1,patch:body.sections.identity})});assert.equal(patch.data.state.sections.identity.revision,2);
 assert.doesNotMatch(JSON.stringify(f.events),/imageData|base64|fake-private/);
});
test('legacy zoom-only capture preserves zoom; explicit renderer scale remains authoritative',async t=>{
 const f=await fixture(t);f.storage.setItem('xinban-user-preferences-v1',JSON.stringify({avatar:{chenAvatar:{imageData:images.png,crop:{x:12,y:78,zoom:1.7}}}}));
 assert.equal(f.client.capture().identity.chenAvatar.scale,1.7);assert.deepEqual(f.client.capture().identity.chenAvatar.crop,{x:12,y:78});
 f.preferences.saveAvatar({scale:1.2},'chen');assert.equal(f.client.capture().identity.chenAvatar.scale,1.2);
});
test('all supported AvatarStudio border enums round-trip, unknown fields/types and unsafe references remain rejected',async t=>{
 const f=await fixture(t),prepared=await f.client.prepare(f.client.capture(),true),avatar=prepared.identity.chenAvatar;
 for(const border of AVATAR_BORDERS)assert.equal(validateSection('identity',{chenAvatar:{...avatar,border}}).chenAvatar.border,border);
 for(const bad of [{...avatar,border:'invalid'},{...avatar,scale:'1.4'},{...avatar,crop:{x:23,y:61,unexpected:1}},{...avatar,imageData:images.png},{...avatar,scale:null}])assert.throws(()=>validateSection('identity',{chenAvatar:bad}),e=>e.code==='INVALID_PERSONALIZATION');
 for(const [section,bad] of [['appearance',{...prepared.appearance,activeTheme:{...prepared.appearance.activeTheme,visualSlots:null}}],['voicePortable',{...prepared.voicePortable,voiceURI:'fake-local'}],['voicePortable',{...prepared.voicePortable,voiceSession:{...prepared.voicePortable.voiceSession,voiceName:'fake-local'}}]])assert.throws(()=>validateSection(section,bad),e=>e.code==='INVALID_PERSONALIZATION');
 const original=f.client.capture.bind(f.client);f.client.capture=()=>{const data=original();data.identity.chenAvatar.crop.unexpected=1;return data};await f.client.start();await f.client.bootstrap();assert.equal(f.client.serverInitialized,false);assert.equal(f.client.cloud,null);assert.equal(f.store.get().initialized,false);assert.equal(f.client.migrationError.code,'INVALID_PERSONALIZATION');assert.equal(f.client.migrationError.status,400);
});

test('bootstrap requires plain section data and rejects local metadata or cloud revision wrappers',async t=>{
 const f=await fixture(t),sections=await f.client.prepare(f.client.capture(),true);
 for(const body of [{version:1,sections},{revision:0,sections},{sections:{...sections,identity:{revision:1,data:sections.identity}}},{sections:{identity:sections.identity,appearance:sections.appearance}}]){
  await assert.rejects(f.client.request('/api/personalization/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),e=>e.status===400&&e.code==='INVALID_PERSONALIZATION');
  assert.equal(f.store.get().initialized,false);
 }
});
