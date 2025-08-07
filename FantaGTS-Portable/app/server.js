// server.js - FantaGTS Server con PostgreSQL
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configurazione Web Push - VERSIONE DEFINITIVA
const webpush = require('web-push');
let webPushConfigured = false;
let currentVapidKeys = null;

// Funzione per inizializzare Web Push
function initializeWebPush() {
    try {
        // OPZIONE 1: Usa chiavi da variabili ambiente
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
            console.log('✅ Web Push configurato con chiavi da ambiente');
        }
        // OPZIONE 2: Genera nuove chiavi sempre fresche
        else {
            console.log('🔑 Generando nuove chiavi VAPID...');
            currentVapidKeys = webpush.generateVAPIDKeys();

            webpush.setVapidDetails(
                'mailto:fantagts@circolo.com',
                currentVapidKeys.publicKey,
                currentVapidKeys.privateKey
            );
            webPushConfigured = true;

            console.log('🔑 NUOVE CHIAVI VAPID GENERATE:');
            console.log('📤 PUBLIC:', currentVapidKeys.publicKey);
            console.log('🔐 PRIVATE:', currentVapidKeys.privateKey);
            console.log('💡 IMPORTANTE: Salva queste chiavi se vuoi riutilizzarle!');
        }
    } catch (error) {
        console.error('❌ Errore configurazione Web Push:', error);
        webPushConfigured = false;
    }
}

// Inizializza Web Push
initializeWebPush();

// Middleware
app.use(express.static('public'));
app.use(express.json());

console.log('🔍 Directory corrente:', __dirname);

// Database PostgreSQL con debug e fallback
console.log('🔍 Tutte le variabili database disponibili:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'PRESENTE' : 'MANCANTE');
console.log('DATABASE_PUBLIC_URL:', process.env.DATABASE_PUBLIC_URL ? 'PRESENTE' : 'MANCANTE');
console.log('POSTGRES_URL:', process.env.POSTGRES_URL ? 'PRESENTE' : 'MANCANTE');

const connectionString = process.env.DATABASE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.POSTGRES_URL ||
    'postgresql://postgres:iUFrkUQnATpmwBXsbcUFcjtmtzMudUyk@postgres.railway.internal:5432/railway';

console.log('🔗 Usando connection string:', connectionString.substring(0, 50) + '...');

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

// Stato del gioco in memoria
let gameState = {
    fase: 'setup',
    roundAttivo: null,
    asteAttive: false,
    connessi: new Map(),
    offerteTemporanee: new Map()
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

        // Cerca subscription nel database
        try {
            let query, params;
            if (targetUsers && targetUsers.length > 0) {
                const placeholders = targetUsers.map((_, i) => `$${i + 1}`).join(',');
                query = `SELECT * FROM push_subscriptions 
                    WHERE partecipante_id IN (${placeholders}) AND attiva = true`;
                params = targetUsers;
            } else {
                query = "SELECT * FROM push_subscriptions WHERE attiva = true";
                params = [];
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
            title: title,
            body: body,
            icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E',
            badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ctext y=".9em" font-size="90"%3E🎾%3C/text%3E%3C/svg%3E',
            vibrate: [100, 50, 100],
            data: {
                url: url || '/',
                timestamp: Date.now()
            },
            actions: [
                {
                    action: 'open',
                    title: 'Apri FantaGTS'
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

                console.log(`🚀 Tentativo push a: ${subscription.partecipante_id}`);

                await webpush.sendNotification(pushSubscription, payload, {
                    TTL: 3600, // 1 ora
                    urgency: 'normal'
                });

                pushInviate++;
                console.log(`✅ Push inviata a: ${subscription.partecipante_id}`);

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
        const result = await db.query("SELECT * FROM partecipanti_fantagts ORDER BY nome");
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API partecipanti:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partecipanti', async (req, res) => {
    try {
        const { nome, crediti = 2000 } = req.body;
        const id = nome.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

        await db.query(`INSERT INTO partecipanti_fantagts 
            (id, nome, crediti) VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET nome = $2, crediti = $3`,
            [id, nome, crediti]);

        res.json({ id: id, message: 'Partecipante registrato con successo' });
    } catch (err) {
        console.error('Errore POST partecipanti:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/partecipanti/:id', async (req, res) => {
    try {
        await db.query("DELETE FROM partecipanti_fantagts WHERE id = $1", [req.params.id]);
        res.json({ message: 'Partecipante eliminato con successo' });
    } catch (err) {
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

        const result = await db.query(`SELECT 
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

        res.json(result.rows);
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

    gameState.roundAttivo = round;
    gameState.asteAttive = true;
    gameState.offerteTemporanee.clear();

    try {
        const slotsResult = await db.query("SELECT * FROM slots WHERE posizione = $1 AND attivo = true", [round]);
        const slots = slotsResult.rows;

        io.emit('round_started', {
            round: round,
            slots: slots,
            sistema: 'conferme'
        });

        console.log(`Round ${round} avviato - Sistema basato su conferme`);

        // NOTIFICHE A TUTTI I PARTECIPANTI REGISTRATI
        try {
            const partecipantiResult = await db.query("SELECT id FROM partecipanti_fantagts WHERE attivo = true");
            const partecipantiIds = partecipantiResult.rows.map(p => p.id);

            console.log(`📨 INVIO NOTIFICHE ROUND ${round} A TUTTI I PARTECIPANTI:`, partecipantiIds);

            if (partecipantiIds.length > 0) {
                await inviaNotifichePush({
                    title: `FantaGTS - Round ${round}`,
                    body: `È iniziato il round ${round}! Fai la tua offerta!`,
                    url: '/',
                    targetUsers: partecipantiIds
                });
            } else {
                console.log('⚠️ Nessun partecipante trovato nel database');
            }
        } catch (error) {
            console.error('❌ ERRORE INVIO NOTIFICHE:', error);
        }

        res.json({ message: `Round ${round} avviato con successo` });

        avviaMonitoraggioOfferte();
    } catch (err) {
        console.error('Errore avvia-round:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per controllare se tutti hanno fatto offerte
app.get('/api/stato-offerte/:round', (req, res) => {
    const round = req.params.round;

    const partecipantiConnessi = Array.from(gameState.connessi.values())
        .filter(p => p.tipo === 'partecipante').length;

    const offerteRound = Array.from(gameState.offerteTemporanee.values())
        .filter(o => o.round === round).length;

    const tuttiHannoOfferto = partecipantiConnessi > 0 && offerteRound >= partecipantiConnessi;

    res.json({
        partecipantiConnessi: partecipantiConnessi,
        offerteRicevute: offerteRound,
        mancano: Math.max(0, partecipantiConnessi - offerteRound),
        tuttiHannoOfferto: tuttiHannoOfferto,
        dettaglioOfferte: Array.from(gameState.offerteTemporanee.entries()).map(([socketId, offerta]) => ({
            partecipante: gameState.connessi.get(socketId)?.nome || 'Sconosciuto',
            offerta: offerta
        }))
    });
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

        // Altrimenti genera nuove chiavi
        const vapidKeys = webpush.generateVAPIDKeys();
        res.json({
            publicKey: vapidKeys.publicKey,
            temporary: true,
            message: 'Chiave temporanea generata - configura VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY'
        });
    } catch (error) {
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

// API per ottenere la chiave pubblica corrente
app.get('/api/vapid-public-key', (req, res) => {
    if (!webPushConfigured || !currentVapidKeys) {
        return res.status(503).json({
            error: 'Web Push non configurato',
            configured: false
        });
    }

    res.json({
        publicKey: currentVapidKeys.publicKey,
        configured: true
    });
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

        // SALVATAGGIO EFFETTIVO
        await db.query(`INSERT INTO push_subscriptions 
            (partecipante_id, endpoint, p256dh_key, auth_key, user_agent, last_seen, attiva) 
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, true)
            ON CONFLICT (endpoint) DO UPDATE SET
            partecipante_id = $1, p256dh_key = $3, auth_key = $4, user_agent = $5, last_seen = CURRENT_TIMESTAMP, attiva = true`,
            [partecipanteId, endpoint, keys.p256dh, keys.auth, userAgent]);

        console.log('✅ SUBSCRIPTION SALVATA');

        // VERIFICA IMMEDIATA
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

// Monitoraggio automatico offerte
function avviaMonitoraggioOfferte() {
    const monitorInterval = setInterval(() => {
        if (!gameState.asteAttive) {
            clearInterval(monitorInterval);
            return;
        }

        const partecipantiConnessi = Array.from(gameState.connessi.values())
            .filter(p => p.tipo === 'partecipante').length;

        const offerteRound = Array.from(gameState.offerteTemporanee.values())
            .filter(o => o.round === gameState.roundAttivo).length;

        const statoOfferte = {
            partecipantiConnessi: partecipantiConnessi,
            offerteRicevute: offerteRound,
            mancano: Math.max(0, partecipantiConnessi - offerteRound),
            tuttiHannoOfferto: partecipantiConnessi > 0 && offerteRound >= partecipantiConnessi
        };

        io.emit('offerte_update', statoOfferte);

        if (statoOfferte.tuttiHannoOfferto && partecipantiConnessi > 0) {
            console.log(`🎉 ${partecipantiConnessi} partecipante(i) hanno fatto offerte - chiusura automatica round`);
            clearInterval(monitorInterval);

            if (gameState.asteAttive) {
                console.log('🔄 Avviando elaborazione risultati...');
                terminaRound();
            }
        }
    }, 1000);
}

// API per forzare fine round
app.post('/api/forza-fine-round', (req, res) => {
    if (!gameState.asteAttive) {
        return res.status(400).json({ error: 'Nessun round attivo' });
    }

    terminaRound();
    res.json({ message: 'Round terminato forzatamente' });
});

function terminaRound() {
    if (gameState.asteAttive === false) return;

    gameState.asteAttive = false;
    gameState.gamePhase = 'results';

    elaboraRisultatiAste();
}

function elaboraRisultatiAste() {
    const round = gameState.roundAttivo;
    console.log(`🔄 Elaborando risultati per round ${round}...`);

    const offertePerSlot = {};

    gameState.offerteTemporanee.forEach((offerta, socketId) => {
        const connesso = gameState.connessi.get(socketId);
        if (connesso && offerta.round === round) {
            console.log(`📝 Processando offerta: ${connesso.nome} → ${offerta.slot} (${offerta.importo} crediti)`);

            if (!offertePerSlot[offerta.slot]) {
                offertePerSlot[offerta.slot] = [];
            }
            offertePerSlot[offerta.slot].push({
                partecipante: connesso.partecipanteId,
                nome: connesso.nome,
                offerta: offerta.importo,
                socketId: socketId
            });
        }
    });

    console.log('🎯 Offerte raggruppate per slot:', offertePerSlot);

    const risultati = [];

    Object.keys(offertePerSlot).forEach(slotId => {
        const offerte = offertePerSlot[slotId];

        if (offerte.length > 0) {
            offerte.sort((a, b) => b.offerta - a.offerta);
            const vincitore = offerte[0];

            risultati.push({
                partecipante: vincitore.partecipante,
                nome: vincitore.nome,
                slot: slotId,
                offertaOriginale: vincitore.offerta,
                costoFinale: vincitore.offerta,
                premium: 0,
                condiviso: false
            });

            console.log(`🏆 ${vincitore.nome} vince ${slotId} per ${vincitore.offerta} crediti`);
        }
    });

    console.log('🎉 Risultati finali:', risultati);

    if (risultati.length > 0) {
        salvaRisultatiAste(round, risultati);
    } else {
        console.log('⚠️ Nessun risultato da salvare per il round', round);
        io.emit('round_ended', {
            round: round,
            risultati: []
        });
        gameState.roundAttivo = null;
        gameState.offerteTemporanee.clear();
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
        gameState.connessi.set(socket.id, {
            nome: data.nome,
            tipo: data.tipo,
            partecipanteId: data.partecipanteId || null,
            stato: 'connesso'
        });

        socket.emit('registered', {
            success: true,
            gameState: {
                fase: gameState.fase,
                roundAttivo: gameState.roundAttivo,
                asteAttive: gameState.asteAttive
            }
        });

        io.emit('connessi_update', Array.from(gameState.connessi.values()));

        console.log(`✅ Registrato: ${data.nome} come ${data.tipo}`);
    });

    socket.on('place_bid', async (data) => {
        if (!gameState.asteAttive || gameState.roundAttivo !== data.round) {
            socket.emit('bid_error', { message: 'Nessun round attivo' });
            return;
        }

        const connesso = gameState.connessi.get(socket.id);
        if (!connesso || connesso.tipo !== 'partecipante') {
            socket.emit('bid_error', { message: 'Solo i partecipanti possono fare offerte' });
            return;
        }

        // Verifica crediti disponibili
        try {
            const result = await db.query("SELECT crediti FROM partecipanti_fantagts WHERE id = $1", [connesso.partecipanteId]);

            if (result.rows.length === 0) {
                socket.emit('bid_error', { message: 'Partecipante non trovato' });
                return;
            }

            if (data.importo > result.rows[0].crediti) {
                socket.emit('bid_error', { message: 'Crediti insufficienti' });
                return;
            }

            // Salva offerta temporanea
            gameState.offerteTemporanee.set(socket.id, {
                round: data.round,
                slot: data.slot,
                importo: parseInt(data.importo)
            });

            socket.emit('bid_confirmed', {
                slot: data.slot,
                importo: data.importo
            });

            console.log(`💰 Offerta ricevuta: ${connesso.nome} punta ${data.importo} su ${data.slot}`);

            // Aggiorna immediatamente il master sulle offerte
            const partecipantiConnessi = Array.from(gameState.connessi.values())
                .filter(p => p.tipo === 'partecipante').length;

            const offerteRound = Array.from(gameState.offerteTemporanee.values())
                .filter(o => o.round === data.round).length;

            io.emit('offerte_update', {
                partecipantiConnessi: partecipantiConnessi,
                offerteRicevute: offerteRound,
                mancano: Math.max(0, partecipantiConnessi - offerteRound),
                tuttiHannoOfferto: partecipantiConnessi > 0 && offerteRound >= partecipantiConnessi,
                dettaglioOfferte: Array.from(gameState.offerteTemporanee.entries()).map(([socketId, offerta]) => ({
                    partecipante: gameState.connessi.get(socketId)?.nome || 'Sconosciuto',
                    offerta: offerta
                }))
            });
        } catch (err) {
            console.error('Errore verifica crediti:', err);
            socket.emit('bid_error', { message: 'Errore del server' });
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
initializeDatabase().then(() => {
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