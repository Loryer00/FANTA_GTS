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
        vibrate: [300, 200, 300, 200, 300, 200, 300], // POTENZIATO
        requireInteraction: true,
        tag: 'fantagts-urgent',
        renotify: true,
        silent: false,
        // AGGIUNTO: configurazioni avanzate per lockscreen
        sticky: true, // Notifica persistente
        noscreen: false, // NON nascondere quando schermo spento
        data: {
            url: '/',
            timestamp: Date.now(),
            action: 'open_app',
            lockscreen: true,
            wakeup: true
        },
        actions: [
            {
                action: 'open',
                title: '🚀 Apri FantaGTS'
            },
            {
                action: 'remind',
                title: '⏰ Ricorda'
            }
        ]
    };

    // NUOVO: Gestione dati push migliorata
    if (event.data) {
        try {
            const pushData = event.data.json();
            console.log('📋 Dati push parsati:', pushData);

            notificationData.title = pushData.title || notificationData.title;
            notificationData.body = pushData.body || notificationData.body;

            // AGGIUNTO: Applica configurazioni Android se presenti
            if (pushData.android) {
                Object.assign(notificationData, pushData.android);
            }

            if (pushData.data) {
                notificationData.data = { ...notificationData.data, ...pushData.data };
            }

            // NUOVO: Se è una notifica urgente, massimizza impatto
            if (pushData.data && pushData.data.urgent) {
                notificationData.requireInteraction = true;
                notificationData.vibrate = [500, 300, 500, 300, 500, 300, 500];
                notificationData.tag = `fantagts-urgent-${Date.now()}`; // Tag unico per evitare sovrascrittura
            }

        } catch (error) {
            console.error('❌ Errore parsing dati push:', error);
        }
    }

    console.log('🔔 Mostrando notifica con dati:', notificationData);

    // NUOVO: Tentativo di "risveglio" tramite multiple notifiche
    event.waitUntil(
        Promise.all([
            // Notifica principale
            self.registration.showNotification(notificationData.title, notificationData),

            // AGGIUNTO: Tentativo risveglio con notifica silenziosa immediata
            new Promise(resolve => {
                setTimeout(() => {
                    if (notificationData.data && notificationData.data.wakeup) {
                        self.registration.showNotification('', {
                            tag: 'wakeup-helper',
                            silent: true,
                            vibrate: [100],
                            actions: [],
                            data: { helper: true }
                        }).then(() => {
                            // Chiudi immediatamente la notifica helper
                            setTimeout(() => {
                                self.registration.getNotifications({ tag: 'wakeup-helper' })
                                    .then(notifications => {
                                        notifications.forEach(n => n.close());
                                    });
                            }, 100);
                        });
                    }
                    resolve();
                }, 100);
            })
        ]).then(() => {
            console.log('✅ Notifica mostrata con successo (con tentativo risveglio)');
        }).catch(error => {
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
        return;
    }

    // AGGIUNTO: Gestione nuova azione "remind"
    if (event.action === 'remind') {
        console.log('⏰ Programmazione reminder tra 1 minuto');

        // Programma reminder
        setTimeout(() => {
            self.registration.showNotification('🔔 FantaGTS - Reminder', {
                body: 'Non dimenticare di fare la tua offerta!',
                icon: event.notification.icon,
                vibrate: [300, 200, 300],
                requireInteraction: true,
                tag: 'fantagts-reminder',
                data: { url: fullUrl }
            });
        }, 60000); // 1 minuto

        return;
    }

    // MIGLIORE gestione apertura app
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then((windowClients) => {
            console.log('🔍 Client trovati:', windowClients.length);

            for (let client of windowClients) {
                if (client.url.includes(self.location.origin)) {
                    console.log('✅ Trovato client esistente, portandolo in focus');
                    return client.focus().then(() => {
                        return client.navigate(fullUrl);
                    });
                }
            }

            console.log('🆕 Aprendo nuova finestra');
            return clients.openWindow(fullUrl);
        }).catch(error => {
            console.error('❌ Errore apertura finestra:', error);
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