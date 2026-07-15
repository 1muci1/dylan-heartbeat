const CACHE_NAME = "xinban-shell-v20-p4b";
const APP_SHELL = [
  "./",
  "./index.html",
  "./chat.html",
  "./dashboard.html",
  "./settings.html",
  "./memory.html",
  "./stickers.html",
  "./ai-memory-review.html",
  "./manifest.json",
  "./assets/css/common.css",
  "./assets/css/home.css",
  "./assets/css/chat.css",
  "./assets/css/dashboard.css",
  "./assets/css/settings.css",
  "./assets/css/memory.css",
  "./assets/css/stickers.css",
  "./assets/css/ai-memory-review.css",
  "./assets/js/data.js",
  "./assets/js/message.js",
  "./assets/js/provider.js",
  "./assets/js/api.js",
  "./assets/js/common.js",
  "./assets/js/sessions.js",
  "./assets/js/stickers.js",
  "./assets/js/sticker-manager.js",
  "./assets/js/home.js",
  "./assets/js/chat.js",
  "./assets/js/dashboard.js",
  "./assets/js/settings.js",
  "./assets/js/memory.js",
  "./assets/js/ai-memory-review.js",
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
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.headers.has("Authorization") || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
