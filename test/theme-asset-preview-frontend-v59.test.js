"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {test}=require("node:test");
const root=path.join(__dirname,"..","frontend-p4b");const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("v59 renders grouped visual asset cards with safe preview controls",()=>{const js=read("assets/js/theme-workshop.js"),html=read("theme-workshop.html");assert.match(js,/theme-asset-card/u);assert.match(js,/kindDetails/u);assert.match(js,/renderAssetCards/u);assert.match(html,/生成选中素材预览/u);assert.match(html,/生成全部可用素材预览/u);assert.match(html,/data-asset-filter/u);assert.match(html,/data-asset-sort/u);});

test("v59 never assigns an external source URL to image src",()=>{const js=read("assets/js/theme-workshop.js");assert.match(js,/safeAssetImage/u);assert.match(js,/^|\^\\\/api\\\/theme\\\/assets/u);assert.doesNotMatch(js,/\.src\s*=\s*asset\.sourceUrl/u);assert.doesNotMatch(js,/setAttribute\(["']src["']\s*,\s*asset\.sourceUrl/u);});

test("v59 preview requests use the gateway and local preview URLs",()=>{const js=read("assets/js/theme-workshop.js");assert.match(js,/gatewayRequest\("\/api\/theme\/assets\/preview"/u);assert.match(js,/previewUrl/u);assert.match(js,/\/api\\\/theme\\\/assets\\\/(?:preview\\\/)?/u);});

test("v59 enlarged preview exposes metadata and controlled slot actions",()=>{const html=read("theme-workshop.html"),js=read("assets/js/theme-workshop.js");assert.match(html,/data-asset-preview-dialog/u);assert.match(html,/data-asset-preview-image/u);assert.match(html,/用途建议/u);assert.match(html,/设为用户气泡装饰/u);assert.match(html,/设为沉气泡装饰/u);assert.match(js,/showModal\(\)/u);assert.match(js,/请先本地化后再放入槽位/u);});

test("v59 localization updates cards and leaves mapped visual slots disabled",()=>{const js=read("assets/js/theme-workshop.js");assert.match(js,/sourceAsset\.localUrl=localized\.localUrl/u);assert.match(js,/sourceAsset\.status="localized"/u);assert.match(js,/next\.visualSlots\[slot\]\.enabled=false/u);assert.match(js,/renderAssetCards\(\)/u);assert.match(js,/已放入视觉槽位（默认关闭）/u);});

test("v59 UI explains preview privacy and temporary caching",()=>{const html=read("theme-workshop.html");assert.match(html,/不会直接加载外链/u);assert.match(html,/预览只是临时缓存/u);assert.match(html,/图片装饰默认关闭/u);for(const label of ["全部","可自动映射","背景","气泡","头像","输入栏","底栏","其他","预览失败"])assert.ok(html.includes(label),label);});
