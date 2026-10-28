// Undercut service worker: shows price alerts sent with Web Push.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Undercut', body: 'A price changed.', url: '/' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url },
      tag: data.url,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'));
});
