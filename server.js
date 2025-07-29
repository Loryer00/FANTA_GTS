// server.js - FantaGTS Server Completo
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

// Inizializza database
const dbPath = path.join(__dirname, 'data', 'fantagts.db');
const db = new sqlite3.Database(dbPath);

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
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (partecipante_id) REFERENCES partecipanti_fantagts(id),
        FOREIGN KEY (slot_id) REFERENCES slots(id)
    )`);

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

// Stato del gioco in memoria
let gameState = {
    fase: 'setup', // setup, aste, torneo, terminato
    roundAttivo: null,
    asteAttive: false,
    timer: null,
    tempoRimasto: 0,
    connessi: new Map(), // socketId -> {nome, tipo, stato}
    offerteTemporanee: new Map() // socketId -> {slot, offerta}
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
    const id = nome.toLowerCase().replace(/\s+/g, '_');
    
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
        tempoRimasto: gameState.tempoRimasto,
        connessi: Array.from(gameState.connessi.values())
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
    gameState.tempoRimasto = 30; // 30 secondi per le aste
    gameState.offerteTemporanee.clear();

    // Avvia timer
    gameState.timer = setInterval(() => {
        gameState.tempoRimasto--;
        io.emit('timer_update', gameState.tempoRimasto);
        
        if (gameState.tempoRimasto <= 0) {
            terminaRound();
        }
    }, 1000);

    // Ottieni slots disponibili per questo round
    db.all(`SELECT * FROM slots WHERE posizione = ? AND attivo = 1`, round, (err, slots) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        io.emit('round_started', {
            round: round,
            slots: slots,
            tempo: 30
        });

        res.json({ message: `Round ${round} avviato con successo` });
    });
});

function terminaRound() {
    if (gameState.timer) {
        clearInterval(gameState.timer);
        gameState.timer = null;
    }

    gameState.asteAttive = false;
    
    // Elabora risultati aste
    elaboraRisultatiAste();
}

function elaboraRisultatiAste() {
    const round = gameState.roundAttivo;
    
    // Raggruppa offerte per slot
    const offertePerSlot = {};
    gameState.offerteTemporanee.forEach((offerta, socketId) => {
        const connesso = gameState.connessi.get(socketId);
        if (connesso && offerta.round === round) {
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

    // Calcola ripetizioni necessarie
    db.get("SELECT COUNT(*) as count FROM partecipanti_fantagts", (err, result) => {
        if (err) {
            console.error('Errore conteggio partecipanti:', err);
            return;
        }

        const numPartecipanti = result.count;
        const ripetizioniPerCategoria = Math.floor(calcolaRipetizioniNecessarie(numPartecipanti) / 10);
        
        // Calcola totali per slot e ordina
        const slotConTotali = Object.keys(offertePerSlot).map(slotId => {
            const offerte = offertePerSlot[slotId];
            const totale = offerte.reduce((sum, o) => sum + o.offerta, 0);
            return { slotId, offerte, totale };
        }).sort((a, b) => b.totale - a.totale);

        // Seleziona slot da replicare
        const slotsReplicati = slotConTotali.slice(0, ripetizioniPerCategoria);
        const slotsUnici = slotConTotali.slice(ripetizioniPerCategoria);

        const risultati = [];

        // Elabora slots replicati
        slotsReplicati.forEach(item => {
            item.offerte.sort((a, b) => b.offerta - a.offerta);
            item.offerte.forEach((offerta, index) => {
                const premium = index > 0 ? 0.10 : 0;
                const costoFinale = index > 0 ? 
                    arrotondaAlPariPiuVicino(offerta.offerta * (1 + premium)) : 
                    offerta.offerta;

                risultati.push({
                    partecipante: offerta.partecipante,
                    nome: offerta.nome,
                    slot: item.slotId,
                    offertaOriginale: offerta.offerta,
                    costoFinale: costoFinale,
                    premium: premium,
                    condiviso: true
                });
            });
        });

        // Elabora slots unici
        slotsUnici.forEach(item => {
            const miglioreOfferta = item.offerte.sort((a, b) => b.offerta - a.offerta)[0];
            risultati.push({
                partecipante: miglioreOfferta.partecipante,
                nome: miglioreOfferta.nome,
                slot: item.slotId,
                offertaOriginale: miglioreOfferta.offerta,
                costoFinale: miglioreOfferta.offerta,
                premium: 0,
                condiviso: false
            });
        });

        // Salva risultati nel database
        salvaRisultatiAste(round, risultati);
        
        // Invia risultati ai client
        io.emit('round_ended', {
            round: round,
            risultati: risultati
        });

        gameState.roundAttivo = null;
        gameState.offerteTemporanee.clear();
    });
}

function salvaRisultatiAste(round, risultati) {
    const stmt = db.prepare(`INSERT INTO aste 
        (round, partecipante_id, slot_id, offerta, costo_finale, premium, vincitore) 
        VALUES (?, ?, ?, ?, ?, ?, 1)`);

    risultati.forEach(r => {
        stmt.run(round, r.partecipante, r.slot, r.offertaOriginale, r.costoFinale, r.premium);
        
        // Aggiorna crediti partecipante
        db.run(`UPDATE partecipanti_fantagts 
                SET crediti = crediti - ? 
                WHERE id = ?`, r.costoFinale, r.partecipante);
    });

    stmt.finalize();
}

// Reset sistema
app.post('/api/reset/:livello', (req, res) => {
    const livello = req.params.livello;
    
    // Ferma timer se attivo
    if (gameState.timer) {
        clearInterval(gameState.timer);
        gameState.timer = null;
    }

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
                
                // Ripristina crediti
                db.run("UPDATE partecipanti_fantagts SET crediti = 2000", (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    gameState.asteAttive = false;
                    gameState.roundAttivo = null;
                    gameState.offerteTemporanee.clear();
                    
                    res.json({ message: 'Tutte le aste resettate' });
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
                                timer: null,
                                tempoRimasto: 0,
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
                asteAttive: gameState.asteAttive,
                tempoRimasto: gameState.tempoRimasto
            }
        });

        // Aggiorna contatori connessi
        io.emit('connessi_update', Array.from(gameState.connessi.values()));
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