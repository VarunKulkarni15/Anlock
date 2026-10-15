/* ==========================================================================
   ANLOCK SERVICE WORKER
   Offline Cache + Web Push Notifications Handling
   ========================================================================== */

const CACHE_NAME = 'anlock-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network first, falling back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Web Push Notification Listener (Free WebPush / FCM)
self.addEventListener('push', (event) => {
  let data = { title: 'Anlock Unlock Request', body: 'Touch fingerprint to unlock your PC.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || 'Unlock request from your Windows PC',
    icon: './icon.svg',
    badge: './icon.svg',
    vibrate: [80, 50, 100],
    data: data.url || './index.html',
    actions: [
      { action: 'unlock', title: 'Unlock PC' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Anlock PC Unlock', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
