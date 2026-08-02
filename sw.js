/*!
 * アクロスコード (AcrossChord) — Service Worker
 * オフラインでも起動できるようアプリ本体をキャッシュする。
 * データ (localStorage) には関与しない。
 */
'use strict';

const CACHE = 'acrosschord-v2.3.0';
const ASSETS = [
    './',
    './index.html',
    './js/data.js',
    './js/app.js',
    './icons/icon.png',
    './icons/icon-192.png',
    './manifest.webmanifest',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

/* キャッシュ優先 + バックグラウンド更新 (stale-while-revalidate)。
   オフラインならキャッシュ、オンラインなら次回起動時に最新が反映される。 */
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    if (url.origin !== location.origin) return;
    e.respondWith(
        caches.match(e.request).then(cached => {
            const fetched = fetch(e.request).then(res => {
                if (res && res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            }).catch(() => cached);
            return cached || fetched;
        })
    );
});
