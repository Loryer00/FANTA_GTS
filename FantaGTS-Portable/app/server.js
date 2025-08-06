// server.js - FantaGTS Server con SQL.js CORRETTO
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(express.static('public'));
app.use(express.json());

console.log('🔍 Directory corrente:', __dirname);

// Inizializza database
const dbPath = path.join(__dirname, 'data', 'fantagts.db');

// Crea cartella data se non esiste
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

let db;
let SQL;

// Inizializza SQL.js
async function initializeDatabase() {
    try {
        SQL = await initSqlJs();

        // Carica database esistente o crea nuovo
        let dbData;
        try {
            dbData = fs.readFileSync(dbPath);
            db = new SQL.Database(dbData);
            console.log('✅ Database caricato dal file:', dbPath);
        } catch (err) {
            db = new SQL.Database();
            console.log('⚠️ Nuovo database creato in memoria');
        }

        // Crea struttura tabelle
        createTables();

        // Salva database su disco
        saveDatabase();

        console.log('✅ Database inizializzato con successo');
    } catch (error) {
        console.error('❌ Errore inizializzazione database:', error);
    }
}

function createTables() {
    db.exec(`CREATE TABLE IF NOT EXISTS squadre_circolo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero INTEGER UNIQUE,
        colore TEXT,
        m1 TEXT, m2 TEXT, m3 TEXT, m4 TEXT, m5 TEXT, m6 TEXT, m7 TEXT,
        f1 TEXT, f2 TEXT, f3 TEXT,
        attiva BOOLEAN DEFAULT 1
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS partecipanti_fantagts (
        id TEXT PRIMARY KEY,
        nome TEXT,
        email TEXT,
        telefono TEXT,
        crediti INTEGER DEFAULT 2000,
        punti_totali INTEGER DEFAULT 0,
        posizione_classifica INTEGER
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        squadra_numero INTEGER,
        colore TEXT,
        posizione TEXT,
        giocatore_attuale TEXT,
        punti_totali INTEGER DEFAULT 0,
        attivo BOOLEAN DEFAULT 1,
        FOREIGN KEY (squadra_numero) REFERENCES squadre_circolo(numero)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS aste (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round TEXT,
        partecipante_id TEXT,
        slot_id TEXT,
        offerta INTEGER,
        costo_finale INTEGER,
        premium REAL DEFAULT 0,
        vincitore BOOLEAN DEFAULT 0,
        condiviso BOOLEAN DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (partecipante_id) REFERENCES partecipanti_fantagts(id),
        FOREIGN KEY (slot_id) REFERENCES slots(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS sostituzioni (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_id TEXT,
        giocatore_vecchio TEXT,
        giocatore_nuovo TEXT,
        dal_turno INTEGER,
        motivo TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (slot_id) REFERENCES slots(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS risultati_partite (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turno INTEGER,
        squadra_1 INTEGER,
        squadra_2 INTEGER,
        risultato TEXT,
        vincitori TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (squadra_1) REFERENCES squadre_circolo(numero),
        FOREIGN KEY (squadra_2) REFERENCES squadre_circolo(numero)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partecipante_id TEXT,
        endpoint TEXT UNIQUE,
        p256dh_key TEXT,
        auth_key TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        attiva BOOLEAN DEFAULT 1,
        FOREIGN KEY (partecipante_id) REFERENCES partecipanti_fantagts(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS configurazione (
        chiave TEXT PRIMARY KEY,
        valore TEXT
    )`);

    // Verifica se colonna condiviso esiste
    try {
        db.exec(`ALTER TABLE aste ADD COLUMN condiviso BOOLEAN DEFAULT 0`);
        console.log('✅ Colonna condiviso aggiunta');
    } catch (err) {
        console.log('⚠️ Colonna condiviso già presente');
    }
}

function saveDatabase() {
    try {
        const data = db.export();
        fs.writeFileSync(dbPath, data);
    } catch (error) {
        console.error('⚠️ Errore salvataggio database:', error);
    }
}

// Funzioni di query helper - CORRETTE per SQL.js
function queryAll(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        const result = [];

        // Bind parameters if any
        if (params.length > 0) {
            stmt.bind(params);
        }

        // Get all rows
        while (stmt.step()) {
            result.push(stmt.getAsObject());
        }

        stmt.free();
        return result;
    } catch (error) {
        console.error('Errore queryAll:', sql, error);
        return [];
    }
}

function queryGet(sql, params = []) {
    try {
        const stmt = db.prepare(sql);

        // Bind parameters if any
        if (params.length > 0) {
            stmt.bind(params);
        }

        let result = null;
        if (stmt.step()) {
            result = stmt.getAsObject();
        }

        stmt.free();
        return result;
    } catch (error) {
        console.error('Errore queryGet:', sql, error);
        return null;
    }
}

function queryRun(sql, params = []) {
    try {
        const stmt = db.prepare(sql);

        // Bind parameters if any
        if (params.length > 0) {
            stmt.bind(params);
        }

        stmt.step();
        const changes = db.getRowsModified();
        stmt.free();

        saveDatabase(); // Salva dopo ogni modifica
        return { changes, lastID: null };
    } catch (error) {
        console.error('Errore queryRun:', sql, error);
        throw error;
    }
}

// AGGIUNGI QUESTA FUNZIONE nel server.js (dopo le altre funzioni)
function inviaNotifichePush(notificationData) {
    try {
        const { title, body, url, targetUsers } = notificationData;
        console.log('📨 INVIO NOTIFICHE PUSH:', { title, body, targetUsers });

        // 1. NOTIFICHE AI CLIENT CONNESSI (tramite WebSocket)
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

        // 2. CONTROLLA SUBSCRIPTION NEL DATABASE
        let subscriptions = [];
        try {
            if (targetUsers && targetUsers.length > 0) {
                const placeholders = targetUsers.map(() => '?').join(',');
                subscriptions = queryAll(`SELECT * FROM push_subscriptions 
                    WHERE partecipante_id IN (${placeholders}) AND attiva = 1`, targetUsers);
            } else {
                subscriptions = queryAll("SELECT * FROM push_subscriptions WHERE attiva = 1");
            }
            console.log(`📱 SUBSCRIPTION NEL DB: ${subscriptions.length}`);
        } catch (dbError) {
            console.error('❌ ERRORE QUERY SUBSCRIPTIONS:', dbError);
        }

        // 3. LOG RISULTATI
        console.log(`✅ NOTIFICHE INVIATE: ${notificheTramiteSocket} via WebSocket, ${subscriptions.length} subscription trovate nel DB`);

        return {
            success: true,
            sent: notificheTramiteSocket,
            subscriptions: subscriptions.length,
            method: 'websocket_only'
        };
    } catch (error) {
        console.error('❌ ERRORE INVIO NOTIFICHE:', error);
        return { success: false, error: error.message };
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

function generaSlots() {
    return new Promise((resolve, reject) => {
        try {
            const squadre = queryAll("SELECT * FROM squadre_circolo WHERE attiva = 1");
            const posizioni = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'F1', 'F2', 'F3'];

            // Cancella slots esistenti
            queryRun("DELETE FROM slots");

            let inserimenti = 0;
            squadre.forEach(squadra => {
                posizioni.forEach(pos => {
                    const slotId = `${pos}_${squadra.colore.toUpperCase()}`;
                    const giocatore = squadra[pos.toLowerCase()];

                    queryRun("INSERT INTO slots (id, squadra_numero, colore, posizione, giocatore_attuale) VALUES (?, ?, ?, ?, ?)",
                        [slotId, squadra.numero, squadra.colore, pos, giocatore]);
                    inserimenti++;
                });
            });

            resolve(inserimenti);
        } catch (error) {
            reject(error);
        }
    });
}

// Routes API

// Setup squadre circolo
app.get('/api/squadre', (req, res) => {
    try {
        const rows = queryAll("SELECT * FROM squadre_circolo ORDER BY numero");
        res.json(rows);
    } catch (err) {
        console.error('Errore API squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/squadre-complete', (req, res) => {
    try {
        const squadre = queryAll("SELECT * FROM squadre_circolo WHERE attiva = 1 ORDER BY numero");

        squadre.forEach(squadra => {
            try {
                const result = queryGet("SELECT COUNT(*) as slots_count FROM slots WHERE squadra_numero = ?", [squadra.numero]);
                squadra.slots_generati = result ? result.slots_count : 0;
            } catch (err) {
                squadra.slots_generati = 0;
            }
        });

        res.json(squadre);
    } catch (err) {
        console.error('Errore API squadre-complete:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/squadre', (req, res) => {
    try {
        const { numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3 } = req.body;

        queryRun(`INSERT OR REPLACE INTO squadre_circolo 
            (numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3]);

        res.json({ message: 'Squadra salvata con successo' });
    } catch (err) {
        console.error('Errore POST squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/squadre/:numero', (req, res) => {
    try {
        queryRun("DELETE FROM squadre_circolo WHERE numero = ?", [req.params.numero]);
        res.json({ message: 'Squadra eliminata con successo' });
    } catch (err) {
        console.error('Errore DELETE squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

// Setup partecipanti
app.get('/api/partecipanti', (req, res) => {
    try {
        const rows = queryAll("SELECT * FROM partecipanti_fantagts ORDER BY nome");
        res.json(rows);
    } catch (err) {
        console.error('Errore API partecipanti:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partecipanti', (req, res) => {
    try {
        const { nome, crediti = 2000 } = req.body;
        const id = nome.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

        queryRun(`INSERT OR REPLACE INTO partecipanti_fantagts 
            (id, nome, crediti) VALUES (?, ?, ?)`,
            [id, nome, crediti]);

        res.json({ id: id, message: 'Partecipante registrato con successo' });
    } catch (err) {
        console.error('Errore POST partecipanti:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/partecipanti/:id', (req, res) => {
    try {
        queryRun("DELETE FROM partecipanti_fantagts WHERE id = ?", [req.params.id]);
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
app.get('/api/slot-info/:slotId', (req, res) => {
    try {
        const slotId = req.params.slotId;
        const row = queryGet("SELECT * FROM slots WHERE id = ?", [slotId]);

        if (!row) {
            return res.status(404).json({ error: 'Slot non trovato' });
        }

        res.json(row);
    } catch (err) {
        console.error('Errore slot-info:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni squadra di un partecipante
app.get('/api/squadra-partecipante/:partecipanteId', (req, res) => {
    try {
        const partecipanteId = req.params.partecipanteId;

        const rows = queryAll(`SELECT 
            a.slot_id,
            a.costo_finale,
            s.posizione,
            s.giocatore_attuale,
            s.colore,
            s.punti_totali
            FROM aste a 
            JOIN slots s ON a.slot_id = s.id 
            WHERE a.partecipante_id = ? AND a.vincitore = 1 
            ORDER BY s.posizione`, [partecipanteId]);

        res.json(rows);
    } catch (err) {
        console.error('Errore squadra-partecipante:', err);
        res.status(500).json({ error: err.message });
    }
});

// Controllo aste
app.post('/api/avvia-round/:round', (req, res) => {
    const round = req.params.round;

    if (gameState.asteAttive) {
        return res.status(400).json({ error: 'Un round è già attivo' });
    }

    gameState.roundAttivo = round;
    gameState.asteAttive = true;
    gameState.offerteTemporanee.clear();

    try {
        const slots = queryAll("SELECT * FROM slots WHERE posizione = ? AND attivo = 1", [round]);

        io.emit('round_started', {
            round: round,
            slots: slots,
            sistema: 'conferme'
        });

        console.log(`Round ${round} avviato - Sistema basato su conferme`);

        // Invia notifiche push ai partecipanti
        try {
            const partecipantiConnessi = Array.from(gameState.connessi.values())
                .filter(p => p.tipo === 'partecipante')
                .map(p => p.partecipanteId)
                .filter(id => id);

            if (partecipantiConnessi.length > 0) {
                console.log(`📨 Invio notifiche round ${round} a:`, partecipantiConnessi);

                inviaNotifichePush({
                    title: `FantaGTS - Round ${round}`,
                    body: `È iniziato il round ${round}! Fai la tua offerta!`,
                    url: '/',
                    targetUsers: partecipantiConnessi
                });
            }
        } catch (error) {
            console.error('❌ Errore invio notifiche:', error);
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
app.get('/api/aste-round/:round', (req, res) => {
    try {
        const round = req.params.round;

        const rows = queryAll(`SELECT a.*, p.nome as partecipante_nome, s.giocatore_attuale, s.colore 
                FROM aste a 
                JOIN partecipanti_fantagts p ON a.partecipante_id = p.id 
                JOIN slots s ON a.slot_id = s.id 
                WHERE a.round = ? AND a.vincitore = 1 
                ORDER BY a.costo_finale DESC`, [round]);

        res.json(rows);
    } catch (err) {
        console.error('Errore aste-round:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni tutti i risultati partite
app.get('/api/risultati-partite', (req, res) => {
    try {
        const rows = queryAll(`SELECT r.*, 
                s1.colore as squadra_1_colore, s2.colore as squadra_2_colore
                FROM risultati_partite r 
                JOIN squadre_circolo s1 ON r.squadra_1 = s1.numero 
                JOIN squadre_circolo s2 ON r.squadra_2 = s2.numero 
                ORDER BY r.turno DESC, r.timestamp DESC`);

        // Parse JSON vincitori
        const processedRows = rows.map(row => {
            try {
                row.vincitori = JSON.parse(row.vincitori || '[]');
            } catch (e) {
                row.vincitori = [];
            }
            return row;
        });

        res.json(processedRows);
    } catch (err) {
        console.error('Errore risultati-partite:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni classifica generale
app.get('/api/classifica', (req, res) => {
    try {
        const rows = queryAll(`SELECT 
            p.id, p.nome, p.crediti, 
            COUNT(a.id) as giocatori_totali,
            COALESCE(SUM(s.punti_totali), 0) as punti_totali,
            COALESCE(SUM(a.costo_finale), 0) as crediti_spesi
            FROM partecipanti_fantagts p 
            LEFT JOIN aste a ON p.id = a.partecipante_id AND a.vincitore = 1
            LEFT JOIN slots s ON a.slot_id = s.id 
            GROUP BY p.id, p.nome, p.crediti 
            ORDER BY punti_totali DESC, crediti_spesi ASC`);

        // Aggiungi posizione in classifica
        const classifica = rows.map((row, index) => {
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

app.get('/api/debug/subscriptions', (req, res) => {
    try {
        const subscriptions = queryAll("SELECT * FROM push_subscriptions");
        console.log('🔍 SUBSCRIPTION NEL DB:', subscriptions);
        res.json({
            count: subscriptions.length,
            subscriptions: subscriptions
        });
    } catch (err) {
        console.error('❌ Errore query subscriptions:', err);
        res.status(500).json({ error: err.message });
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

function salvaRisultatiAste(round, risultati) {
    if (risultati.length === 0) {
        console.log('Nessun risultato da salvare per il round', round);
        return;
    }

    try {
        risultati.forEach(r => {
            queryRun(`INSERT INTO aste 
                (round, partecipante_id, slot_id, offerta, costo_finale, premium, vincitore, condiviso) 
                VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
                [round, r.partecipante, r.slot, r.offertaOriginale, r.costoFinale, r.premium, r.condiviso ? 1 : 0]);

            // Aggiorna crediti partecipante
            queryRun(`UPDATE partecipanti_fantagts 
                    SET crediti = crediti - ? 
                    WHERE id = ?`, [r.costoFinale, r.partecipante]);

            console.log(`✅ Salvato: ${r.nome} ha vinto ${r.slot} per ${r.costoFinale} crediti`);
        });

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

function aggiornaCreditiPartecipanti() {
    try {
        const partecipanti = queryAll("SELECT id, nome, crediti FROM partecipanti_fantagts");

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
app.post('/api/reset/:livello', (req, res) => {
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
                queryRun("DELETE FROM aste");
                queryRun("UPDATE partecipanti_fantagts SET crediti = 2000, punti_totali = 0");
                queryRun("UPDATE slots SET punti_totali = 0");

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
                queryRun("DELETE FROM aste");
                queryRun("DELETE FROM partecipanti_fantagts");
                queryRun("DELETE FROM squadre_circolo");
                queryRun("DELETE FROM slots");

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

// API per pulire dati di test
app.post('/api/pulisci-test', (req, res) => {
    const { mantieni } = req.body;

    try {
        if (!mantieni || mantieni.length === 0) {
            queryRun("DELETE FROM aste");
            queryRun("DELETE FROM partecipanti_fantagts");
        } else {
            const placeholders = mantieni.map(() => '?').join(',');
            queryRun(`DELETE FROM aste WHERE partecipante_id NOT IN (${placeholders})`, mantieni);
            queryRun(`DELETE FROM partecipanti_fantagts WHERE id NOT IN (${placeholders})`, mantieni);
        }

        gameState.connessi.clear();
        gameState.offerteTemporanee.clear();
        gameState.asteAttive = false;
        gameState.roundAttivo = null;

        res.json({
            message: mantieni && mantieni.length > 0 ?
                `Eliminati partecipanti di test, mantenuti: ${mantieni.join(', ')}` :
                'Tutti i partecipanti di test eliminati'
        });
    } catch (error) {
        console.error('Errore pulisci-test:', error);
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

// PWA Web Push Notifications API AGGIORNATA
app.post('/api/subscribe-notifications', (req, res) => {
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
        const result = queryRun(`INSERT OR REPLACE INTO push_subscriptions 
            (partecipante_id, endpoint, p256dh_key, auth_key, user_agent, last_seen, attiva) 
            VALUES (?, ?, ?, ?, ?, datetime('now'), 1)`,
            [partecipanteId, endpoint, keys.p256dh, keys.auth, userAgent]);

        console.log('✅ SUBSCRIPTION SALVATA - Result:', result);

        // VERIFICA IMMEDIATA
        const saved = queryGet("SELECT COUNT(*) as count FROM push_subscriptions WHERE partecipante_id = ?", [partecipanteId]);
        console.log('🔍 VERIFICA SALVATAGGIO:', saved);

        res.json({
            success: true,
            message: 'Notifiche attivate con successo',
            saved: saved?.count || 0
        });
    } catch (error) {
        console.error('❌ ERRORE SALVATAGGIO SUBSCRIPTION:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/send-notification', (req, res) => {
    try {
        const { title, body, url, targetUsers } = req.body;

        console.log('📤 Richiesta invio notifica:', { title, body, targetUsers });

        // Trova subscriptions attive
        let subscriptions;
        if (targetUsers && targetUsers.length > 0) {
            // Notifica a utenti specifici
            const placeholders = targetUsers.map(() => '?').join(',');
            subscriptions = queryAll(`SELECT * FROM push_subscriptions 
                WHERE partecipante_id IN (${placeholders}) AND attiva = 1`, targetUsers);
        } else {
            // Notifica a tutti
            subscriptions = queryAll("SELECT * FROM push_subscriptions WHERE attiva = 1");
        }

        console.log(`📨 Invio notifica a ${subscriptions.length} dispositivi`);

        // TODO: Implementare invio effettivo con web-push
        // Per ora solo log e conferma
        subscriptions.forEach(sub => {
            console.log(`📱 Notifica inviata a: ${sub.partecipante_id}`);
        });

        res.json({
            success: true,
            message: `Notifica inviata a ${subscriptions.length} dispositivi`,
            recipients: subscriptions.length
        });
    } catch (error) {
        console.error('Errore invio notifiche:', error);
        res.status(500).json({ error: error.message });
    }
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

    socket.on('place_bid', (data) => {
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
            const row = queryGet("SELECT crediti FROM partecipanti_fantagts WHERE id = ?", [connesso.partecipanteId]);

            if (!row) {
                socket.emit('bid_error', { message: 'Partecipante non trovato' });
                return;
            }

            if (data.importo > row.crediti) {
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

        console.log('\n🎾 FantaGTS Server Avviato!');

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
    saveDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔄 Terminazione server ricevuta...');
    saveDatabase();
    process.exit(0);
});