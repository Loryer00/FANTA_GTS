// server.js - FantaGTS Server SENZA TIMER
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

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
console.log('🔍 Percorso database:', path.join(__dirname, 'data', 'fantagts.db'));
console.log('🔍 Database esiste?', fs.existsSync(path.join(__dirname, 'data', 'fantagts.db')));

// Inizializza database
const dbPath = path.join(__dirname, '..', 'data', 'fantagts.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Errore specifico database:', err);
        console.log('🔍 Tentativo con percorso assoluto...');
    } else {
        console.log('✅ Database aperto correttamente dal percorso:', dbPath);
    }
});

// Crea tabelle se non esistono
db.serialize(() => {
    // Tabella squadre circolo
    db.run(`CREATE TABLE IF NOT EXISTS squadre_circolo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero INTEGER UNIQUE,
        colore TEXT,
        m1 TEXT, m2 TEXT, m3 TEXT, m4 TEXT, m5 TEXT, m6 TEXT, m7 TEXT,
        f1 TEXT, f2 TEXT, f3 TEXT,
        attiva BOOLEAN DEFAULT 1
    )`);

    // Tabella partecipanti FantaGTS
    db.run(`CREATE TABLE IF NOT EXISTS partecipanti_fantagts (
        id TEXT PRIMARY KEY,
        nome TEXT,
        email TEXT,
        telefono TEXT,
        crediti INTEGER DEFAULT 2000,
        punti_totali INTEGER DEFAULT 0,
        posizione_classifica INTEGER
    )`);

    // Tabella slots (posizioni nelle squadre)
    db.run(`CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        squadra_numero INTEGER,
        colore TEXT,
        posizione TEXT,
        giocatore_attuale TEXT,
        punti_totali INTEGER DEFAULT 0,
        attivo BOOLEAN DEFAULT 1,
        FOREIGN KEY (squadra_numero) REFERENCES squadre_circolo(numero)
    )`);

    // Tabella aste
    db.run(`CREATE TABLE IF NOT EXISTS aste (
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
	
	// Aggiorna tabella aste esistente per compatibilità
db.run(`ALTER TABLE aste ADD COLUMN condiviso BOOLEAN DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.log('⚠️ Colonna condiviso già presente o errore:', err.message);
    } else if (!err) {
        console.log('✅ Colonna condiviso aggiunta alla tabella aste');
    }
});

    // Tabella sostituzioni
    db.run(`CREATE TABLE IF NOT EXISTS sostituzioni (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_id TEXT,
        giocatore_vecchio TEXT,
        giocatore_nuovo TEXT,
        dal_turno INTEGER,
        motivo TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (slot_id) REFERENCES slots(id)
    )`);

    // Tabella risultati partite
    db.run(`CREATE TABLE IF NOT EXISTS risultati_partite (
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

    // Tabella configurazione
    db.run(`CREATE TABLE IF NOT EXISTS configurazione (
        chiave TEXT PRIMARY KEY,
        valore TEXT
    )`);

    console.log('✅ Database inizializzato con successo');
});

// Stato del gioco in memoria (SENZA TIMER)
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
        // decimale == 0.5 → va al pari più vicino
        if (intero % 2 === 0) {
            return intero; // intero è già pari
        } else {
            return intero + 1; // intero è dispari, va al pari successivo
        }
    }
}

function calcolaRipetizioniNecessarie(numPartecipanti) {
    const giocatoriNecessari = numPartecipanti * 10;
    const giocatoriDisponibili = 160; // 16 squadre × 10 giocatori
    return Math.max(0, giocatoriNecessari - giocatoriDisponibili);
}

function generaSlots() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM squadre_circolo WHERE attiva = 1", (err, squadre) => {
            if (err) return reject(err);

            const posizioni = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'F1', 'F2', 'F3'];
            
            // Cancella slots esistenti
            db.run("DELETE FROM slots", (err) => {
                if (err) return reject(err);

                const stmt = db.prepare("INSERT INTO slots (id, squadra_numero, colore, posizione, giocatore_attuale) VALUES (?, ?, ?, ?, ?)");
                
                squadre.forEach(squadra => {
                    posizioni.forEach(pos => {
                        const slotId = `${pos}_${squadra.colore.toUpperCase()}`;
                        const giocatore = squadra[pos.toLowerCase()];
                        stmt.run(slotId, squadra.numero, squadra.colore, pos, giocatore);
                    });
                });

                stmt.finalize();
                resolve();
            });
        });
    });
}

// Routes API

// Setup squadre circolo
app.get('/api/squadre', (req, res) => {
    db.all("SELECT * FROM squadre_circolo ORDER BY numero", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/squadre-complete', (req, res) => {
    db.all(`SELECT * FROM squadre_circolo WHERE attiva = 1 ORDER BY numero`, (err, squadre) => {
        if (err) return res.status(500).json({ error: err.message });

        // Per ogni squadra, ottieni anche il numero di slots generati
        const promises = squadre.map(squadra => {
            return new Promise((resolve) => {
                db.all(`SELECT COUNT(*) as slots_count FROM slots WHERE squadra_numero = ?`,
                    squadra.numero, (err, result) => {
                        squadra.slots_generati = err ? 0 : result[0].slots_count;
                        resolve(squadra);
                    });
            });
        });

        Promise.all(promises).then(risultati => {
            res.json(risultati);
        });
    });
});

app.post('/api/squadre', (req, res) => {
    const { numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3 } = req.body;
    
    const stmt = db.prepare(`INSERT OR REPLACE INTO squadre_circolo 
        (numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    
    stmt.run(numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: 'Squadra salvata con successo' });
    });
});

app.delete('/api/squadre/:numero', (req, res) => {
    db.run("DELETE FROM squadre_circolo WHERE numero = ?", req.params.numero, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Squadra eliminata con successo' });
    });
});

// Setup partecipanti
app.get('/api/partecipanti', (req, res) => {
    db.all("SELECT * FROM partecipanti_fantagts ORDER BY nome", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/partecipanti', (req, res) => {
    const { nome, email, telefono, crediti = 2000 } = req.body;
    const id = nome.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    
    const stmt = db.prepare(`INSERT OR REPLACE INTO partecipanti_fantagts 
        (id, nome, email, telefono, crediti) VALUES (?, ?, ?, ?, ?)`);
    
    stmt.run(id, nome, email, telefono, crediti, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: id, message: 'Partecipante registrato con successo' });
    });
});

app.delete('/api/partecipanti/:id', (req, res) => {
    db.run("DELETE FROM partecipanti_fantagts WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Partecipante eliminato con successo' });
    });
});

// Generazione slots
app.post('/api/genera-slots', async (req, res) => {
    try {
        await generaSlots();
        res.json({ message: 'Slots generati con successo' });
    } catch (err) {
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
    const slotId = req.params.slotId;
    
    db.get("SELECT * FROM slots WHERE id = ?", slotId, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Slot non trovato' });
        
        res.json(row);
    });
});

// NUOVO ENDPOINT: Ottieni squadra di un partecipante
app.get('/api/squadra-partecipante/:partecipanteId', (req, res) => {
    const partecipanteId = req.params.partecipanteId;
    
    db.all(`SELECT 
        a.slot_id,
        a.costo_finale,
        s.posizione,
        s.giocatore_attuale,
        s.colore,
        s.punti_totali
        FROM aste a 
        JOIN slots s ON a.slot_id = s.id 
        WHERE a.partecipante_id = ? AND a.vincitore = 1 
        ORDER BY s.posizione`, partecipanteId, (err, rows) => {
        
        if (err) {
            console.error('Errore query squadra partecipante:', err);
            return res.status(500).json({ error: err.message });
        }
        
        res.json(rows);
    });
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

    // Ottieni slots disponibili per questo round
    db.all(`SELECT * FROM slots WHERE posizione = ? AND attivo = 1`, round, (err, slots) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        io.emit('round_started', {
            round: round,
            slots: slots,
            sistema: 'conferme' // Indica che è basato su conferme, non timer
        });

        console.log(`Round ${round} avviato - Sistema basato su conferme di tutti i partecipanti`);
        res.json({ message: `Round ${round} avviato con successo` });
        
        // Inizia monitoraggio offerte
        avviaMonitoraggioOfferte();
    });
});

// API per controllare se tutti hanno fatto offerte
app.get('/api/stato-offerte/:round', (req, res) => {
    const round = req.params.round;
    
    // Conta partecipanti connessi di tipo 'partecipante'
    const partecipantiConnessi = Array.from(gameState.connessi.values())
        .filter(p => p.tipo === 'partecipante').length;
    
    // Conta offerte per questo round
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

// NUOVO ENDPOINT: Ottieni risultati aste per round specifico
app.get('/api/aste-round/:round', (req, res) => {
    const round = req.params.round;
    
    db.all(`SELECT a.*, p.nome as partecipante_nome, s.giocatore_attuale, s.colore 
            FROM aste a 
            JOIN partecipanti_fantagts p ON a.partecipante_id = p.id 
            JOIN slots s ON a.slot_id = s.id 
            WHERE a.round = ? AND a.vincitore = 1 
            ORDER BY a.costo_finale DESC`, round, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// NUOVO ENDPOINT: Ottieni tutti i risultati partite
app.get('/api/risultati-partite', (req, res) => {
    db.all(`SELECT r.*, 
            s1.colore as squadra_1_colore, s2.colore as squadra_2_colore
            FROM risultati_partite r 
            JOIN squadre_circolo s1 ON r.squadra_1 = s1.numero 
            JOIN squadre_circolo s2 ON r.squadra_2 = s2.numero 
            ORDER BY r.turno DESC, r.timestamp DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Parse JSON vincitori
        rows.forEach(row => {
            try {
                row.vincitori = JSON.parse(row.vincitori || '[]');
            } catch (e) {
                row.vincitori = [];
            }
        });
        
        res.json(rows);
    });
});

// NUOVO ENDPOINT: Ottieni classifica generale
app.get('/api/classifica', (req, res) => {
    db.all(`SELECT 
        p.id, p.nome, p.crediti, 
        COUNT(a.id) as giocatori_totali,
        COALESCE(SUM(s.punti_totali), 0) as punti_totali,
        COALESCE(SUM(a.costo_finale), 0) as crediti_spesi
        FROM partecipanti_fantagts p 
        LEFT JOIN aste a ON p.id = a.partecipante_id AND a.vincitore = 1
        LEFT JOIN slots s ON a.slot_id = s.id 
        GROUP BY p.id, p.nome, p.crediti 
        ORDER BY punti_totali DESC, crediti_spesi ASC`, (err, rows) => {

        if (err) {
            console.error('❌ Errore query classifica:', err);
            return res.status(500).json({ error: err.message });
        }

        // Aggiungi posizione in classifica
        rows.forEach((row, index) => {
            row.posizione = index + 1;
        });

        console.log('✅ Classifica caricata:', rows.length, 'partecipanti');
        res.json(rows);
    });
});

// NUOVO: Monitoraggio automatico offerte
function avviaMonitoraggioOfferte() {
    const monitorInterval = setInterval(() => {
        if (!gameState.asteAttive) {
            clearInterval(monitorInterval);
            return;
        }

        // Controlla se tutti hanno offerto
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

        // Invia aggiornamento a tutti i client
        io.emit('offerte_update', statoOfferte);

        // Auto-chiusura se tutti hanno offerto (INCLUSO 1 SOLO PARTECIPANTE)
        if (statoOfferte.tuttiHannoOfferto && partecipantiConnessi > 0) {
            console.log(`🎉 ${partecipantiConnessi} partecipante(i) hanno fatto offerte - chiusura automatica round`);
            clearInterval(monitorInterval);

            // Chiusura immediata (no timeout problematico)
            if (gameState.asteAttive) {
                console.log('🔄 Avviando elaborazione risultati...');
                terminaRound();
            }
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

function terminaRound() {
    if (gameState.asteAttive === false) return; // Già terminato

    gameState.asteAttive = false;
    gameState.gamePhase = 'results';

    // Elabora risultati aste
    elaboraRisultatiAste();
}

function elaboraRisultatiAste() {
    const round = gameState.roundAttivo;
    console.log(`🔄 Elaborando risultati per round ${round}...`);
    
    // Raggruppa offerte per slot
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

    // SEMPLIFICATO: Per ora vince sempre chi offre di più, senza condivisione
    const risultati = [];
    
    Object.keys(offertePerSlot).forEach(slotId => {
        const offerte = offertePerSlot[slotId];
        
        if (offerte.length > 0) {
            // Ordina per offerta decrescente
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

    // Salva risultati nel database
    if (risultati.length > 0) {
        salvaRisultatiAste(round, risultati);
    } else {
        console.log('⚠️ Nessun risultato da salvare per il round', round);
        // Comunque termina il round
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

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        const stmt = db.prepare(`INSERT INTO aste 
            (round, partecipante_id, slot_id, offerta, costo_finale, premium, vincitore, condiviso) 
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)`);

        let completati = 0;
        const totale = risultati.length;

        risultati.forEach(r => {
            stmt.run(round, r.partecipante, r.slot, r.offertaOriginale, r.costoFinale, r.premium, r.condiviso ? 1 : 0, function(err) {
                if (err) {
                    console.error('Errore inserimento asta:', err);
                    db.run("ROLLBACK");
                    return;
                }
                
                // Aggiorna crediti partecipante
                db.run(`UPDATE partecipanti_fantagts 
                        SET crediti = crediti - ? 
                        WHERE id = ?`, r.costoFinale, r.partecipante, function(err) {
                    if (err) {
                        console.error('Errore aggiornamento crediti:', err);
                        db.run("ROLLBACK");
                        return;
                    }

                    completati++;
                    console.log(`✅ Salvato: ${r.nome} ha vinto ${r.slot} per ${r.costoFinale} crediti`);
                    
                    if (completati === totale) {
    stmt.finalize();
    db.run("COMMIT");
    console.log(`🎉 Round ${round} completato - ${totale} assegnazioni salvate nel database`);
    
    // PRIMA: Reset stato del gioco
    gameState.roundAttivo = null;
    gameState.asteAttive = false;
    gameState.offerteTemporanee.clear();
    
    // POI: Invia risultati ai client
    console.log('📤 Invio risultati ai client:', risultati);
    io.emit('round_ended', {
        round: round,
        risultati: risultati,
        success: true
    });
    
    // INFINE: Aggiorna crediti
    aggiornaCreditiPartecipanti();
}
                });
            });
        });
    });
}

// Funzione per inviare crediti aggiornati ai client
function aggiornaCreditiPartecipanti() {
    db.all("SELECT id, nome, crediti FROM partecipanti_fantagts", (err, partecipanti) => {
        if (err) {
            console.error('Errore caricamento partecipanti:', err);
            return;
        }

        partecipanti.forEach(p => {
            // Trova il socket del partecipante e invia crediti aggiornati
            for (let [socketId, connesso] of gameState.connessi.entries()) {
                if (connesso.partecipanteId === p.id) {
                    io.to(socketId).emit('crediti_aggiornati', {
                        crediti: p.crediti
                    });
                    break;
                }
            }
        });
    });
}

// API per pulire dati di test
app.post('/api/pulisci-test', (req, res) => {
    const { mantieni } = req.body; // Array di IDs da mantenere

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // Se non ci sono partecipanti da mantenere, elimina tutto
        if (!mantieni || mantieni.length === 0) {
            db.run("DELETE FROM aste", (err) => {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                }

                db.run("DELETE FROM partecipanti_fantagts", (err) => {
                    if (err) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err.message });
                    }

                    db.run("COMMIT");

                    // Reset stato del gioco
                    gameState.connessi.clear();
                    gameState.offerteTemporanee.clear();
                    gameState.asteAttive = false;
                    gameState.roundAttivo = null;

                    res.json({ message: 'Tutti i partecipanti di test eliminati' });
                });
            });
        } else {
            // Elimina solo i partecipanti non nella lista "mantieni"
            const placeholders = mantieni.map(() => '?').join(',');

            // Prima elimina le aste dei partecipanti da rimuovere
            db.run(`DELETE FROM aste WHERE partecipante_id NOT IN (${placeholders})`, mantieni, (err) => {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                }

                // Poi elimina i partecipanti
                db.run(`DELETE FROM partecipanti_fantagts WHERE id NOT IN (${placeholders})`, mantieni, (err) => {
                    if (err) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err.message });
                    }

                    db.run("COMMIT");
                    res.json({ message: `Eliminati partecipanti di test, mantenuti: ${mantieni.join(', ')}` });
                });
            });
        }
    });
});

// API per creare nuova sessione annuale
app.post('/api/nuova-sessione', (req, res) => {
    const { anno, descrizione } = req.body;

    if (!anno) {
        return res.status(400).json({ error: 'Anno richiesto' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // Backup della sessione precedente se esistono dati
        db.get("SELECT COUNT(*) as count FROM partecipanti_fantagts", (err, row) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }

            if (row.count > 0) {
                // Crea tabelle di backup con timestamp
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const suffix = `_backup_${anno}_${timestamp}`;

                db.run(`CREATE TABLE partecipanti_fantagts${suffix} AS SELECT * FROM partecipanti_fantagts`, (err) => {
                    if (err) console.log('Errore backup partecipanti:', err);
                });

                db.run(`CREATE TABLE aste${suffix} AS SELECT * FROM aste`, (err) => {
                    if (err) console.log('Errore backup aste:', err);
                });

                db.run(`CREATE TABLE squadre_circolo${suffix} AS SELECT * FROM squadre_circolo`, (err) => {
                    if (err) console.log('Errore backup squadre:', err);
                });
            }

            // Pulisci tutte le tabelle per la nuova sessione
            db.run("DELETE FROM aste", () => {
                db.run("DELETE FROM partecipanti_fantagts", () => {
                    db.run("DELETE FROM squadre_circolo", () => {
                        db.run("DELETE FROM slots", () => {
                            db.run("DELETE FROM risultati_partite", () => {

                                // Inserisci metadata della nuova sessione
                                db.run(`INSERT OR REPLACE INTO configurazione (chiave, valore) VALUES 
                                    ('sessione_anno', ?),
                                    ('sessione_descrizione', ?),
                                    ('sessione_data_inizio', ?)`,
                                    [anno, descrizione || `FantaGTS ${anno}`, new Date().toISOString()], (err) => {

                                        if (err) {
                                            db.run("ROLLBACK");
                                            return res.status(500).json({ error: err.message });
                                        }

                                        db.run("COMMIT");

                                        // Reset completo stato del gioco
                                        gameState = {
                                            fase: 'setup',
                                            roundAttivo: null,
                                            asteAttive: false,
                                            connessi: new Map(),
                                            offerteTemporanee: new Map()
                                        };

                                        res.json({
                                            message: `Nuova sessione ${anno} creata con successo`,
                                            redirectTo: '/setup'
                                        });
                                    });
                            });
                        });
                    });
                });
            });
        });
    });
});

// API per ottenere info sessione corrente
app.get('/api/sessione-info', (req, res) => {
    db.all("SELECT * FROM configurazione WHERE chiave LIKE 'sessione_%'", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const sessionInfo = {};
        rows.forEach(row => {
            sessionInfo[row.chiave] = row.valore;
        });

        res.json(sessionInfo);
    });
});

// Reset sistema
app.post('/api/reset/:livello', (req, res) => {
    const livello = req.params.livello;

    switch (livello) {
        case 'round':
            gameState.asteAttive = false;
            gameState.roundAttivo = null;
            gameState.offerteTemporanee.clear();
            res.json({ message: 'Round resettato' });
            break;
            
        case 'aste':
            db.run("DELETE FROM aste", (err) => {
                if (err) return res.status(500).json({ error: err.message });

                // Ripristina crediti E resetta anche i punti totali
                db.run("UPDATE partecipanti_fantagts SET crediti = 2000, punti_totali = 0", (err) => {
                    if (err) return res.status(500).json({ error: err.message });

                    // Reset anche gli slots (rimuovi punti accumulati)
                    db.run("UPDATE slots SET punti_totali = 0", (err) => {
                        if (err) console.error('Errore reset punti slots:', err);

                        // RESET COMPLETO DELLO STATO DEL GIOCO
                        gameState.asteAttive = false;
                        gameState.roundAttivo = null;
                        gameState.offerteTemporanee.clear();
                        gameState.fase = 'setup'; // Torna alla fase setup

                        console.log('🔄 Reset aste completato - inviando notifica ai client');

                        // Notifica tutti i client del reset (incluso Master)
                        io.emit('aste_resettate', {
                            message: 'Le aste sono state resettate',
                            creditiRipristinati: 2000,
                            resetCompleto: true
                        });

                        // NUOVO: Notifica specifica per il Master per resettare UI
                        io.emit('master_reset_ui', {
                            message: 'Reset interfaccia Master',
                            resetRounds: true
                        });

                        res.json({ message: 'Tutte le aste resettate' });
                    });
                });
            });
            break;
            
        case 'totale':
            db.run("DELETE FROM aste", () => {
                db.run("DELETE FROM partecipanti_fantagts", () => {
                    db.run("DELETE FROM squadre_circolo", () => {
                        db.run("DELETE FROM slots", () => {
                            gameState = {
                                fase: 'setup',
                                roundAttivo: null,
                                asteAttive: false,
                                connessi: new Map(),
                                offerteTemporanee: new Map()
                            };
                            res.json({ message: 'Sistema completamente resettato' });
                        });
                    });
                });
            });
            break;
            
        default:
            res.status(400).json({ error: 'Livello reset non valido' });
    }
});

// Gestione WebSocket
io.on('connection', (socket) => {
    console.log('Nuova connessione:', socket.id);

    socket.on('register', (data) => {
        gameState.connessi.set(socket.id, {
            nome: data.nome,
            tipo: data.tipo, // 'partecipante', 'master', 'spettatore'
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

        // Aggiorna contatori connessi
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
        db.get("SELECT crediti FROM partecipanti_fantagts WHERE id = ?", 
               connesso.partecipanteId, (err, row) => {
            if (err || !row) {
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
        });
    });

    socket.on('disconnect', () => {
        gameState.connessi.delete(socket.id);
        gameState.offerteTemporanee.delete(socket.id);
        io.emit('connessi_update', Array.from(gameState.connessi.values()));
        console.log('Disconnesso:', socket.id);
    });
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

// Avvio server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n🎾 FantaGTS Server Avviato!');
    console.log(`📱 Client: http://localhost:${PORT}`);
    console.log(`⚙️  Setup: http://localhost:${PORT}/setup`);
    console.log(`🎮 Master: http://localhost:${PORT}/master`);
    console.log(`🔗 Rete locale: http://[TUO_IP]:${PORT}`);
    console.log('\n✅ Sistema pronto per la configurazione!');
});

// Gestione errori
process.on('uncaughtException', (err) => {
    console.error('Errore critico:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection:', reason);
});