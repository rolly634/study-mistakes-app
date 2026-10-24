// オフライン用：アプリ本体を端末に保存する（問題データは IndexedDB 側で保存）
const VERSION = "v0.10.0";
const CACHE = `app-${VERSION}`;
const KATEX_FONTS = [
  "AMS-Regular", "Caligraphic-Bold", "Caligraphic-Regular", "Fraktur-Bold", "Fraktur-Regular", "Main-Bold",
  "Main-BoldItalic", "Main-Italic", "Main-Regular", "Math-BoldItalic", "Math-Italic", "SansSerif-Bold",
  "SansSerif-Italic", "SansSerif-Regular", "Script-Regular", "Size1-Regular", "Size2-Regular", "Size3-Regular",
  "Size4-Regular", "Typewriter-Regular",
].map((f) => `vendor/katex/fonts/KaTeX_${f}.woff2`);
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/data.js", "js/github.js", "js/render.js", "js/srs.js", "js/store.js", "js/supa.js", "js/tracker.js",
  "vendor/katex/katex.min.js", "vendor/katex/katex.min.css", "vendor/marked.umd.js", "vendor/purify.min.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
  ...KATEX_FONTS,
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // GitHub API は素通し
  if (url.pathname.includes("/demo/")) return; // 見本データは毎回取得
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    })),
  );
});
