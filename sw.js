/* ═══════════════════════════════════════════════════════════════
   MORALI WEST AFRICA — SERVICE WORKER PWA
   Stratégie : Network-First pour Supabase, Cache-First pour assets
   ═══════════════════════════════════════════════════════════════ */

const SW_VERSION   = 'morali-v1.0.0';
const CACHE_STATIC = `${SW_VERSION}-static`;
const CACHE_PAGES  = `${SW_VERSION}-pages`;
const CACHE_FONTS  = `${SW_VERSION}-fonts`;

// ── Assets à mettre en cache immédiatement à l'installation ──
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Librairies CDN critiques
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// ── Domaines Supabase — toujours réseau-first, jamais mis en cache ──
// Couvre : REST API, Auth, Realtime (WebSocket), Storage, Edge Functions
const SUPABASE_DOMAINS = [
  'supabase.co',
  'supabase.com',
  'supabase.io',
];

// ── Domaines Google Fonts — cache agressif ──
const FONT_DOMAINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ══════════════════════════════════════════════
// INSTALL — Précache les assets statiques
// ══════════════════════════════════════════════
self.addEventListener('install', event => {
  console.log('[SW] Install', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        // On essaie chaque asset individuellement pour ne pas bloquer sur un échec
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn('[SW] Cache miss pour :', url, err.message)
            )
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ══════════════════════════════════════════════
// ACTIVATE — Nettoyer les anciens caches
// ══════════════════════════════════════════════
self.addEventListener('activate', event => {
  console.log('[SW] Activate', SW_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('morali-') && k !== CACHE_STATIC && k !== CACHE_PAGES && k !== CACHE_FONTS)
          .map(k => {
            console.log('[SW] Suppression ancien cache :', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ══════════════════════════════════════════════
// FETCH — Stratégie intelligente par type
// ══════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // Ignorer les extensions Chrome et URLs spéciales
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') return;

  // ── 1. Supabase → Toujours réseau, jamais cache ──
  // (REST API, Auth JWT, Realtime WS, Storage, Edge Functions)
  if (SUPABASE_DOMAINS.some(d => url.hostname.includes(d))) {
    event.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ error: 'Hors ligne — données Supabase non disponibles' }),
        { headers: { 'Content-Type': 'application/json' }, status: 503 }
      ))
    );
    return;
  }

  // ── 2. Google Fonts → Cache agressif (stale-while-revalidate) ──
  if (FONT_DOMAINS.some(d => url.hostname.includes(d))) {
    event.respondWith(
      caches.open(CACHE_FONTS).then(cache =>
        cache.match(request).then(cached => {
          const networkFetch = fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // ── 3. CDN (cdnjs, jsdelivr) → Cache-first ──
  if (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.open(CACHE_STATIC).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // ── 4. Page principale (/) → Network-first avec fallback cache ──
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_PAGES).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached =>
            cached || caches.match('/index.html').then(fallback =>
              fallback || new Response(offlinePage(), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
              })
            )
          )
        )
    );
    return;
  }

  // ── 5. Tout le reste → Network avec cache optionnel ──
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ══════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ══════════════════════════════════════════════
self.addEventListener('push', event => {
  let data = { title: 'Morali Stock', body: 'Nouvelle notification', icon: '/icons/icon-192.png', badge: '/icons/icon-96.png' };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = { ...data, ...payload };
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body:    data.body,
    icon:    data.icon    || '/icons/icon-192.png',
    badge:   data.badge   || '/icons/icon-96.png',
    tag:     data.tag     || 'morali-notif',
    data:    data.url     || '/',
    vibrate: [100, 50, 100],
    actions: data.actions || [
      { action: 'open',    title: '📦 Ouvrir',  icon: '/icons/icon-96.png' },
      { action: 'dismiss', title: '✕ Ignorer' }
    ],
    requireInteraction: data.requireInteraction || false,
    silent: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Clic sur notification ──
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Chercher une fenêtre déjà ouverte
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
            return client.focus();
          }
        }
        // Ouvrir une nouvelle fenêtre
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// ── Fermeture de notification ──
self.addEventListener('notificationclose', event => {
  console.log('[SW] Notification fermée', event.notification.tag);
});

// ══════════════════════════════════════════════
// BACKGROUND SYNC — synchronisation différée
// ══════════════════════════════════════════════
self.addEventListener('sync', event => {
  if (event.tag === 'morali-sync-movements') {
    event.waitUntil(syncPendingMovements());
  }
});

async function syncPendingMovements() {
  console.log('[SW] Background sync — mouvements en attente');
  // Supabase gère sa propre reconnexion automatique (Realtime)
  // Cette fonction notifie les clients ouverts pour déclencher un re-fetch
  const clientList = await clients.matchAll({ type: 'window' });
  clientList.forEach(client =>
    client.postMessage({ type: 'BACKGROUND_SYNC_COMPLETE' })
  );
}

// ══════════════════════════════════════════════
// MESSAGES depuis le client principal
// ══════════════════════════════════════════════
self.addEventListener('message', event => {
  if (!event.data) return;

  switch (event.data.type) {

    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: SW_VERSION });
      break;

    case 'CLEAR_CACHE':
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k.startsWith('morali-')).map(k => caches.delete(k)))
      ).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;
  }
});

// ══════════════════════════════════════════════
// PAGE OFFLINE DE SECOURS (inline HTML)
// ══════════════════════════════════════════════
function offlinePage() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Morali Stock — Hors ligne</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:#0a1628;color:#fff;
    font-family:'IBM Plex Sans',system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;
    min-height:100vh;padding:24px;
  }
  .wrap{text-align:center;max-width:340px;}
  .icon{font-size:56px;margin-bottom:20px;}
  h1{font-size:22px;font-weight:700;color:#60a8ff;margin-bottom:10px;}
  p{font-size:14px;color:#6b8fc4;line-height:1.6;margin-bottom:28px;}
  button{
    background:linear-gradient(135deg,#88c0ff,#60a8ff);
    color:#0a1628;border:none;border-radius:8px;
    padding:12px 28px;font-size:14px;font-weight:700;
    cursor:pointer;letter-spacing:.05em;
  }
  button:hover{filter:brightness(1.1);}
  .tip{
    margin-top:20px;font-size:11px;color:#1e3a6e;
    font-family:'IBM Plex Mono',monospace;letter-spacing:.1em;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="icon">📡</div>
  <h1>Connexion indisponible</h1>
  <p>Morali Stock nécessite une connexion pour synchroniser les données Firebase.<br>
  Vérifiez votre réseau et réessayez.</p>
  <button onclick="location.reload()">🔄 Réessayer</button>
  <p class="tip">// MORALI WEST AFRICA — OFFLINE MODE</p>
</div>
</body>
</html>`;
}
