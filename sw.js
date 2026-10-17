/* Popsikosland GPS — service worker: офлайн-режим.
   Кладе сторінку, карту (map.png), data.json, Leaflet і шрифт іконок у кеш браузера. */
const VERSION = "v4";
const LOCAL_CACHE = "gps-local-" + VERSION;
const LIB_CACHE = "gps-libs-v1";

const LOCAL_URLS = ["./", "./index.html", "./map.png", "./data.json", "./manifest.webmanifest", "./icon.svg"];
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
// ВАЖЛИВО: цей рядок має збігатися з посиланням на шрифт в index.html
const ICON_FONT_CSS = "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400..600,0..1,0&icon_names=auto_awesome,chevron_right,close,cloud_done,cloud_off,dark_mode,directions_car,edit_road,explore,keyboard_arrow_down,light_mode,local_shipping,location_on,lock,lock_open,play_arrow,straighten,swap_vert,visibility,zoom_out_map&display=block";
const LIB_HOSTS = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

async function putSafe(cache, url, init) {
  try {
    const res = await fetch(url, init);
    if (res && (res.ok || res.type === "opaque")) { await cache.put(url, res.clone()); return res; }
  } catch (e) { /* ресурсу немає або немає мережі — пропускаємо */ }
  return null;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const local = await caches.open(LOCAL_CACHE);
    await Promise.all(LOCAL_URLS.map(u => putSafe(local, u, { cache: "reload" })));

    const libs = await caches.open(LIB_CACHE);
    await Promise.all([LEAFLET_CSS, LEAFLET_JS].map(async u => (await putSafe(libs, u, { mode: "cors" })) || putSafe(libs, u, { mode: "no-cors" })));
    // CSS шрифту + файли шрифту (woff2), на які він посилається
    const css = await putSafe(libs, ICON_FONT_CSS, { mode: "cors" });
    if (css) {
      try {
        const text = await css.clone().text();
        const urls = [...text.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1].replace(/['"]/g, ""));
        await Promise.all([...new Set(urls)].map(u => putSafe(libs, u, { mode: "cors" })));
      } catch (e) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = [LOCAL_CACHE, LIB_CACHE];
    for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)); }

// Спершу мережа (щоб оновлення приходили), якщо мережі немає або вона повільна — кеш
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(LOCAL_CACHE);
  try {
    const res = await Promise.race([fetch(request), timeout(4000)]);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(request, { ignoreSearch: true }))
      || (fallbackUrl && await cache.match(fallbackUrl, { ignoreSearch: true }))
      || Response.error();
  }
}

// Миттєво з кешу, а в фоні оновлюємо (для великих файлів, напр. map.png)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(LOCAL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const update = fetch(request).then(res => { if (res && res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
  return cached || (await update) || Response.error();
}

// Бібліотеки: кеш, а якщо немає — мережа і збереження
async function cacheFirst(request) {
  const cache = await caches.open(LIB_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
    return res;
  } catch (e) { return Response.error(); }
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const name = url.pathname.split("/").pop();
    if (req.mode === "navigate" || name === "" || name === "index.html" || name === "data.json" || name === "sw.js") {
      event.respondWith(networkFirst(req, "./index.html"));
    } else {
      event.respondWith(staleWhileRevalidate(req));
    }
    return;
  }
  if (LIB_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(req));
});
