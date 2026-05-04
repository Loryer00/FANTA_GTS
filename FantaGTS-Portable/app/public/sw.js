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
self.addEventListener('push', async (event) => {
    console.log('📨 Service Worker: Push notification ricevuta');
    console.log('📱 Dati push ricevuti:', event.data ? event.data.text() : 'Nessun dato');

    // 🆕 VERIFICA E RICREA SUBSCRIPTION SE NECESSARIA
    event.waitUntil(
        (async () => {
            try {
                // 1. Verifica subscription corrente
                const registration = await self.registration;
                const currentSubscription = await registration.pushManager.getSubscription();

                if (!currentSubscription) {
                    console.log('⚠️ SW: Subscription persa! Tento di ricrearla...');

                    try {
                        // 2. Ottieni chiavi VAPID
                        const vapidResponse = await fetch('/api/vapid-public-key');
                        const vapidData = await vapidResponse.json();

                        if (vapidData.publicKey) {
                            // 3. Crea nuova subscription
                            const newSubscription = await registration.pushManager.subscribe({
                                userVisibleOnly: true,
                                applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey)
                            });

                            console.log('✅ SW: Nuova subscription creata');

                            // 4. Salva nel database
                            await fetch('/api/resubscribe-push', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ subscription: newSubscription })
                            });

                            console.log('💾 SW: Subscription salvata nel database');
                        }
                    } catch (err) {
                        console.error('❌ SW: Impossibile ricreare subscription:', err);
                    }
                }

                // 5. Mostra la notifica comunque
                if (!event.data) {
                    console.log('⚠️ Nessun dato nella notifica');
                    return;
                }

                const data = event.data.json();
                console.log('📦 Dati notifica:', data);

                const options = {
                    body: data.body,
                    icon: data.icon || '/icon-192.png',
                    badge: data.badge || '/icons/badge-96x96.png',
                    vibrate: data.vibrate || [200, 100, 200],
                    data: data.data || {},
                    actions: data.actions || [],
                    requireInteraction: data.requireInteraction || false,
                    tag: data.tag || 'fantagts-notification',
                    renotify: data.renotify || false,
                    silent: data.silent || false,
                    image: data.image
                };

                await self.registration.showNotification(data.title, options);
                console.log('✅ Notifica mostrata con successo');

            } catch (error) {
                console.error('❌ Errore gestione notifica:', error);
            }
        })()
    );
});

// Funzione helper per convertire VAPID key
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

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