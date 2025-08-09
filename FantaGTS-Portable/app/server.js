// server.js - FantaGTS Server con PostgreSQL
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const path = require('path');
const os = require('os');

// Variabile globale sessione corrente
let sessioneCorrente = process.env.SESSIONE_CORRENTE || 'fantagts_2025';

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configurazione Web Push - VERSIONE FINALE
const webpush = require('web-push');
let webPushConfigured = false;
let currentVapidKeys = null;

try {
    // Usa chiavi da variabili ambiente SE ci sono
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        webpush.setVapidDetails(
            process.env.VAPID_EMAIL || 'mailto:fantagts@circolo.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
        currentVapidKeys = {
            publicKey: process.env.VAPID_PUBLIC_KEY,
            privateKey: process.env.VAPID_PRIVATE_KEY
        };
        webPushConfigured = true;
        console.log('✅ Web Push configurato con chiavi FISSE da ambiente');
    }
    // Altrimenti genera temporanee
    else {
        console.log('🔑 Generando chiavi VAPID temporanee...');
        currentVapidKeys = webpush.generateVAPIDKeys();

        webpush.setVapidDetails(
            'mailto:fantagts@circolo.com',
            currentVapidKeys.publicKey,
            currentVapidKeys.privateKey
        );
        webPushConfigured = true;
        console.log('⚠️ Web Push configurato con chiavi TEMPORANEE');
        console.log('📤 PUBLIC KEY:', currentVapidKeys.publicKey);
        console.log('🔐 PRIVATE KEY:', currentVapidKeys.privateKey);
    }
} catch (error) {
    console.error('❌ Errore configurazione Web Push:', error);
    webPushConfigured = false;
}

// Middleware
app.use(express.static('public'));
app.use(express.json());

console.log('🔍 Directory corrente:', __dirname);

// Database PostgreSQL
const connectionString = process.env.DATABASE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.POSTGRES_URL ||
    'postgresql://postgres:iUFrkUQnATpmwBXsbcUFcjtmtzMudUyk@postgres.railway.internal:5432/railway';

const db = new Pool({
    connectionString: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

console.log('🔍 Connessione PostgreSQL...');

// Inizializza database
async function initializeDatabase() {
    try {
        // Crea tabelle
        await db.query(`CREATE TABLE IF NOT EXISTS squadre_circolo (
            id SERIAL PRIMARY KEY,
            numero INTEGER UNIQUE NOT NULL,
            colore TEXT NOT NULL,
            m1 TEXT, m2 TEXT, m3 TEXT, m4 TEXT, m5 TEXT, m6 TEXT, m7 TEXT,
            f1 TEXT, f2 TEXT, f3 TEXT,
            attiva BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS partecipanti_fantagts (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            email TEXT,
            telefono TEXT,
            crediti INTEGER DEFAULT 2000,
            punti_totali INTEGER DEFAULT 0,
            posizione_classifica INTEGER,
            attivo BOOLEAN DEFAULT true,
            sessione_id TEXT DEFAULT 'default',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS slots (
            id TEXT PRIMARY KEY,
            squadra_numero INTEGER NOT NULL,
            colore TEXT NOT NULL,
            posizione TEXT NOT NULL,
            giocatore_attuale TEXT,
            punti_totali INTEGER DEFAULT 0,
            attivo BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS aste (
            id SERIAL PRIMARY KEY,
            round TEXT NOT NULL,
            partecipante_id TEXT NOT NULL,
            slot_id TEXT NOT NULL,
            offerta INTEGER NOT NULL,
            costo_finale INTEGER NOT NULL,
            premium REAL DEFAULT 0,
            vincitore BOOLEAN DEFAULT false,
            condiviso BOOLEAN DEFAULT false,
            sessione_id TEXT DEFAULT 'default',
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS sostituzioni (
            id SERIAL PRIMARY KEY,
            slot_id TEXT NOT NULL,
            giocatore_vecchio TEXT NOT NULL,
            giocatore_nuovo TEXT NOT NULL,
            dal_turno INTEGER,
            motivo TEXT,
            approvato BOOLEAN DEFAULT false,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS risultati_partite (
            id SERIAL PRIMARY KEY,
            turno INTEGER NOT NULL,
            squadra_1 INTEGER NOT NULL,
            squadra_2 INTEGER NOT NULL,
            risultato TEXT,
            vincitori TEXT,
            inserito_da TEXT,
            verificato BOOLEAN DEFAULT false,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            partecipante_id TEXT,
            endpoint TEXT UNIQUE,
            p256dh_key TEXT,
            auth_key TEXT,
            user_agent TEXT,
            sessione_id TEXT DEFAULT 'default',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            attiva BOOLEAN DEFAULT true
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS configurazione (
            chiave TEXT PRIMARY KEY,
            valore TEXT,
            descrizione TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS sessioni_fantagts (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            anno INTEGER,
            descrizione TEXT,
            attiva BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Inserisci configurazione predefinita
        await db.query(`INSERT INTO configurazione (chiave, valore, descrizione) VALUES 
            ('crediti_iniziali', '2000', 'Crediti iniziali per ogni partecipante'),
            ('durata_asta_secondi', '30', 'Durata di ogni round di aste'),
            ('premium_condivisione', '0.10', 'Premium percentuale per giocatori condivisi'),
            ('max_partecipanti', '30', 'Numero massimo di partecipanti'),
            ('backup_auto_minuti', '5', 'Frequenza backup automatici in minuti')
            ON CONFLICT (chiave) DO NOTHING`);

        console.log('✅ Database PostgreSQL inizializzato con successo');
    } catch (error) {
        console.error('❌ Errore inizializzazione database:', error);
    }
}

// Funzione per aggiornare database automaticamente
async function updateDatabaseSchema() {
    try {
        console.log('🔄 Aggiornando schema database...');

        // Aggiungi colonne se non esistono
        await db.query(`ALTER TABLE partecipanti_fantagts ADD COLUMN IF NOT EXISTS sessione_id TEXT DEFAULT 'default'`);
        await db.query(`ALTER TABLE aste ADD COLUMN IF NOT EXISTS sessione_id TEXT DEFAULT 'default'`);
        await db.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS sessione_id TEXT DEFAULT 'default'`);

        // Crea tabella sessioni se non esiste
        await db.query(`CREATE TABLE IF NOT EXISTS sessioni_fantagts (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            anno INTEGER,
            descrizione TEXT,
            attiva BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        console.log('✅ Schema database aggiornato');
    } catch (error) {
        console.error('❌ Errore aggiornamento schema:', error);
    }
}

// Stato del gioco in memoria
let gameState = {
    fase: 'setup',
    roundAttivo: null,
    asteAttive: false,
    connessi: new Map(),
    offerteTemporanee: new Map(),
    // 🆕 NUOVI CAMPI per multi-asta
    astaCorrente: 1,
    partecipantiAssegnati: new Set(),
    slotsRimasti: [],
    partecipantiInAttesa: [],
    // 🆕 CAMPI per controllo logging
    lastMonitorLog: null,
    lastOfferteCount: 0
};

// Funzioni utilità
function arrotondaAlPariPiuVicino(numero) {
    const intero = Math.floor(numero);
    const decimale = numero - intero;

    if (decimale < 0.5) {
        return intero;
    } else if (decimale > 0.5) {
        return intero + 1;
    } else {
        if (intero % 2 === 0) {
            return intero;
        } else {
            return intero + 1;
        }
    }
}

async function generaSlots() {
    try {
        const squadreResult = await db.query("SELECT * FROM squadre_circolo WHERE attiva = true");
        const squadre = squadreResult.rows;
        const posizioni = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'F1', 'F2', 'F3'];

        // Cancella slots esistenti
        await db.query("DELETE FROM slots");

        let inserimenti = 0;
        for (const squadra of squadre) {
            for (const pos of posizioni) {
                const slotId = `${pos}_${squadra.colore.toUpperCase()}`;
                const giocatore = squadra[pos.toLowerCase()];

                await db.query(
                    "INSERT INTO slots (id, squadra_numero, colore, posizione, giocatore_attuale) VALUES ($1, $2, $3, $4, $5)",
                    [slotId, squadra.numero, squadra.colore, pos, giocatore]
                );
                inserimenti++;
            }
        }

        return inserimenti;
    } catch (error) {
        throw error;
    }
}

// 🆕 NUOVA FUNZIONE: Avvia asta successiva nel round
function avviaAstaSuccessiva() {
    if (!gameState.asteAttive) return;

    console.log(`\n🎪 === ASTA ${gameState.astaCorrente} del ROUND ${gameState.roundAttivo} ===`);
    console.log(`👥 Partecipanti in attesa: ${gameState.partecipantiInAttesa.length}`);
    console.log(`🎯 Slots rimasti: ${gameState.slotsRimasti.length}`);
    console.log(`📋 Giocatori disponibili: ${gameState.slotsRimasti.map(s => s.giocatore_attuale).join(', ')}`);

    // 🔍 Controlla se il round può continuare
    if (gameState.partecipantiInAttesa.length === 0) {
        console.log('✅ TUTTI i partecipanti hanno ottenuto un giocatore - ROUND COMPLETATO');
        terminaRoundCompleto();
        return;
    }

    if (gameState.slotsRimasti.length === 0) {
        console.log('⚠️ NON ci sono più giocatori disponibili - ROUND COMPLETATO');
        terminaRoundCompleto();
        return;
    }

    // 🔄 Reset offerte per nuova asta
    gameState.offerteTemporanee.clear();

    // 🆕 NUOVO: Reset stato bid per tutti i socket connessi
    for (let [socketId, connesso] of gameState.connessi.entries()) {
        if (connesso.tipo === 'partecipante' && gameState.partecipantiInAttesa.includes(connesso.partecipanteId)) {
            // Reset stato offerta per questo socket
            io.to(socketId).emit('reset_bid_state', {
                round: gameState.roundAttivo,
                astaNumero: gameState.astaCorrente,
                message: `Preparazione Asta ${gameState.astaCorrente}`
            });
        }
    }

    // 📤 Invia stato asta ai client
    io.emit('asta_started', {
        round: gameState.roundAttivo,
        astaNumero: gameState.astaCorrente,
        slots: gameState.slotsRimasti,
        partecipantiInAttesa: gameState.partecipantiInAttesa,
        sistema: 'multi-asta',
        slotsDisponibili: gameState.slotsRimasti.map(s => s.id) // NUOVO: Lista ID slots disponibili
    });

    // 🔍 Avvia monitoraggio per questa asta
    avviaMonitoraggioOfferte();
}

// 🆕 NUOVA FUNZIONE: Termina round completo
function terminaRoundCompleto() {
    console.log(`\n🏁 === ROUND ${gameState.roundAttivo} COMPLETATO ===`);

    gameState.asteAttive = false;
    const roundCompletato = gameState.roundAttivo;
    gameState.roundAttivo = null;
    gameState.astaCorrente = 1;
    gameState.partecipantiAssegnati.clear();
    gameState.slotsRimasti = [];
    gameState.partecipantiInAttesa = [];
    gameState.offerteTemporanee.clear();

    // 📤 Notifica fine round
    io.emit('round_ended', {
        round: roundCompletato,
        completato: true,
        message: `Round ${roundCompletato} completato con tutte le aste`
    });

    console.log(`✅ Round ${roundCompletato} terminato definitivamente`);
}

// Notifiche Push
async function inviaNotifichePush(notificationData) {
    try {
        const { title, body, url, targetUsers } = notificationData;
        console.log('📨 INVIO NOTIFICHE PUSH:', { title, body, targetUsers });

        // 1. NOTIFICHE AI CLIENT CONNESSI (tramite WebSocket) - SEMPRE FUNZIONA
        let notificheTramiteSocket = 0;
        for (let [socketId, connesso] of gameState.connessi.entries()) {
            if (connesso.tipo === 'partecipante' &&
                (!targetUsers || targetUsers.includes(connesso.partecipanteId))) {

                console.log(`📨 Invio notifica WebSocket a: ${connesso.nome}`);
                io.to(socketId).emit('show_notification', {
                    title: title,
                    body: body,
                    url: url || '/'
                });
                notificheTramiteSocket++;
            }
        }

        // 2. PUSH NOTIFICATIONS - Solo se configurate correttamente
        let pushInviate = 0;
        let pushFallite = 0;
        let subscriptions = [];

        if (!webPushConfigured) {
            console.log('⚠️ Web Push non configurato - saltando notifiche push');
            return {
                success: true,
                websocket: notificheTramiteSocket,
                push_sent: 0,
                push_failed: 0,
                push_disabled: true,
                message: 'Notifiche WebSocket inviate, Push non configurato'
            };
        }

        // Cerca subscription nel database - SOLO per sessione corrente
        try {
            let query, params;
            if (targetUsers && targetUsers.length > 0) {
                const placeholders = targetUsers.map((_, i) => `$${i + 2}`).join(',');
                query = `SELECT * FROM push_subscriptions 
            WHERE partecipante_id IN (${placeholders}) 
            AND partecipante_id IN (
                SELECT id FROM partecipanti_fantagts 
                WHERE sessione_id = $1 AND attivo = true
            ) AND attiva = true`;
                params = [sessioneCorrente, ...targetUsers];
            } else {
                query = `SELECT * FROM push_subscriptions 
            WHERE partecipante_id IN (
                SELECT id FROM partecipanti_fantagts 
                WHERE sessione_id = $1 AND attivo = true
            ) AND attiva = true`;
                params = [sessioneCorrente];
            }

            const result = await db.query(query, params);
            subscriptions = result.rows;
            console.log(`📱 SUBSCRIPTION TROVATE: ${subscriptions.length}`);
        } catch (dbError) {
            console.error('❌ ERRORE QUERY SUBSCRIPTIONS:', dbError);
            return {
                success: true,
                websocket: notificheTramiteSocket,
                error: 'Errore database subscriptions, WebSocket inviati'
            };
        }

        // Invia notifiche push con gestione errori migliorata
        const payload = JSON.stringify({
            title: `🎾 ${title}`, // AGGIUNTO: emoji per visibilità
            body: `⚡ ${body}`, // AGGIUNTO: emoji per urgenza
            icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E',
            badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E',
            image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"%3E%3Crect width="200" height="100" fill="%234299e1"/%3E%3Ctext x="100" y="60" font-size="40" text-anchor="middle" fill="white"%3E🎾 ASTA!%3C/text%3E%3C/svg%3E', // AGGIUNTO: immagine grande per lockscreen
            vibrate: [300, 200, 300, 200, 300, 200, 300], // POTENZIATO: vibrazione più lunga e forte
            requireInteraction: true, // CAMBIATO: torna true per persistenza
            tag: 'fantagts-urgent',
            renotify: true,
            silent: false,
            timestamp: Date.now(),
            // AGGIUNTO: configurazioni specifiche per dispositivi
            android: {
                channelId: 'fantagts_urgent',
                priority: 'high',
                category: 'alarm', // IMPORTANTE: categoria alarm per maggiore visibilità
                visibility: 'public',
                showWhen: true,
                when: Date.now(),
                color: '#4299e1',
                lights: [300, 1000, 300, 1000], // LED lampeggiante
                sound: 'default'
            },
            data: {
                url: url || '/',
                timestamp: Date.now(),
                action: 'open_app',
                urgent: true,
                lockscreen: true, // Flag per gestione lockscreen
                wakeup: true // Flag per tentativo risveglio
            },
            actions: [
                {
                    action: 'open',
                    title: '🚀 Apri FantaGTS',
                    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E'
                },
                {
                    action: 'remind',
                    title: '⏰ Ricorda tra 1 min'
                }
            ]
        });

        for (const subscription of subscriptions) {
            try {
                const pushSubscription = {
                    endpoint: subscription.endpoint,
                    keys: {
                        p256dh: subscription.p256dh_key,
                        auth: subscription.auth_key
                    }
                };

                console.log(`🚀 Tentativo push MIGLIORATO a: ${subscription.partecipante_id}`);

                await webpush.sendNotification(pushSubscription, payload, {
                    TTL: 300, // CAMBIATO: 5 minuti (più urgente)
                    urgency: 'high',
                    topic: `fantagts-${Date.now()}`, // CAMBIATO: topic unico per evitare grouping
                    headers: {
                        'Apns-Push-Type': 'alert', // Per iOS
                        'Apns-Priority': '10', // Massima priorità iOS
                        'FCM_OPTIONS': JSON.stringify({
                            'analytics_label': 'urgent_notification'
                        })
                    }
                });

                pushInviate++;
                console.log(`✅ Push MIGLIORATA inviata a: ${subscription.partecipante_id}`);

                // Aggiorna last_seen
                await db.query("UPDATE push_subscriptions SET last_seen = CURRENT_TIMESTAMP WHERE id = $1", [subscription.id]);

            } catch (pushError) {
                console.error(`❌ Errore push per ${subscription.partecipante_id}:`, {
                    statusCode: pushError.statusCode,
                    message: pushError.body || pushError.message,
                    endpoint: subscription.endpoint.substring(0, 50) + '...'
                });
                pushFallite++;

                // Gestione errori specifici
                if (pushError.statusCode === 410 || pushError.statusCode === 404) {
                    console.log(`🗑️ Disattivando subscription scaduta per: ${subscription.partecipante_id}`);
                    await db.query("UPDATE push_subscriptions SET attiva = false WHERE id = $1", [subscription.id]);
                } else if (pushError.statusCode === 403) {
                    console.log(`🔐 Errore autorizzazione push per: ${subscription.partecipante_id} - possibili chiavi VAPID non valide`);
                }
            }
        }

        console.log(`✅ NOTIFICHE COMPLETATE: ${notificheTramiteSocket} WebSocket + ${pushInviate} Push (${pushFallite} fallite)`);

        return {
            success: true,
            websocket: notificheTramiteSocket,
            push_sent: pushInviate,
            push_failed: pushFallite,
            total_subscriptions: subscriptions.length,
            webpush_configured: webPushConfigured
        };

    } catch (error) {
        console.error('❌ ERRORE GENERALE NOTIFICHE:', error);
        return { success: false, error: error.message };
    }
}

// Routes API

// Setup squadre circolo
app.get('/api/squadre', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM squadre_circolo ORDER BY numero");
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/squadre-complete', async (req, res) => {
    try {
        const squadreResult = await db.query("SELECT * FROM squadre_circolo WHERE attiva = true ORDER BY numero");
        const squadre = squadreResult.rows;

        for (const squadra of squadre) {
            try {
                const result = await db.query("SELECT COUNT(*) as slots_count FROM slots WHERE squadra_numero = $1", [squadra.numero]);
                squadra.slots_generati = result.rows[0].slots_count;
            } catch (err) {
                squadra.slots_generati = 0;
            }
        }

        res.json(squadre);
    } catch (err) {
        console.error('Errore API squadre-complete:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/squadre', async (req, res) => {
    try {
        const { numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3 } = req.body;

        await db.query(`INSERT INTO squadre_circolo 
            (numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (numero) DO UPDATE SET
            colore = $2, m1 = $3, m2 = $4, m3 = $5, m4 = $6, m5 = $7, m6 = $8, m7 = $9, f1 = $10, f2 = $11, f3 = $12`,
            [numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3]);

        res.json({ message: 'Squadra salvata con successo' });
    } catch (err) {
        console.error('Errore POST squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/squadre/:numero', async (req, res) => {
    try {
        await db.query("DELETE FROM squadre_circolo WHERE numero = $1", [req.params.numero]);
        res.json({ message: 'Squadra eliminata con successo' });
    } catch (err) {
        console.error('Errore DELETE squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

// Setup partecipanti
app.get('/api/partecipanti', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT * FROM partecipanti_fantagts 
            WHERE attivo = true AND sessione_id = $1 
            ORDER BY nome
        `, [sessioneCorrente]);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API partecipanti:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partecipanti', async (req, res) => {
    try {
        const { nome, crediti = 2000 } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'Nome richiesto' });
        }

        const nomeClean = nome.trim();

        // CONTROLLO DUPLICATI RAFFORZATO
        const duplicateCheck = await db.query(`
            SELECT id, nome, sessione_id FROM partecipanti_fantagts 
            WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) AND attivo = true
        `, [nomeClean]);

        if (duplicateCheck.rows.length > 0) {
            const existing = duplicateCheck.rows[0];
            if (existing.sessione_id === sessioneCorrente) {
                return res.status(409).json({
                    error: `Il nome "${nomeClean}" è già registrato in questa sessione`,
                    action: 'login_required'
                });
            } else {
                return res.status(409).json({
                    error: `Il nome "${nomeClean}" è già utilizzato in un'altra sessione`,
                    action: 'name_change_required',
                    suggestions: [`${nomeClean}2`, `${nomeClean}_2025`]
                });
            }
        }

        const id = nomeClean.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

        await db.query(`INSERT INTO partecipanti_fantagts 
            (id, nome, crediti, sessione_id) VALUES ($1, $2, $3, $4)`,
            [id, nomeClean, crediti, sessioneCorrente]);

        console.log(`✅ Nuovo partecipante registrato: ${nomeClean} (ID: ${id})`);

        res.json({
            id: id,
            message: 'Partecipante registrato con successo',
            nome: nomeClean,
            crediti: crediti
        });
    } catch (err) {
        console.error('Errore POST partecipanti:', err);
        if (err.code === '23505') { // PostgreSQL unique violation
            res.status(409).json({ error: 'Nome già in uso, scegli un nome diverso' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});
// API per creare nuova sessione
app.post('/api/nuova-sessione', async (req, res) => {
    try {
        const { anno, descrizione } = req.body;
        const nuovoId = `fantagts_${anno}`;

        // Disattiva sessione corrente
        await db.query("UPDATE sessioni_fantagts SET attiva = false WHERE attiva = true");

        // Crea nuova sessione
        await db.query(`INSERT INTO sessioni_fantagts (id, nome, anno, descrizione, attiva) 
            VALUES ($1, $2, $3, $4, true)`, [nuovoId, `FantaGTS ${anno}`, anno, descrizione]);

        // Aggiorna sessione corrente
        sessioneCorrente = nuovoId;

        res.json({
            message: 'Nuova sessione creata',
            sessioneId: nuovoId,
            redirectTo: '/setup'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/partecipanti/:id', async (req, res) => {
    try {
        const partecipanteId = req.params.id;

        // ELIMINAZIONE COMPLETA E SICURA
        await db.query('BEGIN');

        // 1. Elimina push subscriptions
        await db.query("DELETE FROM push_subscriptions WHERE partecipante_id = $1", [partecipanteId]);

        // 2. Elimina aste
        await db.query("DELETE FROM aste WHERE partecipante_id = $1", [partecipanteId]);

        // 3. Elimina il partecipante
        const result = await db.query("DELETE FROM partecipanti_fantagts WHERE id = $1", [partecipanteId]);

        await db.query('COMMIT');

        if (result.rowCount > 0) {
            console.log(`🗑️ Partecipante eliminato completamente: ${partecipanteId}`);
            res.json({ message: 'Partecipante eliminato con successo', deleted: true });
        } else {
            res.status(404).json({ error: 'Partecipante non trovato' });
        }

    } catch (err) {
        await db.query('ROLLBACK');
        console.error('Errore DELETE partecipanti:', err);
        res.status(500).json({ error: err.message });
    }
});

// Generazione slots
app.post('/api/genera-slots', async (req, res) => {
    try {
        const result = await generaSlots();
        res.json({ message: 'Slots generati con successo', count: result });
    } catch (err) {
        console.error('Errore genera-slots:', err);
        res.status(500).json({ error: err.message });
    }
});

// Stato del gioco
app.get('/api/stato', (req, res) => {
    res.json({
        fase: gameState.fase,
        roundAttivo: gameState.roundAttivo,
        asteAttive: gameState.asteAttive,
        connessi: Array.from(gameState.connessi.values())
    });
});

// API per info slot
app.get('/api/slot-info/:slotId', async (req, res) => {
    try {
        const slotId = req.params.slotId;
        const result = await db.query("SELECT * FROM slots WHERE id = $1", [slotId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Slot non trovato' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Errore slot-info:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni squadra di un partecipante
app.get('/api/squadra-partecipante/:partecipanteId', async (req, res) => {
    try {
        const partecipanteId = req.params.partecipanteId;

        // Ottieni squadra
        const squadraResult = await db.query(`SELECT 
            a.slot_id,
            a.costo_finale,
            s.posizione,
            s.giocatore_attuale,
            s.colore,
            s.punti_totali
            FROM aste a 
            JOIN slots s ON a.slot_id = s.id 
            WHERE a.partecipante_id = $1 AND a.vincitore = true 
            ORDER BY s.posizione`, [partecipanteId]);

        // Ottieni crediti aggiornati
        const creditiResult = await db.query(`SELECT crediti FROM partecipanti_fantagts WHERE id = $1`, [partecipanteId]);

        res.json({
            squadra: squadraResult.rows,
            crediti: creditiResult.rows[0]?.crediti || 2000
        });
    } catch (err) {
        console.error('Errore squadra-partecipante:', err);
        res.status(500).json({ error: err.message });
    }
});

// Controllo aste
app.post('/api/avvia-round/:round', async (req, res) => {
    const round = req.params.round;

    if (gameState.asteAttive) {
        return res.status(400).json({ error: 'Un round è già attivo' });
    }

    try {
        // 🔍 Ottieni tutti i partecipanti dal database
        const partecipantiResult = await db.query(`
            SELECT id, nome FROM partecipanti_fantagts 
            WHERE attivo = true AND sessione_id = $1
        `, [sessioneCorrente]);

        // 🔍 Ottieni tutti i slots disponibili per questo round
        const slotsResult = await db.query(
            "SELECT * FROM slots WHERE posizione = $1 AND attivo = true ORDER BY squadra_numero",
            [round]
        );

        const tuttiPartecipanti = partecipantiResult.rows;
        const tuttiSlots = slotsResult.rows;

        console.log(`🎯 AVVIO ROUND ${round}:`);
        console.log(`   👥 Partecipanti: ${tuttiPartecipanti.length}`);
        console.log(`   🎪 Slots disponibili: ${tuttiSlots.length}`);
        console.log(`   📋 Giocatori: ${tuttiSlots.map(s => s.giocatore_attuale).join(', ')}`);

        if (tuttiSlots.length === 0) {
            return res.status(400).json({ error: `Nessuno slot disponibile per ${round}` });
        }

        if (tuttiPartecipanti.length === 0) {
            return res.status(400).json({ error: 'Nessun partecipante registrato' });
        }

        // 🆕 INIZIALIZZA STATO MULTI-ASTA
        gameState.roundAttivo = round;
        gameState.asteAttive = true;
        gameState.astaCorrente = 1;
        gameState.partecipantiAssegnati.clear();
        gameState.slotsRimasti = [...tuttiSlots]; // Copia array
        gameState.partecipantiInAttesa = tuttiPartecipanti.map(p => p.id);
        gameState.offerteTemporanee.clear();

        // 🚀 AVVIA PRIMA ASTA
        avviaAstaSuccessiva();

        // 📨 NOTIFICHE A TUTTI
        try {
            const partecipantiIds = tuttiPartecipanti.map(p => p.id);
            await inviaNotifichePush({
                title: `FantaGTS - Round ${round}`,
                body: `È iniziato il round ${round}! Fai la tua offerta!`,
                url: '/',
                targetUsers: partecipantiIds
            });
        } catch (error) {
            console.error('❌ ERRORE INVIO NOTIFICHE:', error);
        }

        res.json({ message: `Round ${round} avviato con successo` });

    } catch (err) {
        console.error('Errore avvia-round:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per controllare se tutti hanno fatto offerte - VERSIONE CORRETTA
app.get('/api/stato-offerte/:round', async (req, res) => {
    const round = req.params.round;

    try {
        // 🔍 Ottieni TUTTI i partecipanti dal database
        const partecipantiResult = await db.query(`
            SELECT id, nome FROM partecipanti_fantagts 
            WHERE attivo = true AND sessione_id = $1
        `, [sessioneCorrente]);

        const tuttiPartecipanti = partecipantiResult.rows;
        const totalePartecipanti = tuttiPartecipanti.length;

        // Conta chi ha fatto offerte
        const partecipantiCheHannoOfferto = new Set();
        gameState.offerteTemporanee.forEach((offerta, socketId) => {
            const connesso = gameState.connessi.get(socketId);
            if (connesso && connesso.partecipanteId && offerta.round === round) {
                partecipantiCheHannoOfferto.add(connesso.partecipanteId);
            }
        });

        const offerteRicevute = partecipantiCheHannoOfferto.size;
        const tuttiHannoOfferto = offerteRicevute >= totalePartecipanti;

        res.json({
            partecipantiTotali: totalePartecipanti,
            partecipantiConnessi: Array.from(gameState.connessi.values()).filter(p => p.tipo === 'partecipante').length,
            offerteRicevute: offerteRicevute,
            mancano: Math.max(0, totalePartecipanti - offerteRicevute),
            tuttiHannoOfferto: tuttiHannoOfferto,
            dettaglioOfferte: Array.from(gameState.offerteTemporanee.entries()).map(([socketId, offerta]) => ({
                partecipante: gameState.connessi.get(socketId)?.nome || 'Sconosciuto',
                partecipanteId: gameState.connessi.get(socketId)?.partecipanteId || null,
                offerta: offerta
            }))
        });
    } catch (error) {
        console.error('Errore API stato-offerte:', error);
        res.status(500).json({ error: error.message });
    }
});

// API per risultati partite
app.get('/api/risultati-partite', async (req, res) => {
    try {
        const result = await db.query(`SELECT r.*, 
                    s1.colore as squadra_1_colore, s2.colore as squadra_2_colore
                    FROM risultati_partite r 
                    LEFT JOIN squadre_circolo s1 ON r.squadra_1 = s1.numero 
                    LEFT JOIN squadre_circolo s2 ON r.squadra_2 = s2.numero 
                    ORDER BY r.turno DESC, r.timestamp DESC`);

        // Parse JSON vincitori
        const rows = result.rows.map(row => {
            try {
                row.vincitori = JSON.parse(row.vincitori || '[]');
            } catch (e) {
                row.vincitori = [];
            }
            return row;
        });

        res.json(rows);
    } catch (err) {
        console.error('Errore API risultati-partite:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni risultati aste per round specifico
app.get('/api/aste-round/:round', async (req, res) => {
    try {
        const round = req.params.round;

        const result = await db.query(`SELECT a.*, p.nome as partecipante_nome, s.giocatore_attuale, s.colore 
                FROM aste a 
                JOIN partecipanti_fantagts p ON a.partecipante_id = p.id 
                JOIN slots s ON a.slot_id = s.id 
                WHERE a.round = $1 AND a.vincitore = true 
                ORDER BY a.costo_finale DESC`, [round]);

        res.json(result.rows);
    } catch (err) {
        console.error('Errore aste-round:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni classifica generale
app.get('/api/classifica', async (req, res) => {
    try {
        const result = await db.query(`SELECT 
            p.id, p.nome, p.crediti, 
            COUNT(a.id) as giocatori_totali,
            COALESCE(SUM(s.punti_totali), 0) as punti_totali,
            COALESCE(SUM(a.costo_finale), 0) as crediti_spesi
            FROM partecipanti_fantagts p 
            LEFT JOIN aste a ON p.id = a.partecipante_id AND a.vincitore = true
            LEFT JOIN slots s ON a.slot_id = s.id 
            GROUP BY p.id, p.nome, p.crediti 
            ORDER BY punti_totali DESC, crediti_spesi ASC`);

        // Aggiungi posizione in classifica
        const classifica = result.rows.map((row, index) => {
            row.posizione = index + 1;
            return row;
        });

        console.log('✅ Classifica caricata:', classifica.length, 'partecipanti');
        res.json(classifica);
    } catch (err) {
        console.error('Errore classifica:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per info sessione
app.get('/api/sessione-info', (req, res) => {
    res.json({
        sessione_anno: new Date().getFullYear(),
        sessione_descrizione: `FantaGTS ${new Date().getFullYear()}`,
        sessione_data_inizio: new Date().toISOString()
    });
});

// Debug routes
app.get('/api/debug/subscriptions', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM push_subscriptions");
        console.log('🔍 SUBSCRIPTION NEL DB:', result.rows);
        res.json({
            count: result.rows.length,
            subscriptions: result.rows
        });
    } catch (err) {
        console.error('❌ Errore query subscriptions:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/debug/partecipanti', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                id, 
                nome, 
                crediti, 
                sessione_id,
                attivo,
                created_at,
                (SELECT COUNT(*) FROM aste WHERE partecipante_id = p.id AND vincitore = true) as giocatori_vinti,
                (SELECT COUNT(*) FROM push_subscriptions WHERE partecipante_id = p.id AND attiva = true) as subscriptions_attive
            FROM partecipanti_fantagts p 
            ORDER BY created_at DESC
        `);

        console.log('🔍 PARTECIPANTI NEL DATABASE:', result.rows);

        res.json({
            count: result.rows.length,
            sessione_corrente: sessioneCorrente,
            partecipanti: result.rows.map(p => ({
                id: p.id,
                nome: p.nome,
                crediti: p.crediti,
                sessione: p.sessione_id,
                attivo: p.attivo,
                registrato_il: p.created_at,
                giocatori_vinti: parseInt(p.giocatori_vinti),
                notifiche_attive: parseInt(p.subscriptions_attive)
            }))
        });
    } catch (err) {
        console.error('❌ Errore query partecipanti:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/debug/slots', async (req, res) => {
    try {
        const sampleResult = await db.query("SELECT * FROM slots LIMIT 10");
        const countResult = await db.query("SELECT COUNT(*) as total FROM slots");
        console.log('🔍 SLOTS NEL DB:', { count: countResult.rows[0].total, sample: sampleResult.rows });
        res.json({
            total: parseInt(countResult.rows[0].total),
            sample: sampleResult.rows
        });
    } catch (err) {
        console.error('❌ Errore query slots:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per chiave pubblica VAPID
app.get('/api/vapid-public-key', (req, res) => {
    if (!webPushConfigured) {
        return res.status(503).json({
            error: 'Web Push non configurato',
            fallback: true
        });
    }

    try {
        // Se hai le chiavi da ambiente
        if (process.env.VAPID_PUBLIC_KEY) {
            return res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
        }

        // Altrimenti usa le chiavi correnti
        res.json({
            publicKey: currentVapidKeys.publicKey,
            temporary: true,
            message: 'Chiave temporanea generata - configura VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API debug per pulire subscription
app.get('/api/clean-subscriptions', async (req, res) => {
    try {
        // Elimina tutte le subscription esistenti
        const result = await db.query("DELETE FROM push_subscriptions");

        console.log('🧹 Tutte le subscription eliminate');

        res.json({
            message: 'Subscription pulite',
            deleted: result.rowCount,
            newPublicKey: currentVapidKeys?.publicKey || 'Non disponibile'
        });
    } catch (error) {
        console.error('❌ Errore pulizia subscription:', error);
        res.status(500).json({ error: error.message });
    }
});

// API per resettare subscription push
app.post('/api/reset-push-subscriptions', async (req, res) => {
    try {
        // Disattiva tutte le subscription esistenti
        await db.query("UPDATE push_subscriptions SET attiva = false");

        // Oppure cancellale completamente
        await db.query("DELETE FROM push_subscriptions");

        console.log('🗑️ Tutte le subscription push sono state resettate');

        res.json({
            success: true,
            message: 'Subscription push resettate',
            newPublicKey: currentVapidKeys?.publicKey || null
        });
    } catch (error) {
        console.error('❌ Errore reset subscription:', error);
        res.status(500).json({ error: error.message });
    }
});

// API per verificare se un giocatore esiste - VERSIONE MIGLIORATA
app.post('/api/check-player', async (req, res) => {
    try {
        const { nome } = req.body;

        if (!nome) {
            return res.status(400).json({ error: 'Nome richiesto' });
        }

        // NUOVO: Controlla duplicati anche in sessioni diverse
        const allSessionsResult = await db.query(`
            SELECT id, nome, crediti, sessione_id, created_at 
            FROM partecipanti_fantagts 
            WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) AND attivo = true
        `, [nome]);

        // Controlla nella sessione corrente
        const currentSessionResult = await db.query(`
            SELECT id, nome, crediti, created_at 
            FROM partecipanti_fantagts 
            WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) AND attivo = true AND sessione_id = $2
        `, [nome, sessioneCorrente]);

        if (currentSessionResult.rows.length > 0) {
            // Esiste nella sessione corrente
            const player = currentSessionResult.rows[0];
            console.log(`✅ Giocatore esistente nella sessione corrente: ${player.nome} (ID: ${player.id})`);

            res.json({
                exists: true,
                inCurrentSession: true,
                player: {
                    id: player.id,
                    nome: player.nome,
                    crediti: player.crediti,
                    registered_at: player.created_at
                }
            });
        } else if (allSessionsResult.rows.length > 0) {
            // Esiste in altre sessioni - nome occupato
            console.log(`❌ Nome già utilizzato in altra sessione: ${nome}`);
            res.json({
                exists: false,
                nameOccupied: true,
                message: `Il nome "${nome}" è già utilizzato in un'altra sessione. Scegli un nome diverso.`,
                suggestions: [
                    `${nome}2`,
                    `${nome}_2025`,
                    `${nome.toLowerCase()}`,
                    `${nome.toUpperCase()}`
                ]
            });
        } else {
            // Nome disponibile
            console.log(`✅ Nome disponibile: ${nome}`);
            res.json({
                exists: false,
                nameAvailable: true,
                message: 'Nome disponibile per registrazione'
            });
        }
    } catch (err) {
        console.error('Errore API check-player:', err);
        res.status(500).json({ error: err.message });
    }
});
// API debug per subscription
app.get('/api/debug-subscriptions', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM push_subscriptions ORDER BY created_at DESC");

        console.log('🔍 SUBSCRIPTION NEL DB:', result.rows);

        res.json({
            count: result.rows.length,
            active: result.rows.filter(s => s.attiva).length,
            current_vapid_key: currentVapidKeys?.publicKey?.substring(0, 30) + '...' || 'Non configurato',
            subscriptions: result.rows.map(sub => ({
                id: sub.id,
                partecipante_id: sub.partecipante_id,
                created_at: sub.created_at,
                last_seen: sub.last_seen,
                attiva: sub.attiva,
                endpoint_preview: sub.endpoint?.substring(0, 50) + '...' || 'N/A'
            }))
        });
    } catch (err) {
        console.error('❌ Errore query subscriptions:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per ottenere slots di un round specifico
app.get('/api/slots-round/:round', async (req, res) => {
    try {
        const round = req.params.round;
        const result = await db.query("SELECT * FROM slots WHERE posizione = $1 AND attivo = true ORDER BY squadra_numero", [round]);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API slots-round:', err);
        res.status(500).json({ error: err.message });
    }
});

// Push notifications
app.post('/api/subscribe-notifications', async (req, res) => {
    try {
        const { subscription, partecipanteId } = req.body;
        console.log('📨 RICEVUTA SUBSCRIPTION:', { subscription, partecipanteId });

        if (!subscription || !partecipanteId) {
            return res.status(400).json({ error: 'Subscription e partecipanteId richiesti' });
        }

        const endpoint = subscription.endpoint;
        const keys = subscription.keys;
        const userAgent = req.headers['user-agent'] || '';

        if (!keys || !keys.p256dh || !keys.auth) {
            return res.status(400).json({ error: 'Chiavi subscription mancanti' });
        }

        console.log('💾 SALVANDO NEL DB:', {
            partecipanteId,
            endpoint: endpoint.substring(0, 50) + '...',
            p256dh: keys.p256dh.substring(0, 20) + '...',
            auth: keys.auth.substring(0, 20) + '...'
        });

        // NUOVO: Prima elimina tutte le subscription esistenti per questo partecipante
        await db.query('DELETE FROM push_subscriptions WHERE partecipante_id = $1', [partecipanteId]);
        console.log(`🗑️ Rimosse subscription esistenti per: ${partecipanteId}`);

        // Poi inserisci la nuova subscription
        await db.query(`INSERT INTO push_subscriptions 
            (partecipante_id, endpoint, p256dh_key, auth_key, user_agent, last_seen, attiva) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, true)`,
            [partecipanteId, endpoint, keys.p256dh, keys.auth, userAgent]);

        console.log('✅ SUBSCRIPTION SALVATA (unica per utente)');

        // Verifica salvataggio
        const savedResult = await db.query("SELECT COUNT(*) as count FROM push_subscriptions WHERE partecipante_id = $1", [partecipanteId]);
        console.log('🔍 VERIFICA SALVATAGGIO:', savedResult.rows[0]);

        res.json({
            success: true,
            message: 'Notifiche attivate con successo',
            saved: savedResult.rows[0].count
        });
    } catch (error) {
        console.error('❌ ERRORE SALVATAGGIO SUBSCRIPTION:', error);
        res.status(500).json({ error: error.message });
    }
});

// Monitoraggio automatico offerte - VERSIONE CORRETTA
function avviaMonitoraggioOfferte() {
    const monitorInterval = setInterval(async () => {
        if (!gameState.asteAttive) {
            clearInterval(monitorInterval);
            return;
        }

        try {
            // 🔍 NUOVO: Ottieni TUTTI i partecipanti dal database
            const partecipantiResult = await db.query(`
                SELECT id, nome FROM partecipanti_fantagts 
                WHERE attivo = true AND sessione_id = $1
            `, [sessioneCorrente]);

            const tuttiPartecipanti = partecipantiResult.rows;
            const totalePartecipanti = tuttiPartecipanti.length;

            if (totalePartecipanti === 0) {
                console.log('⚠️ Nessun partecipante registrato nel database');
                return;
            }

            // 🔍 Conta le offerte ricevute per questo round
            const offerteRound = Array.from(gameState.offerteTemporanee.values())
                .filter(o => o.round === gameState.roundAttivo);

            const partecipantiCheHannoOfferto = new Set();

            // Identifica CHI ha fatto offerte
            gameState.offerteTemporanee.forEach((offerta, socketId) => {
                const connesso = gameState.connessi.get(socketId);
                if (connesso && connesso.partecipanteId && offerta.round === gameState.roundAttivo) {
                    partecipantiCheHannoOfferto.add(connesso.partecipanteId);
                }
            });

            const offerteRicevute = partecipantiCheHannoOfferto.size;
            const mancano = totalePartecipanti - offerteRicevute;
            const tuttiHannoOfferto = offerteRicevute >= totalePartecipanti;

            // 📊 Log ridotto - solo ogni 10 secondi o quando cambia stato
            const currentTime = Date.now();
            const shouldLog = !gameState.lastMonitorLog ||
                (currentTime - gameState.lastMonitorLog) > 10000 || // Ogni 10 secondi
                gameState.lastOfferteCount !== offerteRicevute; // O quando cambiano le offerte

            if (shouldLog) {
                console.log(`📊 ROUND ${gameState.roundAttivo}: ${offerteRicevute}/${totalePartecipanti} offerte ricevute`);

                // Solo se mancano offerte, mostra chi aspettiamo
                if (mancano > 0) {
                    const nonHannoOfferto = tuttiPartecipanti
                        .filter(p => !partecipantiCheHannoOfferto.has(p.id))
                        .map(p => p.nome);
                    console.log(`   ⏳ Aspettando: ${nonHannoOfferto.join(', ')}`);
                }

                // Aggiorna stato per prossimo log
                gameState.lastMonitorLog = currentTime;
                gameState.lastOfferteCount = offerteRicevute;
            }

            // Lista completa per elaborazione (mantieni questa parte)
            const hannoOfferto = Array.from(partecipantiCheHannoOfferto);
            const nonHannoOfferto = tuttiPartecipanti
                .filter(p => !partecipantiCheHannoOfferto.has(p.id))
                .map(p => p.nome);

            const statoOfferte = {
                partecipantiTotali: totalePartecipanti,
                partecipantiConnessi: Array.from(gameState.connessi.values()).filter(p => p.tipo === 'partecipante').length,
                offerteRicevute: offerteRicevute,
                mancano: mancano,
                tuttiHannoOfferto: tuttiHannoOfferto,
                hannoOfferto: hannoOfferto,
                nonHannoOfferto: nonHannoOfferto,
                dettaglioOfferte: Array.from(gameState.offerteTemporanee.entries()).map(([socketId, offerta]) => ({
                    partecipante: gameState.connessi.get(socketId)?.nome || 'Sconosciuto',
                    offerta: offerta
                }))
            };

            // 📤 Invia aggiornamento a tutti i client
            io.emit('offerte_update', statoOfferte);

            // 🏁 CHIUDI ASTA solo se TUTTI i partecipanti IN ATTESA hanno offerto
            const partecipantiInAttesaCheHannoOfferto = new Set();
            gameState.offerteTemporanee.forEach((offerta, socketId) => {
                const connesso = gameState.connessi.get(socketId);
                if (connesso && connesso.partecipanteId && offerta.round === gameState.roundAttivo) {
                    if (gameState.partecipantiInAttesa.includes(connesso.partecipanteId)) {
                        partecipantiInAttesaCheHannoOfferto.add(connesso.partecipanteId);
                    }
                }
            });

            const tuttiInAttesaHannoOfferto = partecipantiInAttesaCheHannoOfferto.size >= gameState.partecipantiInAttesa.length;

            if (tuttiInAttesaHannoOfferto && gameState.partecipantiInAttesa.length > 0) {
                console.log(`🎉 TUTTI i ${gameState.partecipantiInAttesa.length} partecipanti in attesa hanno fatto offerte - chiusura asta`);
                clearInterval(monitorInterval);

                if (gameState.asteAttive) {
                    console.log('🔄 Avviando elaborazione risultati asta...');
                    terminaRound();
                }
            }

        } catch (error) {
            console.error('❌ Errore monitoraggio offerte:', error);
        }
    }, 1000); // Controlla ogni secondo
}

// API per forzare fine round
app.post('/api/forza-fine-round', (req, res) => {
    if (!gameState.asteAttive) {
        return res.status(400).json({ error: 'Nessun round attivo' });
    }

    terminaRound();
    res.json({ message: 'Round terminato forzatamente' });
});

// API per test notifiche push
app.post('/api/test-notification/:partecipanteId', async (req, res) => {
    try {
        const partecipanteId = req.params.partecipanteId;
        const { title, body } = req.body;

        console.log(`🧪 TEST NOTIFICA per: ${partecipanteId}`);

        const result = await inviaNotifichePush({
            title: title || 'Test FantaGTS',
            body: body || 'Questa è una notifica di test dal Master!',
            url: '/',
            targetUsers: [partecipanteId]
        });

        res.json({
            success: true,
            result: result,
            message: 'Notifica di test inviata'
        });

    } catch (error) {
        console.error('❌ Errore test notifica:', error);
        res.status(500).json({ error: error.message });
    }
});

function terminaRound() {
    if (gameState.asteAttive === false) return;

    gameState.asteAttive = false;
    gameState.gamePhase = 'results';

    elaboraRisultatiAste();
}

// NUOVO: Sistema multi-round per posizione
async function avviaMultiRoundPerPosizione(posizione) {
    console.log(`🎯 Avviando sistema multi-round per posizione: ${posizione}`);

    let roundNumber = 1;
    let partecipantiRimasti = await getPartecipantiAttivi();
    let giocatoriDisponibili = await getSlotsDisponibiliPerPosizione(posizione);

    while (partecipantiRimasti.length > 0 && giocatoriDisponibili.length > 0) {
        console.log(`🔄 Round ${roundNumber} per ${posizione}: ${partecipantiRimasti.length} partecipanti, ${giocatoriDisponibili.length} giocatori`);

        // Avvia round e aspetta TUTTI i partecipanti rimasti
        const risultatiRound = await eseguiRoundCompleto(posizione, roundNumber, partecipantiRimasti, giocatoriDisponibili);

        // Aggiorna partecipanti e giocatori rimasti
        partecipantiRimasti = partecipantiRimasti.filter(p => !risultatiRound.vincitori.includes(p.id));
        giocatoriDisponibili = giocatoriDisponibili.filter(g => !risultatiRound.giocatoriAssegnati.includes(g.id));

        roundNumber++;

        // Pausa tra round
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log(`✅ Posizione ${posizione} completata dopo ${roundNumber - 1} round`);
}

// Funzione per aspettare TUTTI i partecipanti
async function eseguiRoundCompleto(posizione, roundNumber, partecipantiTarget, giocatoriDisponibili) {
    return new Promise((resolve) => {
        const roundId = `${posizione}_R${roundNumber}`;

        gameState.roundAttivo = roundId;
        gameState.asteAttive = true;
        gameState.partecipantiTarget = partecipantiTarget.map(p => p.id);
        gameState.offerteTemporanee.clear();

        // Invia notifiche SOLO ai partecipanti rimasti
        inviaNotifichePush({
            title: `FantaGTS - ${posizione} Round ${roundNumber}`,
            body: `Round ${roundNumber} per posizione ${posizione}!`,
            targetUsers: gameState.partecipantiTarget
        });

        io.emit('round_started', {
            round: roundId,
            slots: giocatoriDisponibili,
            roundNumber: roundNumber,
            posizione: posizione,
            partecipantiTarget: gameState.partecipantiTarget
        });

        // Monitora fino a quando TUTTI i target hanno offerto
        const checkCompleto = setInterval(() => {
            const offerteRicevute = Array.from(gameState.offerteTemporanee.values())
                .filter(o => o.round === roundId).length;

            console.log(`📊 Round ${roundId}: ${offerteRicevute}/${gameState.partecipantiTarget.length} offerte`);

            if (offerteRicevute >= gameState.partecipantiTarget.length) {
                clearInterval(checkCompleto);

                // Elabora risultati
                const risultati = elaboraRisultatiRound(roundId, giocatoriDisponibili);

                gameState.asteAttive = false;
                gameState.roundAttivo = null;

                resolve(risultati);
            }
        }, 1000);
    });
}

function elaboraRisultatiAste() {
    console.log(`\n🔄 === ELABORAZIONE ASTA ${gameState.astaCorrente} ===`);
    console.log(`📊 Offerte temporanee totali: ${gameState.offerteTemporanee.size}`);
    console.log(`👥 Partecipanti in attesa: ${gameState.partecipantiInAttesa.length}`);
    console.log(`🎯 Slots rimasti: ${gameState.slotsRimasti.length}`);

    const offertePerSlot = {};
    const partecipantiCheHannoOfferto = new Set();

    // Debug: mostra tutte le offerte ricevute
    console.log('🔍 TUTTE LE OFFERTE TEMPORANEE:');
    gameState.offerteTemporanee.forEach((offerta, socketId) => {
        const connesso = gameState.connessi.get(socketId);
        console.log(`   Socket ${socketId}: ${connesso?.nome || 'Sconosciuto'} → ${offerta.slot} (${offerta.importo}) - Round: ${offerta.round}`);
    });

    // 📊 Raggruppa offerte per slot
    gameState.offerteTemporanee.forEach((offerta, socketId) => {
        const connesso = gameState.connessi.get(socketId);
        if (connesso && offerta.round === gameState.roundAttivo) {
            // ✅ Solo partecipanti che devono ancora vincere qualcosa
            if (gameState.partecipantiInAttesa.includes(connesso.partecipanteId)) {
                console.log(`📝 Offerta valida: ${connesso.nome} → ${offerta.slot} (${offerta.importo} crediti)`);

                if (!offertePerSlot[offerta.slot]) {
                    offertePerSlot[offerta.slot] = [];
                }
                offertePerSlot[offerta.slot].push({
                    partecipante: connesso.partecipanteId,
                    nome: connesso.nome,
                    offerta: offerta.importo,
                    socketId: socketId
                });
                partecipantiCheHannoOfferto.add(connesso.partecipanteId);
            } else {
                console.log(`⚠️ Offerta ignorata (già assegnato): ${connesso.nome} → ${offerta.slot}`);
            }
        }
    });

    console.log('🎯 Offerte valide per slot:', Object.keys(offertePerSlot).map(slot =>
        `${slot}: ${offertePerSlot[slot].length} offerte`
    ));

    const risultatiAsta = [];

    // 🏆 Elabora vincitori per ogni slot
    Object.keys(offertePerSlot).forEach(slotId => {
        const offerte = offertePerSlot[slotId];

        if (offerte.length > 0) {
            offerte.sort((a, b) => b.offerta - a.offerta);

            const offertaMassima = offerte[0].offerta;
            const offerteVincenti = offerte.filter(o => o.offerta === offertaMassima);

            let vincitore;
            if (offerteVincenti.length === 1) {
                vincitore = offerteVincenti[0];
            } else {
                // Pareggio - sorteggio
                const randomIndex = Math.floor(Math.random() * offerteVincenti.length);
                vincitore = offerteVincenti[randomIndex];
                console.log(`🎲 PAREGGIO su ${slotId}! Estratto: ${vincitore.nome}`);
            }

            risultatiAsta.push({
                partecipante: vincitore.partecipante,
                nome: vincitore.nome,
                slot: slotId,
                offertaOriginale: vincitore.offerta,
                costoFinale: vincitore.offerta,
                premium: 0,
                condiviso: false
            });

            console.log(`🏆 VINCITORE: ${vincitore.nome} vince ${slotId} per ${vincitore.offerta} crediti`);

            // 🔄 Aggiorna stato per prossima asta
            gameState.partecipantiAssegnati.add(vincitore.partecipante);
            gameState.partecipantiInAttesa = gameState.partecipantiInAttesa.filter(p => p !== vincitore.partecipante);
            gameState.slotsRimasti = gameState.slotsRimasti.filter(s => s.id !== slotId);
        }
    });

    console.log(`🎉 Risultati Asta ${gameState.astaCorrente}:`, risultatiAsta.length, 'assegnazioni');

    if (risultatiAsta.length > 0) {
        // 💾 Salva risultati nel database
        salvaRisultatiAsta(gameState.roundAttivo, risultatiAsta);
    }

    // 📊 Mostra stato aggiornato
    console.log(`📊 STATO AGGIORNATO:`);
    console.log(`   ✅ Assegnati: ${Array.from(gameState.partecipantiAssegnati)}`);
    console.log(`   ⏳ In attesa: ${gameState.partecipantiInAttesa}`);
    console.log(`   🎯 Slots rimasti: ${gameState.slotsRimasti.length}`);

    // 🔄 Passa alla prossima asta O termina round
    setTimeout(() => {
        if (gameState.partecipantiInAttesa.length > 0 && gameState.slotsRimasti.length > 0) {
            gameState.astaCorrente++;
            console.log(`\n➡️ PASSAGGIO AD ASTA ${gameState.astaCorrente}`);
            avviaAstaSuccessiva();
        } else {
            terminaRoundCompleto();
        }
    }, 3000); // Pausa di 3 secondi tra aste
}

// 🔄 Rinomina funzione salvataggio
async function salvaRisultatiAsta(round, risultati) {
    if (risultati.length === 0) return;

    try {
        for (const r of risultati) {
            await db.query(`INSERT INTO aste 
                (round, partecipante_id, slot_id, offerta, costo_finale, premium, vincitore, condiviso) 
                VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
                [round, r.partecipante, r.slot, r.offertaOriginale, r.costoFinale, r.premium, r.condiviso]);

            // Aggiorna crediti
            await db.query(`UPDATE partecipanti_fantagts 
                    SET crediti = crediti - $1 
                    WHERE id = $2`, [r.costoFinale, r.partecipante]);

            console.log(`💾 Salvato: ${r.nome} ha vinto ${r.slot} per ${r.costoFinale} crediti`);
        }


        // 📤 Invia aggiornamento parziale
        io.emit('asta_ended', {
            round: round,
            astaNumero: gameState.astaCorrente,
            risultati: risultati,
            continuaRound: gameState.partecipantiInAttesa.length > 0 && gameState.slotsRimasti.length > 0
        });

        aggiornaCreditiPartecipanti();
    } catch (error) {
        console.error('❌ Errore salvataggio asta:', error);
    }
}

async function salvaRisultatiAste(round, risultati) {
    if (risultati.length === 0) {
        console.log('Nessun risultato da salvare per il round', round);
        return;
    }

    try {
        for (const r of risultati) {
            await db.query(`INSERT INTO aste 
                (round, partecipante_id, slot_id, offerta, costo_finale, premium, vincitore, condiviso) 
                VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
                [round, r.partecipante, r.slot, r.offertaOriginale, r.costoFinale, r.premium, r.condiviso]);

            // Aggiorna crediti partecipante
            await db.query(`UPDATE partecipanti_fantagts 
                    SET crediti = crediti - $1 
                    WHERE id = $2`, [r.costoFinale, r.partecipante]);

            console.log(`✅ Salvato: ${r.nome} ha vinto ${r.slot} per ${r.costoFinale} crediti`);
        }

        console.log(`🎉 Round ${round} completato - ${risultati.length} assegnazioni salvate nel database`);

        gameState.roundAttivo = null;
        gameState.asteAttive = false;
        gameState.offerteTemporanee.clear();

        console.log('📤 Invio risultati ai client:', risultati);
        io.emit('round_ended', {
            round: round,
            risultati: risultati,
            success: true
        });

        aggiornaCreditiPartecipanti();

    } catch (error) {
        console.error('❌ Errore salvataggio risultati:', error);
    }
}

async function aggiornaCreditiPartecipanti() {
    try {
        const result = await db.query("SELECT id, nome, crediti FROM partecipanti_fantagts");
        const partecipanti = result.rows;

        partecipanti.forEach(p => {
            for (let [socketId, connesso] of gameState.connessi.entries()) {
                if (connesso.partecipanteId === p.id) {
                    io.to(socketId).emit('crediti_aggiornati', {
                        crediti: p.crediti
                    });
                    break;
                }
            }
        });
    } catch (error) {
        console.error('Errore aggiornamento crediti:', error);
    }
}

// Reset sistema
app.post('/api/reset/:livello', async (req, res) => {
    const livello = req.params.livello;

    try {
        switch (livello) {
            case 'round':
                gameState.asteAttive = false;
                gameState.roundAttivo = null;
                gameState.offerteTemporanee.clear();
                res.json({ message: 'Round resettato' });
                break;

            case 'aste':
                await db.query("DELETE FROM aste");
                await db.query("UPDATE partecipanti_fantagts SET crediti = 2000, punti_totali = 0");
                await db.query("UPDATE slots SET punti_totali = 0");

                gameState.asteAttive = false;
                gameState.roundAttivo = null;
                gameState.offerteTemporanee.clear();
                gameState.fase = 'setup';

                console.log('🔄 Reset aste completato - inviando notifica ai client');

                io.emit('aste_resettate', {
                    message: 'Le aste sono state resettate',
                    creditiRipristinati: 2000,
                    resetCompleto: true
                });

                io.emit('master_reset_ui', {
                    message: 'Reset interfaccia Master',
                    resetRounds: true
                });

                res.json({ message: 'Tutte le aste resettate' });
                break;

            case 'totale':
                await db.query("DELETE FROM aste");
                await db.query("DELETE FROM partecipanti_fantagts");
                await db.query("DELETE FROM squadre_circolo");
                await db.query("DELETE FROM slots");

                gameState = {
                    fase: 'setup',
                    roundAttivo: null,
                    asteAttive: false,
                    connessi: new Map(),
                    offerteTemporanee: new Map()
                };
                res.json({ message: 'Sistema completamente resettato' });
                break;

            default:
                res.status(400).json({ error: 'Livello reset non valido' });
        }
    } catch (error) {
        console.error('Errore reset:', error);
        res.status(500).json({ error: error.message });
    }
});

// API per test notifiche push
app.post('/api/test-notification/:partecipanteId', async (req, res) => {
    try {
        const partecipanteId = req.params.partecipanteId;
        const { title, body } = req.body;

        console.log(`🧪 TEST NOTIFICA per: ${partecipanteId}`);

        const result = await inviaNotifichePush({
            title: title || 'Test FantaGTS',
            body: body || 'Questa è una notifica di test dal Master!',
            url: '/',
            targetUsers: [partecipanteId]
        });

        res.json({
            success: true,
            result: result,
            message: 'Notifica di test inviata'
        });

    } catch (error) {
        console.error('❌ Errore test notifica:', error);
        res.status(500).json({ error: error.message });
    }
});

// PWA Routes
app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/offline', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'offline.html'));
});

// Serve file statici
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/master', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

app.get('/setup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

// Gestione WebSocket
io.on('connection', (socket) => {
    console.log('Nuova connessione:', socket.id);

    socket.on('register', (data) => {
        console.log(`🔌 Tentativo registrazione: ${data.nome} come ${data.tipo} (Socket: ${socket.id})`);

        if (data.tipo === 'partecipante' && data.partecipanteId) {
            // CONTROLLO DUPLICATI: Rimuovi connessioni esistenti dello stesso partecipante
            for (let [existingSocketId, existingUser] of gameState.connessi.entries()) {
                if (existingUser.partecipanteId === data.partecipanteId && existingSocketId !== socket.id) {
                    console.log(`🔄 Rimuovendo connessione duplicata per ${data.nome}: Socket ${existingSocketId}`);
                    gameState.connessi.delete(existingSocketId);
                    // Disconnetti il socket vecchio
                    const oldSocket = io.sockets.sockets.get(existingSocketId);
                    if (oldSocket) {
                        oldSocket.disconnect(true);
                    }
                }
            }

            // Verifica nel database
            db.query(`
           SELECT id, nome, crediti FROM partecipanti_fantagts 
           WHERE id = $1 AND attivo = true AND sessione_id = $2
       `, [data.partecipanteId, sessioneCorrente])
                .then(result => {
                    if (result.rows.length === 0) {
                        console.log(`❌ ACCESSO NEGATO: ${data.nome} non è registrato nel database`);
                        socket.emit('registered', {
                            success: false,
                            error: 'Non sei registrato nel database. Effettua prima la registrazione.',
                            shouldReload: true
                        });
                        return;
                    }

                    // Registrazione WebSocket autorizzata
                    gameState.connessi.set(socket.id, {
                        nome: data.nome,
                        tipo: data.tipo,
                        partecipanteId: data.partecipanteId,
                        stato: 'connesso',
                        verified: true,
                        registeredAt: new Date().toISOString()
                    });

                    // Invia stato completo del gioco
                    socket.emit('registered', {
                        success: true,
                        verified: true,
                        gameState: {
                            fase: gameState.fase,
                            roundAttivo: gameState.roundAttivo,
                            asteAttive: gameState.asteAttive,
                            currentRound: gameState.roundAttivo,
                            biddingActive: gameState.asteAttive
                        }
                    });

                    io.emit('connessi_update', Array.from(gameState.connessi.values()));
                    console.log(`✅ Registrato e VERIFICATO: ${data.nome} come ${data.tipo} (DB ID: ${data.partecipanteId}) - Socket: ${socket.id}`);
                    console.log(`📊 Connessi totali: ${gameState.connessi.size}`);
                })
                .catch(err => {
                    console.error('❌ Errore verifica database:', err);
                    socket.emit('registered', {
                        success: false,
                        error: 'Errore verifica database'
                    });
                });
        } else {
            // Master o altri tipi non necessitano verifica DB
            gameState.connessi.set(socket.id, {
                nome: data.nome,
                tipo: data.tipo,
                partecipanteId: data.partecipanteId || null,
                stato: 'connesso',
                verified: data.tipo !== 'partecipante',
                registeredAt: new Date().toISOString()
            });

            socket.emit('registered', {
                success: true,
                gameState: {
                    fase: gameState.fase,
                    roundAttivo: gameState.roundAttivo,
                    asteAttive: gameState.asteAttive,
                    currentRound: gameState.roundAttivo,
                    biddingActive: gameState.asteAttive
                }
            });

            io.emit('connessi_update', Array.from(gameState.connessi.values()));
            console.log(`✅ Registrato: ${data.nome} come ${data.tipo} - Socket: ${socket.id}`);
            console.log(`📊 Connessi totali: ${gameState.connessi.size}`);
        }
    });

    socket.on('place_bid', async (data) => {
        console.log(`💰 Tentativo puntata da socket ${socket.id}:`, data);

        // Verifica che ci sia un round attivo
        if (!gameState.asteAttive || gameState.roundAttivo !== data.round) {
            console.log(`❌ Round non attivo: attivo=${gameState.asteAttive}, round=${gameState.roundAttivo}, richiesto=${data.round}`);
            socket.emit('bid_error', { message: 'Nessun round attivo o round non corrispondente' });
            return;
        }

        // Verifica che il socket sia registrato
        const connesso = gameState.connessi.get(socket.id);
        console.log(`🔍 Controllo connesso per socket ${socket.id}:`, {
            connesso: !!connesso,
            tipo: connesso?.tipo,
            nome: connesso?.nome,
            partecipanteId: connesso?.partecipanteId,
            verified: connesso?.verified
        });

        if (!connesso) {
            console.log(`❌ Socket ${socket.id} non trovato in gameState.connessi`);
            socket.emit('bid_error', { message: 'Socket non registrato. Ricarica la pagina.' });
            return;
        }

        if (connesso.tipo !== 'partecipante') {
            console.log(`❌ Socket ${socket.id} non è un partecipante: tipo=${connesso.tipo}`);
            socket.emit('bid_error', { message: 'Solo i partecipanti possono fare offerte' });
            return;
        }

        if (!connesso.verified) {
            console.log(`❌ Socket ${socket.id} non verificato nel database`);
            socket.emit('bid_error', { message: 'Utente non verificato. Ricarica la pagina.' });
            return;
        }

        // Verifica che il partecipante sia ancora in attesa (solo dopo la prima asta)
        if (gameState.astaCorrente > 1 && gameState.partecipantiInAttesa && !gameState.partecipantiInAttesa.includes(connesso.partecipanteId)) {
            console.log(`❌ ${connesso.nome} ha già vinto in questo round`);
            socket.emit('bid_error', { message: 'Hai già vinto un giocatore in questo round' });
            return;
        }

        // Verifica che non abbia già fatto un'offerta in questa asta
        let hasAlreadyBid = false;
        for (let [existingSocketId, offerta] of gameState.offerteTemporanee.entries()) {
            if (existingSocketId !== socket.id) {
                const offerenteConnesso = gameState.connessi.get(existingSocketId);
                if (offerenteConnesso &&
                    offerenteConnesso.partecipanteId === connesso.partecipanteId &&
                    offerta.round === data.round) {
                    hasAlreadyBid = true;
                    break;
                }
            }
        }

        if (hasAlreadyBid) {
            console.log(`❌ ${connesso.nome} ha già fatto un'offerta in questa asta`);
            socket.emit('bid_error', { message: 'Hai già fatto un\'offerta in questa asta' });
            return;
        }

        // Verifica validità dati offerta
        if (!data.slot || !data.importo || data.importo <= 0) {
            console.log(`❌ Dati offerta non validi:`, data);
            socket.emit('bid_error', { message: 'Dati offerta non validi' });
            return;
        }

        // Verifica che lo slot sia ancora disponibile
        if (gameState.slotsRimasti && gameState.slotsRimasti.length > 0) {
            const slotDisponibile = gameState.slotsRimasti.find(s => s.id === data.slot);
            if (!slotDisponibile) {
                console.log(`❌ Slot ${data.slot} non più disponibile`);
                socket.emit('bid_error', { message: 'Giocatore non più disponibile' });
                return;
            }
        }

        // Verifica crediti disponibili nel database
        try {
            const result = await db.query("SELECT crediti FROM partecipanti_fantagts WHERE id = $1 AND sessione_id = $2",
                [connesso.partecipanteId, sessioneCorrente]);

            if (result.rows.length === 0) {
                console.log(`❌ Partecipante ${connesso.partecipanteId} non trovato nel database`);
                socket.emit('bid_error', { message: 'Partecipante non trovato nel database' });
                return;
            }

            const creditiDisponibili = result.rows[0].crediti;
            if (data.importo > creditiDisponibili) {
                console.log(`❌ ${connesso.nome} ha crediti insufficienti: ${data.importo} > ${creditiDisponibili}`);
                socket.emit('bid_error', { message: `Crediti insufficienti. Disponibili: ${creditiDisponibili}` });
                return;
            }

            // Salva offerta temporanea (sovrascrive se esiste già per questo socket)
            gameState.offerteTemporanee.set(socket.id, {
                round: data.round,
                slot: data.slot,
                importo: parseInt(data.importo),
                partecipanteId: connesso.partecipanteId,
                timestamp: Date.now()
            });

            console.log(`💰 Offerta ricevuta e salvata: ${connesso.nome} (${connesso.partecipanteId}) punta ${data.importo} su ${data.slot}`);
            console.log(`📊 Totale offerte ora: ${gameState.offerteTemporanee.size}`);
            console.log(`🎯 Asta corrente: ${gameState.astaCorrente}, Round: ${gameState.roundAttivo}`);

            // Conferma offerta al client
            socket.emit('bid_confirmed', {
                slot: data.slot,
                importo: data.importo,
                partecipante: connesso.nome,
                round: data.round,
                astaNumero: gameState.astaCorrente || 1
            });

            console.log(`✅ Offerta confermata inviata a ${connesso.nome}`);

        } catch (err) {
            console.error('❌ Errore verifica crediti:', err);
            socket.emit('bid_error', { message: 'Errore del server durante verifica crediti' });
        }
    });

    socket.on('disconnect', () => {
        gameState.connessi.delete(socket.id);
        gameState.offerteTemporanee.delete(socket.id);
        io.emit('connessi_update', Array.from(gameState.connessi.values()));
        console.log('Disconnesso:', socket.id);
    });

    socket.on('heartbeat', (data) => {
        socket.emit('heartbeat_response', {
            timestamp: Date.now(),
            serverTime: new Date().toISOString(),
            type: data.type || 'standard'
        });

        if (data.type === 'persistence_check') {
            console.log(`💓 Heartbeat persistenza da ${gameState.connessi.get(socket.id)?.nome || 'Sconosciuto'}`);
        }
    });
});

// Funzione per ottenere l'IP locale
function getLocalIP() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            if (interface.family === 'IPv4' && !interface.internal) {
                return interface.address;
            }
        }
    }
    return 'localhost';
}

// Avvio server
const PORT = process.env.PORT || 3000;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '0.0.0.0';

// Inizializza database prima di avviare il server
initializeDatabase().then(async () => {
    await updateDatabaseSchema();

    server.listen(PORT, HOST, () => {
        const localIP = getLocalIP();

        console.log('\n🎾 FantaGTS Server Avviato con PostgreSQL!');

        if (process.env.NODE_ENV === 'production') {
            console.log(`🌐 Production URL disponibile`);
            console.log(`🎮 Master: /master`);
            console.log(`⚙️  Setup: /setup`);
        } else {
            console.log(`📱 Client: http://localhost:${PORT}`);
            console.log(`⚙️  Setup: http://localhost:${PORT}/setup`);
            console.log(`🎮 Master: http://localhost:${PORT}/master`);
            console.log(`🔗 Rete locale: http://${localIP}:${PORT}`);
        }

        console.log('\n✅ Sistema pronto per la configurazione!');
    });
}).catch(err => {
    console.error('❌ Errore avvio server:', err);
});

// Gestione errori
process.on('uncaughtException', (err) => {
    console.error('Errore critico:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection:', reason);
});

// Chiusura pulita
process.on('SIGINT', () => {
    console.log('\n🔄 Chiusura server in corso...');
    db.end();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔄 Terminazione server ricevuta...');
    db.end();
    process.exit(0);
});