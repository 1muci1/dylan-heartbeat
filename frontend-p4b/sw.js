const CACHE_NAME = "xinban-shell-v46-p4b";
const CACHE_PREFIX = "xinban-shell-";
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
  "./assets/css/chat.css?v=v46-p4b",
  "./assets/css/dashboard.css",
  "./assets/css/settings.css",
  "/shared/provider-config-panel.css",
  "./assets/css/memory.css",
  "./assets/css/stickers.css?v=v46-p4b",
  "./assets/css/ai-memory-review.css",
  "./assets/css/proactive-explanation.css",
  "./assets/js/data.js",
  "./assets/js/appearance.js",
  "./assets/js/model-registry.js",
  "./assets/js/model-switcher.js",
  "./assets/js/message.js?v=v46-p4b",
  "./assets/js/provider.js",
  "./assets/js/api.js?v=v46-p4b",
  "./assets/js/common.js?v=v46-p4b",
  "./assets/js/sessions.js",
  "./assets/js/stickers.js?v=v46-p4b",
  "./assets/js/sticker-manager.js?v=v46-p4b",
  "./assets/js/home.js",
  "./assets/js/chat-preferences.js",
  "./assets/js/avatar-chat.js",
  "/avatar/avatar-picker.js",
  "/storage/user-preference-store.js",
  "./assets/js/settings-return.js",
  "./assets/js/settings-section.js",
  "/shared/provider-config-panel.js",
  "./assets/js/chat.js?v=v46-p4b",
  "./assets/js/dashboard.js",
  "./assets/js/settings.js?v=v46-p4b",
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
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (event.request.headers.has("Authorization")
    || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/v1/")) return;
  const acceptsHtml = (event.request.headers.get("Accept") || "").includes("text/html");
  if (event.request.mode === "navigate" || acceptsHtml) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
