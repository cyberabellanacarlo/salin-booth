/* Versioned cache. Guest photos live in IndexedDB and are never stored or cleared here. */
var CACHE = "salin-booth-v8";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/storage.js",
  "./js/frame.js",
  "./js/zip.js",
  "./js/backup.js",
  "./js/compliments.js",
  "./js/app.js",
  "./assets/logo.png",
  "./assets/flower_tr.png",
  "./assets/flower_bl.png",
  "./assets/fonts/Kalam-Bold.ttf",
  "./assets/fonts/CormorantGaramond.ttf",
  "./assets/fonts/CormorantGaramond-Italic.ttf",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/mediapipe/vision_bundle.js",
  "./assets/mediapipe/vision_bundle.mjs",
  "./assets/mediapipe/blaze_face_short_range.tflite",
  "./assets/mediapipe/face_landmarker.task",
  "./assets/mediapipe/wasm/vision_wasm_internal.js",
  "./assets/mediapipe/wasm/vision_wasm_internal.wasm"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isShell(url) {
  return /\/(index\.html)?$/.test(url.pathname) ||
    url.pathname.indexOf("/js/") !== -1 ||
    url.pathname.indexOf("/styles.css") !== -1;
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* App files: try the network first so a new version loads, fall back to cache. */
  if (isShell(url)) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("./index.html");
          throw new Error("offline");
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === "navigate") return caches.match("./index.html");
        throw new Error("offline");
      });
    })
  );
});
