"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { ThemeAssetLocalizer, ThemeAssetStore, isPrivateIp } = require("../theme-asset-service");

const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
const response = (body = png, headers = { "content-type": "image/png" }) => ({ ok:true,status:200,headers:{get:key=>headers[key.toLowerCase()] || null},arrayBuffer:async()=>body });

test("theme asset localizer rejects private destinations without fetching", async () => {
  let fetched = false;
  const localizer = new ThemeAssetLocalizer({ fetchFn:async()=>{fetched=true;return response();},lookup:async()=>[{address:"127.0.0.1"}] });
  const result = await localizer.localize([{id:"a",kind:"backgroundImage",sourceUrl:"https://example.test/a.png"}]);
  assert.equal(fetched,false); assert.equal(result.failed[0].reason,"THEME_ASSET_SSRF_BLOCKED");
  assert.equal(isPrivateIp("::ffff:127.0.0.1"),true);
});

test("theme asset localizer validates MIME and magic and stores safe local URLs", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"theme-assets-")); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new ThemeAssetStore({rootDir:dir});
  const good=new ThemeAssetLocalizer({store,lookup:async()=>[{address:"203.0.113.8"}],fetchFn:async()=>response()});
  const saved=await good.localize([{id:"hero",kind:"backgroundImage",sourceUrl:"https://images.example/a.png"}]);
  assert.match(saved.localized[0].localUrl,/^\/api\/theme\/assets\/[0-9a-f-]{36}$/u);
  const file=store.resolve(saved.localized[0].id); assert.equal(fs.statSync(file.filename).mode & 0o777,0o600);
  const badType=new ThemeAssetLocalizer({lookup:async()=>[{address:"203.0.113.8"}],fetchFn:async()=>response(Buffer.from("html"),{"content-type":"text/html"})});
  assert.equal((await badType.localize([{id:"bad",sourceUrl:"https://images.example/a"}])).failed[0].reason,"THEME_ASSET_CONTENT_TYPE_INVALID");
  const badMagic=new ThemeAssetLocalizer({lookup:async()=>[{address:"203.0.113.8"}],fetchFn:async()=>response(Buffer.from("not png"))});
  assert.equal((await badMagic.localize([{id:"bad",sourceUrl:"https://images.example/a"}])).failed[0].reason,"THEME_ASSET_MAGIC_INVALID");
});

test("theme asset localizer rejects oversized declared images", async () => {
  const fetchFn=async()=>response(png,{"content-type":"image/png","content-length":String(2*1024*1024+1)});
  const localizer=new ThemeAssetLocalizer({lookup:async()=>[{address:"203.0.113.8"}],fetchFn});
  assert.equal((await localizer.localize([{id:"large",sourceUrl:"https://images.example/a.png"}])).failed[0].reason,"THEME_ASSET_TOO_LARGE");
});

test("v54 exposes authenticated extraction/localization routes and stages import without auto-apply", () => {
  const routes=fs.readFileSync(path.join(__dirname,"..","theme-asset-routes.js"),"utf8");
  const workshop=fs.readFileSync(path.join(__dirname,"..","frontend-p4b/assets/js/theme-workshop.js"),"utf8");
  assert.match(routes,/\/api\/theme\/assets\/localize/u); assert.match(routes,/preHandler:\s*auth/u);
  assert.match(routes,/\/api\/theme\/import\/extract/u); assert.match(routes,/\.docx.*\.txt.*\.css/u);
  assert.match(workshop,/data-theme-assets-localize/u); assert.match(workshop,/pendingImport/u);
  assert.ok(workshop.indexOf("localizeSelectedAssets") < workshop.indexOf("store.importTheme"));
});
