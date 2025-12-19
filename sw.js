const CACHE='cow-ear-tag-v1';
const ASSETS=['./','./index.html','./style.css','./script.js','./data.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));