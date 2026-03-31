// ══════════════════════════════════════════════
//  MORALI BTP — Service Worker v4
//  Optimisé pour Vercel
// ══════════════════════════════════════════════

const CACHE_NAME = 'morali-v4';

const PRECACHE = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700&family=DM+Mono:ital,wght@0,300;0,400;0,500;0,700;1,300;1,700&family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,300;1,14..32,700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(PRECACHE.map(url =>
        cache.add(url).catch(() => {})
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = request.url;

  if(request.method !== 'GET') return;

  // Supabase : reseau uniquement, fallback JSON vide si offline
  if(url.includes('supabase.co')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ data: null, error: { message: 'Hors ligne' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Navigation HTML : network-first, cache fallback
  if(request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if(res && res.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then(c => c || caches.match('/')))
    );
    return;
  }

  // Assets : cache-first
  e.respondWith(
    caches.match(request).then(cached => {
      if(cached) return cached;
      return fetch(request).then(res => {
        if(res && res.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
        }
        return res;
      }).catch(() => new Response('', { status: 503 }));
    })
  );
});

self.addEventListener('message', e => {
  if(e.data === 'SKIP_WAITING') self.skipWaiting();
});
