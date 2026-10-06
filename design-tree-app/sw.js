// =====================================================================
// サービスワーカー: アプリをオフラインでも開けるようにする
//   - アプリのファイル (index.html など) は、ネットにつながっていれば新しいものを、
//     つながっていなければ保存しておいたものを使う
//   - フォントと Firebase の SDK は、一度読み込んだら保存しておく
// =====================================================================
const VERSION = "20261006152533";
const CACHE = "design-tree-" + VERSION;
const APP_FILES = [
  "./", "./index.html", "./manifest.webmanifest", "./firebase-config.js", "./firebase-sync.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("design-tree-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firebase のログイン・データの通信は、そのまま通す (保存しない)
  if (/googleapis\.com$|firebaseio\.com$|firebaseapp\.com$/.test(url.hostname) && !url.hostname.startsWith("fonts.")) return;

  // フォントと Firebase SDK: 一度読んだら保存しておいたものを使う
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" || url.pathname.startsWith("/firebasejs/")) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  // アプリのファイル: まずネット、だめなら保存しておいたもの
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
        return res;
      }).catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
    );
  }
});
