/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// vite-plugin-pwa (injectManifest) replaces self.__WB_MANIFEST with the
// list of built assets to precache. This is what makes the app shell load
// offline and installable to the home screen.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Web Push ────────────────────────────────────────────────────────────
// Renders a notification from a daemon-sent push payload. See src/lib/push.ts
// for the client subscribe + registration flow. Payload shape is the
// daemon's choice; we default gracefully when it's absent/opaque.
self.addEventListener('push', (event: PushEvent) => {
  let title = 'pocket-t';
  let body = 'Your agent needs attention.';
  let data: Record<string, unknown> = {};
  try {
    const json = event.data?.json() as { title?: string; body?: string; data?: Record<string, unknown> } | undefined;
    if (json) {
      if (json.title) title = json.title;
      if (json.body) body = json.body;
      if (json.data) data = json.data;
    }
  } catch {
    const text = event.data?.text();
    if (text) body = text;
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: (data.tag as string) || 'pocket-t-push',
      data,
      badge: '/icons/icon-192.png',
      icon: '/icons/icon-192.png',
    }),
  );
});

// Tapping a notification focuses an existing tab (or opens one), deep-linking
// to the session if the daemon included one in the payload.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const sessionId = (event.notification.data && (event.notification.data.sessionId as string)) || '';
  const target = sessionId ? `/?session=${encodeURIComponent(sessionId)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
