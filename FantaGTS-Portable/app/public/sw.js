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

// Gestione Push Notifications - VERSIONE MIGLIORATA
self.addEventListener('push', (event) => {
    console.log('📨 Service Worker: Push notification ricevuta');
    console.log('📱 Dati push ricevuti:', event.data ? event.data.text() : 'Nessun dato');

    let notificationData = {
        title: 'FantaGTS',
        body: 'Nuovo evento nel FantaGTS!',
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E',
        badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E',
        vibrate: [100, 50, 100, 50, 100],
        requireInteraction: true,
        tag: 'fantagts-notification',
        renotify: true,
        silent: false,
        data: {
            url: '/',
            timestamp: Date.now(),
            action: 'open_app'
        },
        actions: [
            {
                action: 'open',
                title: 'Apri FantaGTS',
                icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E'
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
            console.log('📋 Dati push parsati:', pushData);

            notificationData.title = pushData.title || notificationData.title;
            notificationData.body = pushData.body || notificationData.body;

            if (pushData.data) {
                notificationData.data = { ...notificationData.data, ...pushData.data };
            }

            if (pushData.url) {
                notificationData.data.url = pushData.url;
            }

            // Mantieni proprietà avanzate dal server
            if (pushData.requireInteraction !== undefined) {
                notificationData.requireInteraction = pushData.requireInteraction;
            }
            if (pushData.tag) {
                notificationData.tag = pushData.tag;
            }
            if (pushData.vibrate) {
                notificationData.vibrate = pushData.vibrate;
            }

        } catch (error) {
            console.error('❌ Errore parsing dati push:', error);
        }
    }

    console.log('🔔 Mostrando notifica con dati:', notificationData);

    event.waitUntil(
        self.registration.showNotification(notificationData.title, notificationData)
            .then(() => {
                console.log('✅ Notifica mostrata con successo');
            })
            .catch(error => {
                console.error('❌ Errore mostrando notifica:', error);
            })
    );
});

// Click su notifica - VERSIONE MIGLIORATA
self.addEventListener('notificationclick', (event) => {
    console.log('🔔 Service Worker: Click su notifica');

    event.notification.close();

    const urlToOpen = event.notification.data?.url || '/';
    const fullUrl = new URL(urlToOpen, self.location.origin).href;

    if (event.action === 'close') {
        // L'utente ha cliccato "Chiudi"
        return;
    }

    // MIGLIORE gestione apertura app
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then((windowClients) => {
            console.log('🔍 Client trovati:', windowClients.length);

            // Cerca se c'è già una finestra aperta con FantaGTS
            for (let client of windowClients) {
                console.log('🔍 Controllando client:', client.url);
                if (client.url.includes(self.location.origin)) {
                    console.log('✅ Trovato client esistente, portandolo in focus');
                    return client.focus().then(() => {
                        // Naviga alla pagina corretta
                        return client.navigate(fullUrl);
                    });
                }
            }

            // Se non trova finestre aperte, apri nuova finestra
            console.log('🆕 Aprendo nuova finestra');
            return clients.openWindow(fullUrl);
        }).catch(error => {
            console.error('❌ Errore apertura finestra:', error);
            // Fallback: prova comunque ad aprire
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