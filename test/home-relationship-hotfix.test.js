"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { JSDOM } = require("jsdom");
const Home = require("../frontend-p4b/assets/js/home-relationship.js");
const Voice = require("../frontend-p4b/assets/js/voice-session.js");
const html = fs.readFileSync("frontend-p4b/index.html", "utf8");
const userImage = "data:image/png;base64,dXNlcg==";
const chenImage = "data:image/png;base64,Y2hlbg==";

async function fixture(avatar = {}) {
  const dom = new JSDOM(html, { url: "https://example.test/index.html", runScripts: "outside-only" });
  const w = dom.window, images = [];
  await new Promise(resolve => w.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  w.Image = class { constructor() { images.push(this); } };
  w.eval(fs.readFileSync("ai-companion-frontend/storage/user-preference-store.js", "utf8"));
  const store = new w.CompanionUserPreferences.UserPreferenceStore();
  store.save({ avatar });
  const home = Home.mount(w);
  await Promise.resolve();
  const node = kind => w.document.querySelector(`[data-relationship-avatar="${kind}"]`);
  const finish = () => images.forEach(image => image.onload());
  return { w, store, home, images, node, finish, close() { home.destroy(); w.close(); } };
}

test("historical date retains first-day-inclusive Beijing calendar counting", () => {
  assert.equal(Home.RELATIONSHIP_START_DATE, "2026-07-01");
  for (const [instant, days] of [
    ["2026-06-30T16:00:00Z", 1], ["2026-07-01T15:59:59.999Z", 1],
    ["2026-07-01T16:00:00Z", 2], ["2026-09-11T04:00:00Z", 73],
    ["2026-11-01T05:59:59Z", 124], ["2026-11-01T06:00:00Z", 124]
  ]) assert.equal(Home.relationshipDays(new Date(instant)), days, instant);
  assert.equal(Home.relationshipDays(new Date(NaN)), null);
});

test("refresh and host timezone/DST cannot change the same instant's day number", () => {
  const script = `const h=require('./frontend-p4b/assets/js/home-relationship.js');process.stdout.write(String(h.relationshipDays(new Date('2026-09-10T16:00:00Z'))))`;
  for (const TZ of ["UTC", "Asia/Shanghai", "America/New_York", "Pacific/Honolulu"]) {
    assert.equal(execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ } }).toString(), "73");
  }
});

test("Home, Chat Header and Voice resolve the same current avatar, preserving crop", async () => {
  const f = await fixture({ userAvatar: { imageData: userImage, crop: { x: 23, y: 61 }, scale: 1.4 }, chenAvatar: { imageData: chenImage, crop: { x: 60, y: 30 }, scale: 1.2 } });
  try {
    f.finish();
    f.w.document.body.insertAdjacentHTML("beforeend", '<div class="chat-avatar">沉</div><div class="message-avatar message-avatar--user">我</div><div id="voice-avatar"></div>');
    f.w.eval(fs.readFileSync("frontend-p4b/assets/js/avatar-chat.js", "utf8"));
    f.w.document.dispatchEvent(new f.w.Event("DOMContentLoaded"));
    const header = f.w.document.querySelector(".chat-avatar");
    assert.equal(f.node("chen").style.backgroundImage, header.style.backgroundImage);
    assert.equal(f.node("user").style.backgroundImage, f.w.document.querySelector(".message-avatar--user").style.backgroundImage);
    assert.equal(f.node("chen").style.backgroundPosition, header.style.backgroundPosition);
    assert.equal(f.node("user").style.backgroundSize, "140%");
    const voice = f.w.document.querySelector("#voice-avatar");
    Voice.syncAvatar(f.w, f.w.document, voice);
    assert.equal(voice.querySelector("img").src, f.store.getChenAvatarImage());
    const before = f.w.document.querySelector("[data-relationship-days]").textContent;
    f.home.renderDays();
    assert.equal(f.w.document.querySelector("[data-relationship-days]").textContent, before);
  } finally { f.close(); }
});

for (const missing of ["user", "chen"]) test(`missing ${missing} avatar keeps safe text fallback and the other avatar`, async () => {
  const avatar = { userAvatar: { imageData: userImage }, chenAvatar: { imageData: chenImage } };
  avatar[missing + "Avatar"] = null;
  const f = await fixture(avatar);
  try {
    f.finish();
    assert.equal(f.node(missing).classList.contains("has-avatar-image"), false);
    assert.equal(f.node(missing).style.backgroundImage, "");
    assert.equal(f.node(missing).textContent, missing === "user" ? "你" : "沉");
    assert.equal(f.node(missing === "user" ? "chen" : "user").classList.contains("has-avatar-image"), true);
  } finally { f.close(); }
});

test("failed image and stale load cannot replace current preferences", async () => {
  const f = await fixture({ chenAvatar: { imageData: chenImage } });
  try {
    const old = f.images.at(-1);
    f.store.saveAvatar({ imageData: "/missing-avatar.png" }, "chen");
    const failed = f.images.at(-1);
    old.onload(); failed.onerror();
    assert.equal(f.node("chen").style.backgroundImage, "");
    f.store.saveAvatar({ imageData: chenImage }, "chen");
    f.images.at(-1).onload();
    assert.equal(f.node("chen").classList.contains("has-avatar-image"), true);
    failed.onload();
    assert.ok(f.node("chen").style.backgroundImage.includes(chenImage));
  } finally { f.close(); }
});

test("restored Hero retains original copy and current surrounding sections/routes", () => {
  const dom = new JSDOM(html), d = dom.window.document;
  assert.equal(d.querySelectorAll("[data-relationship-avatar]").length, 2);
  for (const text of ["你", "沉沉", "♥", "DAYS TOGETHER", "从相遇那天起，日子有了共同的名字。"]) assert.ok(d.querySelector(".relationship-hero").textContent.includes(text));
  for (const selector of [".today-section", ".quick-section", ".bottom-nav"]) assert.ok(d.querySelector(selector));
  assert.deepEqual([...d.querySelectorAll(".bottom-nav a")].map(a => a.getAttribute("href")), ["/index.html", "/game/", "/chat.html", "/collaboration/", "/space/"]);
  const sw = fs.readFileSync("frontend-p4b/sw.js", "utf8");
  for (const file of ["home-relationship.css", "home-relationship.js"]) {
    assert.ok(html.includes(file + "?v=home-hotfix-1"));
    assert.ok(sw.includes(file + "?v=home-hotfix-1"));
  }
  assert.match(fs.readFileSync("ai-companion-frontend/game/index.html", "utf8"), /game-v49-p4b/);
  dom.window.close();
});
