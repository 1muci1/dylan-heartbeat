const CACHE_NAME = "xinban-shell-v78-p4b";
const BUILD_REVISION = "v78";
const CACHE_PREFIX = "xinban-shell-";
const APP_SHELL = [
  "./",
  "./index.html",
  "./chat.html",
  "./dashboard.html",
  "./settings.html",
  "./theme-workshop.html",
  "./theme-center.html",
  "./theme-community.html",
  "./memory.html",
  "./stickers.html",
  "./ai-memory-review.html",
  "./proactive-explanation.html",
  "./manifest.json",
  "./assets/css/common.css?v=v78-p4b",
  "./assets/css/theme.css?v=v78-p4b",
  "./assets/css/theme-workshop.css?v=v78-p4b",
  "./assets/css/theme-center.css?v=v78-p4b",
  "./assets/css/theme-community.css?v=v78-p4b",
  "./assets/css/theme-editor.css?v=v78-p4b",
  "./assets/css/theme-studio-v76.css?v=v78-p4b",
  "./assets/css/home.css",
  "./assets/css/home-relationship.css?v=home-hotfix-1",
  "./assets/css/chat.css?v=v78-p4b-entry1",
  "./assets/css/voice-v77.css?v=v78-p4b",
  "./assets/css/dashboard.css",
  "./assets/css/settings.css",
  "/shared/provider-config-panel.css",
  "./assets/css/memory.css",
  "./assets/css/stickers.css?v=v78-p4b",
  "./assets/css/ai-memory-review.css",
  "./assets/css/proactive-explanation.css",
  "./assets/js/data.js",
  "./assets/js/appearance.js",
  "./assets/js/model-registry.js",
  "./assets/js/model-switcher.js",
  "./assets/js/message.js?v=v78-p4b",
  "./assets/js/provider.js",
  "./assets/js/api.js?v=v78-p4b-fix2",
  "./assets/js/common.js?v=v78-p4b",
  "./assets/js/theme-store.js?v=v78-p4b",
  "./assets/js/tavern-theme-adapter.js?v=v78-p4b",
  "./assets/js/theme-gateway.js?v=v78-p4b-bg1",
  "./assets/js/theme-workshop.js?v=v78-p4b-bg1",
  "./assets/js/theme-studio-v76.js?v=v78-p4b",
  "./assets/js/theme-center.js?v=v78-p4b",
  "./assets/js/theme-community.js?v=v78-p4b",
  "./assets/js/sessions.js",
  "./assets/js/stickers.js?v=v78-p4b",
  "./assets/js/voice-adapter.js?v=v78-p4b-bg1",
  "./assets/js/voice-ui.js?v=v78-p4b",
  "./assets/js/voice-background.js?v=v78-p4b-bg1",
  "./assets/js/voice-session.js?v=v78-p4b-ui1",
  "./assets/css/voice-session-v78.css?v=v78-p4b-ui1",
  "./assets/js/sticker-manager.js?v=v78-p4b",
  "./assets/js/home.js",
  "./assets/js/home-relationship.js?v=home-hotfix-1",
  "./assets/js/chat-preferences.js",
  "./assets/js/avatar-chat.js",
  "/avatar/avatar-picker.js",
  "/storage/user-preference-store.js",
  "./assets/js/settings-return.js",
  "./assets/js/settings-section.js",
  "/shared/provider-config-panel.js",
  "./assets/js/chat.js?v=v78-p4b-fix2",
  "./assets/js/dashboard.js",
  "./assets/js/settings.js?v=v78-p4b",
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
