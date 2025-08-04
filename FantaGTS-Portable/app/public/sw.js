// sw.js - Service Worker FantaGTS PWA
const CACHE_NAME = 'fantagts-v1.0.0';
const OFFLINE_URL = '/offline.html';

// File da cacheare per funzionamento offline
const STATIC_CACHE_URLS = [
    '/',
    '/master',
    '/setup',
    '/offline.html',
    '/manifest.json',
    '/socket.io/socket.io.js',
    // Icone
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// File dinamici da cacheare (API responses)
const DYNAMIC_CACHE_URLS = [
    '/api/stato',
    '/api/partecipanti',
    '/api/squadre'
];

// Installazione Service Worker
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker: Installazione');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Service Worker: Caching file statici');
                // Cache i file uno per volta per evitare errori se qualcuno non esiste
                return Promise.allSettled(
                    STATIC_CACHE_URLS.map(url =>
                        cache.add(url).catch(err => {
                            console.log(`⚠️ Impossibile cacheare ${url}:`, err.message);
                            return null;
                        })
                    )
                );
            })
            .then(() => {
                console.log('✅ Service Worker: Installazione completata');
                return self.skipWaiting(); // Attiva immediatamente
            })
    );
});

// Attivazione Service Worker
self.addEventListener('activate', (event) => {
    console.log('🚀 Service Worker: Attivazione');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                // Rimuovi cache vecchie
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('🗑️ Service Worker: Rimozione cache vecchia:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('✅ Service Worker: Attivazione completata');
                return self.clients.claim(); // Prendi controllo di tutte le pagine
            })
    );
});

// Gestione delle richieste (fetch)
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Strategia Cache-First per file statici
    if (STATIC_CACHE_URLS.includes(url.pathname) || 
        request.destination === 'image' || 
        request.destination === 'style' || 
        request.destination === 'script') {
        
        event.respondWith(
            caches.match(request)
                .then((response) => {
                    return response || fetch(request);
                })
                .catch(() => {
                    // Fallback per navigazione
                    if (request.mode === 'navigate') {
                        return caches.match(OFFLINE_URL);
                    }
                })
        );
        return;
    }
    
    // Strategia Network-First per API
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Salva in cache solo se la risposta è ok
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(request, responseClone);
                            });
                    }
                    return response;
                })
                .catch(() => {
                    // Fallback alla cache se offline
                    return caches.match(request)
                        .then((response) => {
                            if (response) {
                                return response;
                            }
                            // Risposta di fallback per API
                            return new Response(
                                JSON.stringify({ 
                                    error: 'Offline - Dati non disponibili',
                                    offline: true 
                                }),
                                { 
                                    headers: { 'Content-Type': 'application/json' },
                                    status: 503
                                }
                            );
                        });
                })
        );
        return;
    }
    
    // Strategia Network-First per tutto il resto
    event.respondWith(
        fetch(request)
            .then((response) => {
                return response;
            })
            .catch(() => {
                return caches.match(request)
                    .then((response) => {
                        return response || caches.match(OFFLINE_URL);
                    });
            })
    );
});

// Gestione messaggi dall'app
self.addEventListener('message', (event) => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'GET_VERSION':
            event.ports[0].postMessage({ version: CACHE_NAME });
            break;
            
        case 'CACHE_URLS':
            event.waitUntil(
                caches.open(CACHE_NAME)
                    .then((cache) => cache.addAll(data.urls))
            );
            break;
            
        case 'CLEAR_CACHE':
            event.waitUntil(
                caches.delete(CACHE_NAME)
                    .then(() => {
                        event.ports[0].postMessage({ success: true });
                    })
            );
            break;
            
        case 'KEEP_ALIVE':
            // Heartbeat per mantenere SW attivo
            console.log('💓 Service Worker: Keep alive ricevuto');
            break;
    }
});

// Push Notifications
self.addEventListener('push', (event) => {
    console.log('📨 Service Worker: Push notification ricevuta');
    
    const options = {
        body: 'Nuovo evento nel FantaGTS!',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Apri FantaGTS',
                icon: '/icons/action-explore.png'
            },
            {
                action: 'close',
                title: 'Chiudi',
                icon: '/icons/action-close.png'
            }
        ]
    };
    
    if (event.data) {
        const pushData = event.data.json();
        options.body = pushData.body || options.body;
        options.title = pushData.title || 'FantaGTS';
        
        if (pushData.url) {
            options.data.url = pushData.url;
        }
    }
    
    event.waitUntil(
        self.registration.showNotification('FantaGTS', options)
    );
});

// Click su notifica
self.addEventListener('notificationclick', (event) => {
    console.log('🔔 Service Worker: Click su notifica');
    
    event.notification.close();
    
    const urlToOpen = event.notification.data?.url || '/';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((windowClients) => {
                // Cerca se c'è già una finestra aperta
                for (let client of windowClients) {
                    if (client.url.includes(self.location.origin)) {
                        return client.focus().then(() => {
                            return client.navigate(urlToOpen);
                        });
                    }
                }
                
                // Apri nuova finestra
                return clients.openWindow(urlToOpen);
            })
    );
});

// Background Sync (per azioni offline)
self.addEventListener('sync', (event) => {
    console.log('🔄 Service Worker: Background sync:', event.tag);
    
    if (event.tag === 'background-sync-fantagts') {
        event.waitUntil(syncOfflineActions());
    }
});

// Funzione per sincronizzare azioni offline
async function syncOfflineActions() {
    try {
        // Qui puoi implementare la logica per sincronizzare
        // le azioni che l'utente ha fatto offline
        console.log('🔄 Sincronizzazione azioni offline...');
        
        // Esempio: invia offerte salvate offline
        const offlineActions = await getOfflineActions();
        
        for (const action of offlineActions) {
            try {
                await fetch(action.url, {
                    method: action.method,
                    headers: action.headers,
                    body: action.body
                });
                
                // Rimuovi azione dopo sincronizzazione
                await removeOfflineAction(action.id);
                
            } catch (error) {
                console.error('Errore sincronizzazione azione:', error);
            }
        }
        
    } catch (error) {
        console.error('Errore background sync:', error);
    }
}

// Placeholder per gestione azioni offline
async function getOfflineActions() {
    // Implementare logica per recuperare azioni salvate offline
    return [];
}

async function removeOfflineAction(actionId) {
    // Implementare logica per rimuovere azione dopo sincronizzazione
    console.log('Azione sincronizzata e rimossa:', actionId);
}

console.log('✅ Service Worker FantaGTS caricato');