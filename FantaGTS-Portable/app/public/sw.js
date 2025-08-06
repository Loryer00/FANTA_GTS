// sw.js - Service Worker per Notifiche Push
const CACHE_NAME = 'fantagts-notifications';

// Installazione Service Worker
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker: Installazione per notifiche');
    self.skipWaiting(); // Attiva immediatamente
});

// Attivazione Service Worker
self.addEventListener('activate', (event) => {
    console.log('🚀 Service Worker: Attivazione per notifiche');
    event.waitUntil(self.clients.claim()); // Prendi controllo di tutte le pagine
});

// Gestione Push Notifications
self.addEventListener('push', (event) => {
    console.log('📨 Service Worker: Push notification ricevuta');

    let notificationData = {
        title: 'FantaGTS',
        body: 'Nuovo evento nel FantaGTS!',
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E',
        badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E',
        vibrate: [100, 50, 100],
        data: {
            url: '/',
            timestamp: Date.now()
        },
        actions: [
            {
                action: 'open',
                title: 'Apri FantaGTS'
            },
            {
                action: 'close',
                title: 'Chiudi'
            }
        ]
    };

    // Se ci sono dati nel push, usali
    if (event.data) {
        try {
            const pushData = event.data.json();
            notificationData.title = pushData.title || notificationData.title;
            notificationData.body = pushData.body || notificationData.body;
            if (pushData.url) {
                notificationData.data.url = pushData.url;
            }
        } catch (error) {
            console.log('Errore parsing dati push:', error);
        }
    }

    event.waitUntil(
        self.registration.showNotification(notificationData.title, notificationData)
    );
});

// Click su notifica
self.addEventListener('notificationclick', (event) => {
    console.log('🔔 Service Worker: Click su notifica');

    event.notification.close();

    const urlToOpen = event.notification.data?.url || '/';
    const fullUrl = new URL(urlToOpen, self.location.origin).href;

    if (event.action === 'close') {
        // L'utente ha cliccato "Chiudi"
        return;
    }

    // Apri o porta in focus FantaGTS
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((windowClients) => {
                // Cerca se c'è già una finestra aperta con FantaGTS
                for (let client of windowClients) {
                    if (client.url.includes(self.location.origin)) {
                        return client.focus().then(() => {
                            return client.navigate(fullUrl);
                        });
                    }
                }

                // Apri nuova finestra
                return clients.openWindow(fullUrl);
            })
    );
});

// Gestione messaggi dall'app
self.addEventListener('message', (event) => {
    const { type, data } = event.data || {};

    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;

        case 'GET_VERSION':
            event.ports[0]?.postMessage({ version: CACHE_NAME });
            break;

        case 'KEEP_ALIVE':
            console.log('💓 Service Worker: Keep alive ricevuto');
            break;
    }
});

console.log('✅ Service Worker FantaGTS per notifiche caricato');