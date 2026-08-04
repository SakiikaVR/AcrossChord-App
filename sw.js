/*!
 * アクロスコード (AcrossChord) — Service Worker
 * オフラインでも起動できるようアプリ本体をキャッシュする。
 * データ (localStorage) には関与しない。
 */
'use strict';

const CACHE = 'acrosschord-v2.4.0';
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

/* オンライン時は更新をその場で反映し、失敗時だけキャッシュへ戻る。
   古いJSがもう一度返される stale-while-revalidate の更新遅延を避ける。 */
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    if (url.origin !== location.origin) return;
    e.respondWith(fetch(e.request,{cache:'no-cache'}).then(res => {
        if(res&&res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(e.request,clone))}
        return res;
    }).catch(()=>caches.match(e.request)));
});
