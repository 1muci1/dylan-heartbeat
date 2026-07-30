const CACHE_NAME = "xinban-shell-v38-p4b";
const STALE_CACHE_NAMES = new Set([
  "xinban-shell-v21-p4b",
  "xinban-shell-v22-p4b",
  "xinban-shell-v23-p4b",
  "xinban-shell-v24-p4b",
  "xinban-shell-v25-p4b",
  "xinban-shell-v26-p4b",
  "xinban-shell-v27-p4b",
  "xinban-shell-v28-p4b",
  "xinban-shell-v29-p4b",
  "xinban-shell-v30-p4b",
  "xinban-shell-v31-p4b",
  "xinban-shell-v32-p4b",
  "xinban-shell-v33-p4b",
  "xinban-shell-v34-p4b",
  "xinban-shell-v35-p4b",
  "xinban-shell-v36-p4b"
  ,"xinban-shell-v37-p4b"
]);
const APP_SHELL = [
  "./",
  "./index.html",
  "./chat.html",
  "./dashboard.html",
  "./settings.html",
  "./memory.html",
  "./stickers.html",
  "./ai-memory-review.html",
  "./proactive-explanation.html",
  "./manifest.json",
  "./assets/css/common.css",
  "./assets/css/home.css",
  "./assets/css/chat.css",
  "./assets/css/dashboard.css",
  "./assets/css/settings.css",
  "/shared/provider-config-panel.css",
  "./assets/css/memory.css",
  "./assets/css/stickers.css",
  "./assets/css/ai-memory-review.css",
  "./assets/css/proactive-explanation.css",
  "./assets/js/data.js",
  "./assets/js/appearance.js",
  "./assets/js/model-registry.js",
  "./assets/js/model-switcher.js",
  "./assets/js/message.js",
  "./assets/js/provider.js",
  "./assets/js/api.js",
  "./assets/js/common.js",
  "./assets/js/sessions.js",
  "./assets/js/stickers.js",
  "./assets/js/sticker-manager.js",
  "./assets/js/home.js",
  "./assets/js/chat-preferences.js",
  "./assets/js/avatar-chat.js",
  "/avatar/avatar-picker.js",
  "/storage/user-preference-store.js",
  "./assets/js/settings-return.js",
  "./assets/js/settings-section.js",
  "/shared/provider-config-panel.js",
  "./assets/js/chat.js",
  "./assets/js/dashboard.js",
  "./assets/js/settings.js",
  "./assets/js/memory.js",
  "./assets/js/ai-memory-review.js",
  "./assets/js/proactive-explanation.js",
  "./assets/icons/icon.svg",
  "./assets/icons/maskable-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => STALE_CACHE_NAMES.has(key)).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.headers.has("Authorization") || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
