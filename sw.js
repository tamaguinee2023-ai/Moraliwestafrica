// ══════════════════════════════════════════════
//  MORALI BTP — Service Worker
//  Stratégie : Cache-first pour assets statiques
//              Network-first pour Supabase (données)
//              Offline fallback sur la page HTML
// ══════════════════════════════════════════════

const CACHE_VERSION = 'morali-v3';
const CACHE_STATIC  = CACHE_VERSION + '-static';

// Assets à mettre en cache lors de l'installation
const STATIC_ASSETS = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700&family=DM+Mono:ital,wght@0,300;0,400;0,500;0,700;1,300;1,700&family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,300;1,14..32,700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ── INSTALL : précache des assets statiques ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Précache échoué pour:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE : nettoyage anciens caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_STATIC)
          .map(key => {
            console.log('[SW] Suppression ancien cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH : stratégie selon le type de requête ──
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const method = event.request.method;

  // 1. Ignorer les requêtes non-GET
  if(method !== 'GET') return;

  // 2. Requêtes Supabase → Network-first, pas de cache
  if(url.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Hors ligne + requête Supabase → retourner une réponse JSON vide
        return new Response(JSON.stringify({ data: [], error: { message: 'Hors ligne' } }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 3. Page HTML principale → Network-first avec fallback cache
  if(url.includes('.html') || url.endsWith('/') || !url.includes('.')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Mettre à jour le cache si réponse valide
          if(response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Hors ligne → servir depuis cache
          return caches.match(event.request)
            .then(cached => cached || caches.match('./'))
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // 4. Assets statiques (fonts, CDN libs) → Cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      // Pas en cache → fetch + mettre en cache
      return fetch(event.request).then(response => {
        if(response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_STATIC).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => new Response('', { status: 503 }));
    })
  );
});

// ── MESSAGE : force mise à jour ──
self.addEventListener('message', event => {
  if(event.data === 'SKIP_WAITING') self.skipWaiting();
});
