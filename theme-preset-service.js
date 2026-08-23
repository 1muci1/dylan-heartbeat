"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeTheme } = require("./frontend-p4b/assets/js/theme-store");

const LOCAL_ASSET = /^\/api\/theme\/assets\/([0-9a-f-]{36})$/iu;
const MAX_PRESETS = 100;
const DANGEROUS_FIELDS = new Set(["selector","css","style","script","javascript","html","iframe","href","src"]);
const DANGEROUS_PROTOCOL = /(?:https?:\/\/|data:|blob:|file:|javascript:)/iu;

class ThemePresetError extends Error {
  constructor(message, statusCode = 400, code = "THEME_PRESET_INVALID", field = "") { super(message); this.name = "ThemePresetError"; this.statusCode = statusCode; this.code = code; this.error = code; this.field = field; }
}

function invalidField(field) { throw new ThemePresetError("主题预设包含不允许的字段",400,"THEME_PRESET_INVALID_FIELD",field); }
function validateThemeInput(value, field = "theme", seen = new Set()) {
  if (typeof value === "string") { if (DANGEROUS_PROTOCOL.test(value)) invalidField(field); return; }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) invalidField(field); seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const childField = field === "theme" ? key : `${field}.${key}`;
    if (DANGEROUS_FIELDS.has(key.toLowerCase())) invalidField(childField);
    validateThemeInput(child, childField, seen);
  }
  seen.delete(value);
}

function safeText(value, field, { required = false, max = 240 } = {}) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new ThemePresetError(`${field} 必须是文本`);
  const text = value.trim();
  if ((required && !text) || text.length > max || /[<>\u0000-\u001f\u007f]/u.test(text)) throw new ThemePresetError(`${field} 无效`);
  return text;
}

function safeTags(value = []) {
  if (!Array.isArray(value) || value.length > 20) throw new ThemePresetError("标签无效");
  const tags = [...new Set(value.map(tag => safeText(tag, "标签", { required:true, max:24 })))];
  if (tags.join("").length > 240) throw new ThemePresetError("标签无效");
  return tags;
}

function safeAsset(value, field = "素材引用") {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !LOCAL_ASSET.test(value)) throw new ThemePresetError(`${field} 只允许本地素材引用`, 400, "THEME_PRESET_ASSET_FORBIDDEN");
  return value;
}

function assetReferences(theme, coverAssetId = "") {
  const values = [];
  for (const value of Object.values(theme.assets || {})) if (value) values.push(value);
  for (const slot of Object.values(theme.visualSlots || {})) if (slot && typeof slot === "object" && slot.url) values.push(slot.url);
  for (const region of Object.values(theme.customDesign?.regions || {})) if (region?.image?.url) values.push(region.image.url);
  for (const item of theme.assetLibrary || []) if (item?.url) values.push(item.url);
  if (coverAssetId) values.push(`/api/theme/assets/${coverAssetId}`);
  return [...new Set(values)].map(url => ({ assetId:LOCAL_ASSET.exec(url)[1], url }));
}

function sanitizeTheme(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ThemePresetError("主题必须是对象");
  validateThemeInput(input);
  for (const [field, value] of Object.entries(input.assets || {})) safeAsset(value, field);
  for (const [field, slot] of Object.entries(input.visualSlots || {})) if (slot && typeof slot === "object") safeAsset(slot.url, field);
  for (const [field, region] of Object.entries(input.customDesign?.regions || {})) if (region?.image) safeAsset(region.image.url, field);
  for (const item of Array.isArray(input.assetLibrary) ? input.assetLibrary : []) safeAsset(item?.url, "assetLibrary");
  if (Object.hasOwn(input, "customCss") && String(input.customCss || "").trim()) invalidField("customCss");
  const normalized = normalizeTheme({ ...input, customCss:"" });
  return {
    tokens:JSON.parse(JSON.stringify(normalized.tokens)),
    assets:JSON.parse(JSON.stringify(normalized.assets)),
    assetLibrary:JSON.parse(JSON.stringify(normalized.assetLibrary)),
    visualSlots:JSON.parse(JSON.stringify(normalized.visualSlots)),
    customDesign:JSON.parse(JSON.stringify(normalized.customDesign)),
    layout:JSON.parse(JSON.stringify(normalized.layout))
  };
}

class ThemePresetStore {
  constructor({ rootDir = path.join("runtime-data", "theme-presets"), assetStore = null, eventStore = null, clock = () => new Date() } = {}) {
    this.rootDir = path.resolve(rootDir); this.filename = path.join(this.rootDir, "presets.json"); this.assetStore = assetStore; this.eventStore = eventStore; this.clock = clock;
  }
  ensureDirectory() { fs.mkdirSync(this.rootDir, { recursive:true, mode:0o700 }); fs.chmodSync(this.rootDir, 0o700); }
  read() { this.ensureDirectory(); try { const value=JSON.parse(fs.readFileSync(this.filename,"utf8")); return Array.isArray(value)?value:[]; } catch { return []; } }
  write(items) { this.ensureDirectory(); const temporary=path.join(this.rootDir,`.presets.${crypto.randomUUID()}.tmp`);fs.writeFileSync(temporary,JSON.stringify(items,null,2),{flag:"wx",mode:0o600});fs.renameSync(temporary,this.filename);fs.chmodSync(this.filename,0o600); }
  record(eventType, presetId) { if (!this.eventStore) return; this.eventStore.create({ eventType, subjectType:"theme_preset", subjectId:presetId, payload:{presetId,timestamp:this.clock().toISOString()} }, {source:"theme-preset-store"}); }
  assets() { return new Set((this.assetStore?.list({view:"active"}) || []).map(item=>item.id)); }
  public(item) { const existing=this.assets(),references=assetReferences(item.theme,item.coverAssetId),missingAssets=references.filter(ref=>!existing.has(ref.assetId));return {...JSON.parse(JSON.stringify(item)),assetReferences:references,assetCount:references.length,missingAssets}; }
  list() { return this.read().map(item=>this.public(item)); }
  get(id) { const item=this.read().find(candidate=>candidate.id===id);if(!item)throw new ThemePresetError("主题预设不存在",404,"THEME_PRESET_NOT_FOUND");return item; }
  input(value, current = null) {
    if (!value || typeof value!=="object" || Array.isArray(value)) throw new ThemePresetError("主题预设无效");
    const allowed=new Set(["name","description","tags","coverAssetId","mood","style","colorProfile","theme"]),unknown=Object.keys(value).find(key=>!allowed.has(key));if(unknown)throw new ThemePresetError(`不允许字段：${unknown}`);
    const coverAssetId=value.coverAssetId==null?(current?.coverAssetId||""):safeText(value.coverAssetId,"封面素材",{max:36});if(coverAssetId&&!/^[0-9a-f-]{36}$/iu.test(coverAssetId))throw new ThemePresetError("封面素材无效");
    return {
      name:Object.hasOwn(value,"name")?safeText(value.name,"名称",{required:true,max:80}):current?.name,
      description:Object.hasOwn(value,"description")?safeText(value.description,"描述",{max:300}):(current?.description||""),
      tags:Object.hasOwn(value,"tags")?safeTags(value.tags):(current?.tags||[]), coverAssetId,
      mood:Object.hasOwn(value,"mood")?safeText(value.mood,"mood",{max:80}):(current?.mood||""),
      style:Object.hasOwn(value,"style")?safeText(value.style,"style",{max:80}):(current?.style||""),
      colorProfile:Object.hasOwn(value,"colorProfile")?safeText(value.colorProfile,"colorProfile",{max:80}):(current?.colorProfile||""),
      theme:Object.hasOwn(value,"theme")?sanitizeTheme(value.theme):current?.theme
    };
  }
  create(value) { const items=this.read();if(items.length>=MAX_PRESETS)throw new ThemePresetError("主题预设数量已达上限",409,"THEME_PRESET_LIMIT");const now=this.clock().toISOString(),data=this.input(value);if(!data.theme)throw new ThemePresetError("主题不能为空");const item={id:crypto.randomUUID(),...data,createdAt:now,updatedAt:now,lastUsedAt:null};items.push(item);this.write(items);this.record("theme_preset.created",item.id);return this.public(item); }
  update(id,value) { const items=this.read(),index=items.findIndex(item=>item.id===id);if(index<0)throw new ThemePresetError("主题预设不存在",404,"THEME_PRESET_NOT_FOUND");const data=this.input(value,items[index]);items[index]={...items[index],...data,updatedAt:this.clock().toISOString()};this.write(items);this.record("theme_preset.updated",id);return this.public(items[index]); }
  delete(id) { const items=this.read(),index=items.findIndex(item=>item.id===id);if(index<0)throw new ThemePresetError("主题预设不存在",404,"THEME_PRESET_NOT_FOUND");items.splice(index,1);this.write(items);this.record("theme_preset.deleted",id);return {id,deleted:true}; }
  copy(id) { const source=this.get(id);return this.create({name:`${source.name} 副本`,description:source.description,tags:source.tags,coverAssetId:source.coverAssetId,mood:source.mood,style:source.style,colorProfile:source.colorProfile,theme:source.theme}); }
  previewApply(id) { const item=this.get(id),validatedTheme=sanitizeTheme(item.theme),value=this.public({...item,theme:validatedTheme}),missing=new Set(value.missingAssets.map(ref=>ref.url)),theme=JSON.parse(JSON.stringify(validatedTheme));for(const key of Object.keys(theme.assets||{}))if(missing.has(theme.assets[key]))theme.assets[key]="";for(const slot of Object.values(theme.visualSlots||{}))if(slot&&typeof slot==="object"&&missing.has(slot.url))slot.url="";for(const region of Object.values(theme.customDesign?.regions||{}))if(region?.image&&missing.has(region.image.url)){region.image.url="";region.image.enabled=false;}theme.assetLibrary=(theme.assetLibrary||[]).filter(asset=>!missing.has(asset.url));return {presetId:id,draft:{...theme,id:`preset_draft_${id}`,name:item.name,source:"custom",customCss:""},changes:this.changes(validatedTheme),missingAssets:value.missingAssets}; }
  apply(id) { const result=this.previewApply(id),items=this.read(),index=items.findIndex(item=>item.id===id),now=this.clock().toISOString();items[index]={...items[index],lastUsedAt:now,updatedAt:items[index].updatedAt};this.write(items);this.record("theme_preset.applied",id);return result; }
  changes(theme) { const refs=assetReferences(theme);return {background:Boolean(theme.visualSlots?.pageBackground?.url||theme.assets?.backgroundImage),bubbles:Boolean(theme.visualSlots?.userBubbleDecor?.url||theme.visualSlots?.assistantBubbleDecor?.url)||Boolean(theme.customDesign?.regions?.["chat.userBubble"]||theme.customDesign?.regions?.["chat.assistantBubble"]),cards:Object.keys(theme.customDesign?.regions||{}).some(key=>/card|hero/iu.test(key)),assetCount:refs.length}; }
  export(id) { const item=this.get(id);return {type:"xinban-theme-preset",presetVersion:1,preset:{name:item.name,description:item.description,tags:item.tags,coverAssetId:item.coverAssetId,mood:item.mood,style:item.style,colorProfile:item.colorProfile,createdAt:item.createdAt,updatedAt:item.updatedAt,theme:item.theme,assetReferences:assetReferences(item.theme,item.coverAssetId)}}; }
  import(pack) { if(!pack||pack.type!=="xinban-theme-preset"||Number(pack.presetVersion)!==1||!pack.preset)throw new ThemePresetError("不是受支持的主题预设",400,"THEME_PRESET_PACKAGE_INVALID");const allowed=new Set(["name","description","tags","coverAssetId","mood","style","colorProfile","createdAt","updatedAt","theme","assetReferences"]),unknown=Object.keys(pack.preset).find(key=>!allowed.has(key));if(unknown)throw new ThemePresetError(`不允许字段：${unknown}`);const {name,description,tags,coverAssetId,mood,style,colorProfile,theme}=pack.preset;return this.create({name,description,tags,coverAssetId,mood,style,colorProfile,theme}); }
  findAssetReferences(assetId) { const url=`/api/theme/assets/${assetId}`;return this.read().filter(item=>assetReferences(item.theme,item.coverAssetId).some(ref=>ref.url===url)).map(item=>({presetId:item.id,name:item.name})); }
}

module.exports = { ThemePresetError, ThemePresetStore, assetReferences, sanitizeTheme, validateThemeInput };
