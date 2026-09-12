"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Themes = require("./frontend-p4b/assets/js/theme-store");
const { sanitizeTheme } = require("./theme-preset-service");
const Voice = require("./frontend-p4b/assets/js/voice-adapter");
const SECTIONS = ["identity", "appearance", "voicePortable"];
const ASSET = /^\/api\/theme\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
class PersonalizationError extends Error {
  constructor(code = "INVALID_PERSONALIZATION", statusCode = 400) { super(code); this.code = code; this.statusCode = statusCode; }
}
const invalid = () => { throw new PersonalizationError(); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
function keys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function number(value, min, max) { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid(); return value; }
function choice(value, allowed) { if (!allowed.includes(value)) invalid(); return value; }
function reference(value) { if (value !== null && value !== "" && (typeof value !== "string" || !ASSET.test(value))) invalid(); return value || null; }
function avatar(value) {
  if (value === null) return null;
  keys(value, ["imageData", "crop", "scale", "border", "source"]);
  const result = { imageData: reference(value.imageData), crop: { x:50, y:50 }, scale:1 };
  if (value.crop !== undefined) { keys(value.crop,["x","y"]); result.crop = {x:number(value.crop.x,0,100),y:number(value.crop.y,0,100)}; }
  if (value.scale !== undefined) result.scale = number(value.scale,1,5);
  if (value.border !== undefined) result.border = choice(value.border,["moon","none","soft","glow","simple","minimal"]);
  return result;
}
function template(value, shape) {
  keys(value,Object.keys(shape));
  for (const [key, child] of Object.entries(value)) {
    if (object(shape[key])) template(child,shape[key]);
    else if (typeof child !== typeof shape[key] || (typeof child === "number" && !Number.isFinite(child))) invalid();
  }
}
function theme(value) {
  const allowed = ["id","name","source","accentMode","accentExplicit","tokens","assets","visualSlots","customDesign","layout","harmonyVersion","migratedVisualSlotsSafe"];
  keys(value,allowed);
  for (const key of ["tokens","assets","layout","visualSlots"]) if (value[key] !== undefined) template(value[key],Themes.DEFAULT_THEME[key]);
  if (value.customDesign !== undefined) {
    keys(value.customDesign,["version","regions"]);
    if (value.customDesign.version !== 1) invalid();
    keys(value.customDesign.regions,Object.keys(Themes.DESIGN_REGIONS));
    for (const region of Object.values(value.customDesign.regions)) template(region,Themes.DESIGN_REGION_DEFAULT);
  }
  for (const key of ["id","name"]) if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 80) invalid();
  let safe;
  try { safe = sanitizeTheme(value); } catch { invalid(); }
  const normalized = Themes.normalizeTheme(value);
  return { id:normalized.id,name:normalized.name,source:normalized.source,accentMode:normalized.accentMode,accentExplicit:normalized.accentExplicit,harmonyVersion:2,migratedVisualSlotsSafe:true,tokens:safe.tokens,assets:safe.assets,visualSlots:safe.visualSlots,customDesign:safe.customDesign,layout:safe.layout };
}
function background(value) {
  keys(value,["imageData","color","position","size","overlay","blur","imageOpacity"]);
  const result = {imageData:reference(value.imageData)};
  if (value.color !== undefined) { if (value.color !== null && !/^(?:#[\da-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/iu.test(value.color)) invalid(); result.color=value.color; }
  if (value.position !== undefined) result.position=choice(value.position,["center","top","bottom","left","right","top left","top right","bottom left","bottom right"]);
  if (value.size !== undefined) result.size=choice(value.size,["cover","contain","auto"]);
  for (const key of ["overlay","blur","imageOpacity"]) if (value[key] !== undefined) result[key]=number(value[key],0,key==="blur"?40:1);
  return result;
}
function validateSection(section, value) {
  if (!SECTIONS.includes(section)) invalid();
  const result = {};
  if (section === "identity") {
    keys(value,["userAvatar","chenAvatar"]);
    for (const [key,child] of Object.entries(value)) result[key]=avatar(child);
  } else if (section === "appearance") {
    keys(value,["chatBackground","activeTheme","ui"]);
    if (value.chatBackground !== undefined) result.chatBackground=background(value.chatBackground);
    if (value.activeTheme !== undefined) result.activeTheme=theme(value.activeTheme);
    if (value.ui !== undefined) {
      keys(value.ui,["mode","style","font"]);result.ui={};
      for (const [key,child] of Object.entries(value.ui)) result.ui[key]=choice(child,{mode:["night","day","system"],style:["purple","mono","mist"],font:["default","serif","rounded"]}[key]);
    }
  } else {
    keys(value,["autoRead","rate","pitch","volume","recognitionLanguage","showInterimTranscript","voiceSession"]);
    for (const [key,child] of Object.entries(value)) {
      if (["autoRead","showInterimTranscript"].includes(key)) result[key]=choice(child,[true,false]);
      if (key === "recognitionLanguage") result[key]=choice(child,Voice.LANGUAGES);
      if (["rate","pitch","volume"].includes(key)) {const bounds={rate:[.6,1.6],pitch:[.7,1.3],volume:[0,1]}[key];result[key]=number(child,...bounds);}
      if (key === "voiceSession") {
        keys(child,["continuousConversation","autoSpeak","backgroundMode","backgroundAssetId"]);result[key]={};
        for (const [field,item] of Object.entries(child)) {
          if (["continuousConversation","autoSpeak"].includes(field)) result[key][field]=choice(item,[true,false]);
          if (field==="backgroundMode") result[key][field]=choice(item,["custom","follow-chat"]);
          if (field==="backgroundAssetId") {reference(item?`/api/theme/assets/${item}`:null);result[key][field]=item;}
        }
      }
    }
  }
  return result;
}
function assetReferences(value) {
  const result=new Set();
  function walk(item) { if(typeof item==="string"&&ASSET.test(item))result.add(item.split("/").at(-1));else if(object(item)||Array.isArray(item))for(const [key,child] of Object.entries(item)){if(key==="backgroundAssetId"&&child)result.add(child);else walk(child);} }
  walk(value); return [...result];
}
class PersonalizationStore {
  constructor({rootDir=path.join("runtime-data","personalization"),eventStore,assetStore,clock=()=>new Date()}={}) {this.rootDir=path.resolve(rootDir);this.filename=path.join(this.rootDir,"state.json");this.eventStore=eventStore;this.assetStore=assetStore;this.clock=clock;}
  read() { try { const value=JSON.parse(fs.readFileSync(this.filename,"utf8"));if(value.version!==1||!Number.isSafeInteger(value.revision)||!object(value.sections))throw Error();return value;}catch(error){if(error.code==="ENOENT")return null;throw new PersonalizationError("PERSONALIZATION_STORAGE_UNAVAILABLE",503);} }
  get() {const state=this.read();return {initialized:Boolean(state),state};}
  mutate(action) {
    fs.mkdirSync(this.rootDir,{recursive:true,mode:0o700});fs.chmodSync(this.rootDir,0o700);
    const lock=path.join(this.rootDir,".write-lock");
    try {fs.mkdirSync(lock,{mode:0o700});}catch{throw new PersonalizationError("PERSONALIZATION_BUSY",503);}
    try {return action();} finally {fs.rmdirSync(lock);}
  }
  commit(state, section, eventType) {
    const temporary=path.join(this.rootDir,`.state-${crypto.randomUUID()}.tmp`);
    let fd;
    try {
      fd=fs.openSync(temporary,"wx",0o600);fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      // Configuration bodies never enter EventStore. It records only the explicit write fact.
      this.eventStore.create({eventType,subjectType:"personalization",subjectId:"default",payload:{section,revision:state.revision,sectionRevision:section==="all"?1:state.sections[section].revision}}, {source:"personalization-store"});
      fs.renameSync(temporary,this.filename);
      const directory=fs.openSync(this.rootDir,"r");try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
      return this.get();
    } finally {if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  checkAssets(value) {for(const id of assetReferences(value))try{this.assetStore.resolve(id);}catch{throw new PersonalizationError("PERSONALIZATION_ASSET_MISSING",400);}}
  bootstrap(input) {keys(input,["sections"]);keys(input.sections,SECTIONS);if(SECTIONS.some(key=>!Object.hasOwn(input.sections,key)))invalid();return this.mutate(()=>{
    if(this.read())throw new PersonalizationError("ALREADY_INITIALIZED",409);
    const timestamp=this.clock().toISOString(),state={version:1,revision:1,updatedAt:timestamp,sections:{}};
    for(const section of SECTIONS){const data=validateSection(section,input.sections[section]);const required={identity:["userAvatar","chenAvatar"],appearance:["chatBackground","activeTheme","ui"],voicePortable:["autoRead","rate","pitch","volume","recognitionLanguage","showInterimTranscript","voiceSession"]}[section];if(required.some(key=>!Object.hasOwn(data,key)))invalid();this.checkAssets(data);state.sections[section]={revision:1,updatedAt:timestamp,data};}
    return this.commit(state,"all","personalization.initialized");
  });}
  patch(input) {keys(input,["section","baseRevision","patch"]);if(!SECTIONS.includes(input.section)||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<1)invalid();const patch=validateSection(input.section,input.patch);if(!Object.keys(patch).length)invalid();return this.mutate(()=>{
    const state=this.read();if(!state)throw new PersonalizationError("NOT_INITIALIZED",409);
    const current=state.sections[input.section];if(current.revision!==input.baseRevision)throw new PersonalizationError("SECTION_CONFLICT",409);
    const data={...current.data,...patch};
    if(input.section==="voicePortable"&&patch.voiceSession)data.voiceSession={...current.data.voiceSession,...patch.voiceSession};
    if(input.section==="appearance"&&patch.ui)data.ui={...current.data.ui,...patch.ui};
    this.checkAssets(data);const timestamp=this.clock().toISOString();state.revision++;state.updatedAt=timestamp;state.sections[input.section]={revision:current.revision+1,updatedAt:timestamp,data};
    return this.commit(state,input.section,"personalization.updated");
  });}
  findAssetReferences(id) {return assetReferences(this.read()?.sections||{}).includes(id)?[{section:"personalization"}]:[];}
}
module.exports={PersonalizationStore,PersonalizationError,validateSection,SECTIONS,assetReferences};
