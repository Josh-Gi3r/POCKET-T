const CACHE = 'pocket-t-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api') ||
      url.pathname.startsWith('/socket.io')) return;

  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request).then(
        (r) => r ?? caches.match('/index.html')
      )
    )
  );
});

// ── Push notification ─────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { return; }

  const {
    title = 'pocket-t',
    body  = '',
    sessionId,
    messageId,
    kind,
    options = [],
  } = data;

  const opts = {
    body,
    icon:             '/icons/icon-192.png',
    badge:            '/icons/badge-72.png',
    tag:              `session:${sessionId}`,
    renotify:         true,
    requireInteraction: kind === 'approval',
    data:             { sessionId, messageId, kind, url: `/chat/${sessionId}` },
    vibrate:          kind === 'approval' ? [200,100,200,100,200] : [200],
  };

  if (kind === 'approval' && options.length > 0) {
    opts.actions = options.slice(0, 2).map((o) => ({
      action: o.key,
      title:  o.label,
    }));
  }

  e.waitUntil(
    self.registration.showNotification(title, opts)
  );
});

// ── Notification click ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  const { sessionId, messageId, url } = e.notification.data || {};
  e.notification.close();

  // Approval action button tapped
  if (e.action && sessionId && messageId) {
    e.waitUntil(
      fetch(`/api/sessions/${sessionId}/approve`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ choice: e.action, messageId }),
      }).catch(() => {})
    );
    return;
  }

  // Body tapped — open session
  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((wins) => {
        const target = wins.find(
          (w) => w.url.includes(`/chat/${sessionId}`)
        );
        if (target) return target.focus();
        return self.clients.openWindow(url || `/chat/${sessionId}`);
      })
  );
});
