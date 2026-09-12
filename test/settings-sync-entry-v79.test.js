"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),{JSDOM}=require("jsdom");
test("bottom-nav Settings destination contains independent cross-device sync UI and dependencies",()=>{
  const home=new JSDOM(fs.readFileSync("frontend-p4b/index.html","utf8"));
  assert.ok(home.window.document.querySelector('a[href="/space/"]'));
  const dom=new JSDOM(fs.readFileSync("ai-companion-frontend/space/index.html","utf8")),d=dom.window.document;
  const panel=d.querySelector('[data-personalization-sync]');assert.ok(panel);
  assert.equal(panel.querySelector('h2').textContent,'跨设备同步');
  assert.match(panel.textContent,/将头像、聊天背景、主题及部分个性化设置同步到其他设备。/);
  assert.equal(panel.querySelector('[data-sync-bootstrap]').textContent,'使用此设备作为初始配置');
  for(const key of ['status','time','device','now','conflicts','conflict-list'])assert.ok(panel.querySelector(`[data-sync-${key}]`));
  assert.ok(d.querySelector('link[href*="personalization-sync.css?v=v79-p4b"]'));
  assert.ok(d.querySelector('script[src*="personalization-boot.js?v=v79-p4b"]'));
  assert.equal(panel.parentElement,d.querySelector('main'));
  for(const selector of ['[data-theme-modes]','[data-avatar-upload]','[data-background-url]','[data-font-url]','[data-reset-space]'])assert.ok(d.querySelector(selector));
  dom.window.close();home.window.close();
});
