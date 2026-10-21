/* =====================================================================
 * Service Worker — ISUStoPRA
 * ---------------------------------------------------------------------
 * - CACHE_NAME contiene la versión de la app (la lee el chip dinámico).
 * - Responde a postMessage({type:'GET_VERSION'}) con la versión actual.
 * - Notifica a los clientes cuando se activa una nueva versión.
 * - Estrategia de cache: stale-while-revalidate para el núcleo,
 *   network-first para Firebase y CDN.
 * ===================================================================== */

// === VERSIÓN DE LA APLICACIÓN ===
// Bump de este valor en cada release; el chip del header lo mostrará.
const APP_VERSION = 'v1.22.0';
const CACHE_NAME = `isustopra-${APP_VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Recursos externos: no se cachean agresivamente (Firebase, CDN).
const NETWORK_ONLY_HOSTS = [
  'www.gstatic.com',
  'firebasestorage.googleapis.com',
  'tecdea-default-rtdb.europe-west1.firebasedatabase.app',
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// --- Install: precachea el núcleo y activa cuanto antes ---
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll falla si alguno falta; lo hacemos tolerante.
    await Promise.all(
      PRECACHE.map(async (url) => {
        try { await cache.add(url); } catch (e) { /* recurso opcional */ }
      })
    );
    await self.skipWaiting();
  })());
});

// --- Activate: limpia caches viejos y notifica nueva versión ---
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // ============================================================
    // AUTOPROTECCIÓN: si por cualquier motivo este SW está
    // controlando la raíz del dominio (interferiría con el portal
    // tecdea.github.io), se DESREGISTRA a sí mismo y libera a
    // todos los clientes.
    // ============================================================
    if (self.registration && self.registration.scope) {
      const scopeUrl = new URL(self.registration.scope, self.location.href);
      const scopePath = scopeUrl.pathname.replace(/\/+$/, '') || '/';
      if (scopePath === '/') {
        console.error('[ISUStoPRA SW] Scope es la raíz del dominio (', scopeUrl.href,
          '). Desregistrando para no interferir con el portal.');
        try {
          const clients = await self.clients.matchAll({ includeUncontrolled: true });
          for (const c of clients) {
            c.postMessage({ type: 'SW_UNREGISTERED_REASON_SCOPE_ROOT' });
          }
          await self.registration.unregister();
          // Forzar recarga de los clientes para que ya no estén controlados
          for (const c of clients) {
            try { await c.navigate(c.url); } catch (_) {}
          }
          return; // No hacemos nada más
        } catch (e) {
          console.error('[ISUStoPRA SW] Error al autodesregistrar:', e);
        }
      }
    }

    const keys = await caches.keys();
    // Bug 2 fix: solo borrar caches que empiecen por nuestro prefijo
    // 'isustopra-'. caches.keys() es origin-scoped, así que sin este
    // filtro borraríamos también caches del portal tecdea.github.io
    // u otras PWAs del mismo origen.
    await Promise.all(
      keys.filter(k => k.startsWith('isustopra-') && k !== CACHE_NAME).map(k => caches.delete(k))
    );
    await self.clients.claim();
    // Avisar a todas las pestañas abiertas para que refresquen el chip.
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => {
      c.postMessage({ type: 'SW_ACTIVATED', version: APP_VERSION });
    });
  })());
});

// --- Message: API para que la página consulte la versión ---
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'GET_VERSION') {
    // Responde al remitente; usa event.source si está disponible.
    const target = event.source || (event.ports && event.ports[0]);
    if (target) {
      target.postMessage({ type: 'SW_VERSION', version: APP_VERSION });
    }
  } else if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- Fetch: estrategia híbrida ---
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Hosts que siempre van a la red (Firebase Auth/DB, CDNs)
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Navegación: fallback a index.html cacheado si offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', net.clone()).catch(() => {});
        return net;
      } catch {
        const cached = await caches.match('./index.html');
        return cached || caches.match('./');
      }
    })());
    return;
  }

  // Resto: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const netPromise = fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || netPromise || new Response('', { status: 504 });
  })());
});
