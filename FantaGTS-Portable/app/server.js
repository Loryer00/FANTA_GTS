// server.js - FantaGTS Server con SQLite3
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
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
try {
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('❌ Errore database:', err);
            db = new sqlite3.Database(':memory:', (err) => {
                if (err) {
                    console.error('❌ Errore database memoria:', err);
                } else {
                    console.log('⚠️ Usando database in memoria');
                    initializeDatabase();
                }
            });
        } else {
            console.log('✅ Database aperto correttamente dal percorso:', dbPath);
            initializeDatabase();
        }
    });
} catch (err) {
    console.error('❌ Errore database:', err);
}

// Inizializza struttura database
function initializeDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS squadre_circolo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero INTEGER UNIQUE,
            colore TEXT,
            m1 TEXT, m2 TEXT, m3 TEXT, m4 TEXT, m5 TEXT, m6 TEXT, m7 TEXT,
            f1 TEXT, f2 TEXT, f3 TEXT,
            attiva BOOLEAN DEFAULT 1
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS partecipanti_fantagts (
            id TEXT PRIMARY KEY,
            nome TEXT,
            email TEXT,
            telefono TEXT,
            crediti INTEGER DEFAULT 2000,
            punti_totali INTEGER DEFAULT 0,
            posizione_classifica INTEGER
        )`);

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

        db.run(`CREATE TABLE IF NOT EXISTS configurazione (
            chiave TEXT PRIMARY KEY,
            valore TEXT
        )`);

        // Aggiorna tabella aste per compatibilità
        db.run(`ALTER TABLE aste ADD COLUMN condiviso BOOLEAN DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.log('⚠️ Errore aggiunta colonna condiviso:', err.message);
            } else {
                console.log('✅ Colonna condiviso gestita correttamente');
            }
        });

        console.log('✅ Database inizializzato con successo');
    });
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
            db.all("SELECT * FROM squadre_circolo WHERE attiva = 1", (err, squadre) => {
                if (err) {
                    reject(err);
                    return;
                }

                const posizioni = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'F1', 'F2', 'F3'];
                
                // Cancella slots esistenti
                db.run("DELETE FROM slots", (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    let inserimenti = 0;
                    const totaleInserimenti = squadre.length * posizioni.length;

                    if (totaleInserimenti === 0) {
                        resolve(0);
                        return;
                    }

                    squadre.forEach(squadra => {
                        posizioni.forEach(pos => {
                            const slotId = `${pos}_${squadra.colore.toUpperCase()}`;
                            const giocatore = squadra[pos.toLowerCase()];
                            
                            db.run("INSERT INTO slots (id, squadra_numero, colore, posizione, giocatore_attuale) VALUES (?, ?, ?, ?, ?)", 
                                   [slotId, squadra.numero, squadra.colore, pos, giocatore], 
                                   (err) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                
                                inserimenti++;
                                if (inserimenti === totaleInserimenti) {
                                    resolve(inserimenti);
                                }
                            });
                        });
                    });
                });
            });
        } catch (error) {
            reject(error);
        }
    });
}

// Routes API

// Setup squadre circolo
app.get('/api/squadre', (req, res) => {
    db.all("SELECT * FROM squadre_circolo ORDER BY numero", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows || []);
        }
    });
});

app.get('/api/squadre-complete', (req, res) => {
    db.all("SELECT * FROM squadre_circolo WHERE attiva = 1 ORDER BY numero", (err, squadre) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        let processedCount = 0;
        const totalSquadre = squadre.length;

        if (totalSquadre === 0) {
            res.json([]);
            return;
        }

        squadre.forEach(squadra => {
            db.get("SELECT COUNT(*) as slots_count FROM slots WHERE squadra_numero = ?", [squadra.numero], (err, result) => {
                squadra.slots_generati = result ? result.slots_count : 0;
                processedCount++;
                
                if (processedCount === totalSquadre) {
                    res.json(squadre);
                }
            });
        });
    });
});

app.post('/api/squadre', (req, res) => {
    const { numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3 } = req.body;
    
    db.run(`INSERT OR REPLACE INTO squadre_circolo 
        (numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3], 
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json({ id: this.lastID, message: 'Squadra salvata con successo' });
            }
        });
});

app.delete('/api/squadre/:numero', (req, res) => {
    db.run("DELETE FROM squadre_circolo WHERE numero = ?", [req.params.numero], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: 'Squadra eliminata con successo' });
        }
    });
});

// Setup partecipanti
app.get('/api/partecipanti', (req, res) => {
    db.all("SELECT * FROM partecipanti_fantagts ORDER BY nome", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows || []);
        }
    });
});

app.post('/api/partecipanti', (req, res) => {
    const { nome, email, telefono, crediti = 2000 } = req.body;
    const id = nome.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    
    db.run(`INSERT OR REPLACE INTO partecipanti_fantagts 
        (id, nome, email, telefono, crediti) VALUES (?, ?, ?, ?, ?)`, 
        [id, nome, email, telefono, crediti], 
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json({ id: id, message: 'Partecipante registrato con successo' });
            }
        });
});

app.delete('/api/partecipanti/:id', (req, res) => {
    db.run("DELETE FROM partecipanti_fantagts WHERE id = ?", [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: 'Partecipante eliminato con successo' });
        }
    });
});

// Generazione slots
app.post('/api/genera-slots', async (req, res) => {
    try {
        const result = await generaSlots();
        res.json({ message: 'Slots generati con successo', count: result });
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
    db.get("SELECT * FROM slots WHERE id = ?", [slotId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (!row) {
            res.status(404).json({ error: 'Slot non trovato' });
        } else {
            res.json(row);
        }
    });
});

// Ottieni squadra di un partecipante
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
        ORDER BY s.posizione`, [partecipanteId], (err, rows) => {
        if (err) {
            console.error('Errore query squadra partecipante:', err);
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows || []);
        }
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

    db.all("SELECT * FROM slots WHERE posizione = ? AND attivo = 1", [round], (err, slots) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        io.emit('round_started', {
            round: round,
            slots: slots,
            sistema: 'conferme'
        });

        console.log(`Round ${round} avviato - Sistema basato su conferme`);
        res.json({ message: `Round ${round} avviato con successo` });
        
        avviaMonitoraggioOfferte();
    });
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
    const round = req.params.round;
    
    db.all(`SELECT a.*, p.nome as partecipante_nome, s.giocatore_attuale, s.colore 
            FROM aste a 
            JOIN partecipanti_fantagts p ON a.partecipante_id = p.id 
            JOIN slots s ON a.slot_id = s.id 
            WHERE a.round = ? AND a.vincitore = 1 
            ORDER BY a.costo_finale DESC`, [round], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows || []);
        }
    });
});

// Ottieni tutti i risultati partite
app.get('/api/risultati-partite', (req, res) => {
    db.all(`SELECT r.*, 
            s1.colore as squadra_1_colore, s2.colore as squadra_2_colore
            FROM risultati_partite r 
            JOIN squadre_circolo s1 ON r.squadra_1 = s1.numero 
            JOIN squadre_circolo s2 ON r.squadra_2 = s2.numero 
            ORDER BY r.turno DESC, r.timestamp DESC`, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            // Parse JSON vincitori
            const processedRows = (rows || []).map(row => {
                try {
                    row.vincitori = JSON.parse(row.vincitori || '[]');
                } catch (e) {
                    row.vincitori = [];
                }
                return row;
            });
            res.json(processedRows);
        }
    });
});

// Ottieni classifica generale
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
            res.status(500).json({ error: err.message });
        } else {
            // Aggiungi posizione in classifica
            const classifica = (rows || []).map((row, index) => {
                row.posizione = index + 1;
                return row;
            });

            console.log('✅ Classifica caricata:', classifica.length, 'partecipanti');
            res.json(classifica);
        }
    });
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

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        let completati = 0;
        const totale = risultati.length;

        risultati.forEach(r => {
            db.run(`INSERT INTO aste 
                (round, partecipante_id, slot_id, offerta, costo_finale, premium, vincitore, condiviso) 
                VALUES (?, ?, ?, ?, ?, ?, 1, ?)`, 
                [round, r.partecipante, r.slot, r.offertaOriginale, r.costoFinale, r.premium, r.condiviso ? 1 : 0], 
                function(err) {
                    if (err) {
                        db.run("ROLLBACK");
                        console.error('❌ Errore salvataggio asta:', err);
                        return;
                    }
                    
                    // Aggiorna crediti partecipante
                    db.run(`UPDATE partecipanti_fantagts 
                            SET crediti = crediti - ? 
                            WHERE id = ?`, [r.costoFinale, r.partecipante], (err) => {
                        if (err) {
                            db.run("ROLLBACK");
                            console.error('❌ Errore aggiornamento crediti:', err);
                            return;
                        }

                        completati++;
                        console.log(`✅ Salvato: ${r.nome} ha vinto ${r.slot} per ${r.costoFinale} crediti`);
                        
                        if (completati === totale) {
                            db.run("COMMIT", (err) => {
                                if (err) {
                                    console.error('❌ Errore commit transazione:', err);
                                } else {
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
                                }
                            });
                        }
                    });
                });
        });
    });
}

function aggiornaCreditiPartecipanti() {
    db.all("SELECT id, nome, crediti FROM partecipanti_fantagts", (err, partecipanti) => {
        if (err) {
            console.error('Errore aggiornamento crediti:', err);
            return;
        }

        (partecipanti || []).forEach(p => {
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
    const { mantieni } = req.body;

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        if (!mantieni || mantieni.length === 0) {
            db.run("DELETE FROM aste", (err) => {
                if (err) {
                    db.run("ROLLBACK");
                    res.status(500).json({ error: err.message });
                    return;
                }
                
                db.run("DELETE FROM partecipanti_fantagts", (err) => {
                    if (err) {
                        db.run("ROLLBACK");
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    
                    db.run("COMMIT", (err) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                        } else {
                            gameState.connessi.clear();
                            gameState.offerteTemporanee.clear();
                            gameState.asteAttive = false;
                            gameState.roundAttivo = null;
                            res.json({ message: 'Tutti i partecipanti di test eliminati' });
                        }
                    });
                });
            });
        } else {
            const placeholders = mantieni.map(() => '?').join(',');
            db.run(`DELETE FROM aste WHERE partecipante_id NOT IN (${placeholders})`, mantieni, (err) => {
                if (err) {
                    db.run("ROLLBACK");
                    res.status(500).json({ error: err.message });
                    return;
                }
                
                db.run(`DELETE FROM partecipanti_fantagts WHERE id NOT IN (${placeholders})`, mantieni, (err) => {
                    if (err) {
                        db.run("ROLLBACK");
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    
                    db.run("COMMIT", (err) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                        } else {
                            gameState.connessi.clear();
                            gameState.offerteTemporanee.clear();
                            gameState.asteAttive = false;
                            gameState.roundAttivo = null;
                            res.json({ message: `Eliminati partecipanti di test, mantenuti: ${mantieni.join(', ')}` });
                        }
                    });
                });
            });
        }
    });
});

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
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    
                    db.run("DELETE FROM aste", (err) => {
                        if (err) {
                            db.run("ROLLBACK");
                            res.status(500).json({ error: err.message });
                            return;
                        }
                        
                        db.run("UPDATE partecipanti_fantagts SET crediti = 2000, punti_totali = 0", (err) => {
                            if (err) {
                                db.run("ROLLBACK");
                                res.status(500).json({ error: err.message });
                                return;
                            }
                            
                            db.run("UPDATE slots SET punti_totali = 0", (err) => {
                                if (err) {
                                    db.run("ROLLBACK");
                                    res.status(500).json({ error: err.message });
                                    return;
                                }
                                
                                db.run("COMMIT", (err) => {
                                    if (err) {
                                        res.status(500).json({ error: err.message });
                                    } else {
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
                                    }
                                });
                            });
                        });
                    });
                });
                break;
                
            case 'totale':
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    
                    const tables = ['aste', 'partecipanti_fantagts', 'squadre_circolo', 'slots'];
                    let deletedTables = 0;
                    
                    tables.forEach(table => {
                        db.run(`DELETE FROM ${table}`, (err) => {
                            if (err) {
                                db.run("ROLLBACK");
                                res.status(500).json({ error: err.message });
                                return;
                            }
                            
                            deletedTables++;
                            if (deletedTables === tables.length) {
                                db.run("COMMIT", (err) => {
                                    if (err) {
                                        res.status(500).json({ error: err.message });
                                    } else {
                                        gameState = {
                                            fase: 'setup',
                                            roundAttivo: null,
                                            asteAttive: false,
                                            connessi: new Map(),
                                            offerteTemporanee: new Map()
                                        };
                                        res.json({ message: 'Sistema completamente resettato' });
                                    }
                                });
                            }
                        });
                    });
                });
                break;
                
            default:
                res.status(400).json({ error: 'Livello reset non valido' });
        }
    } catch (error) {
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

// PWA Web Push Notifications API
app.post('/api/subscribe-notifications', (req, res) => {
    const { subscription, partecipanteId } = req.body;
    console.log('📨 Nuova subscription push:', partecipanteId);
    res.json({ success: true, message: 'Notifiche attivate' });
});

app.post('/api/send-notification', (req, res) => {
    const { title, body, url, targetUsers } = req.body;
    console.log('📤 Invio notifica:', { title, body, targetUsers });
    res.json({ success: true, message: 'Notifica inviata' });
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
        db.get("SELECT crediti FROM partecipanti_fantagts WHERE id = ?", [connesso.partecipanteId], (err, row) => {
            if (err) {
                console.error('Errore verifica crediti:', err);
                socket.emit('bid_error', { message: 'Errore del server' });
                return;
            }

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
        });
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

// Gestione errori
process.on('uncaughtException', (err) => {
    console.error('Errore critico:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection:', reason);
});

// Chiusura pulita del database
process.on('SIGINT', () => {
    console.log('\n🔄 Chiusura server in corso...');
    
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Errore chiusura database:', err);
            } else {
                console.log('✅ Database chiuso correttamente');
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

process.on('SIGTERM', () => {
    console.log('\n🔄 Terminazione server ricevuta...');
    
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Errore chiusura database:', err);
            } else {
                console.log('✅ Database chiuso correttamente');
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});