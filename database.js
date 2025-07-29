// database.js - Funzioni gestione database FantaGTS
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class FantaGTSDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, 'data', 'fantagts.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.initDatabase();
    }

    initDatabase() {
        this.db.serialize(() => {
            // Crea tabelle con vincoli di integrità
            this.db.run(`CREATE TABLE IF NOT EXISTS squadre_circolo (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                numero INTEGER UNIQUE NOT NULL,
                colore TEXT NOT NULL,
                m1 TEXT, m2 TEXT, m3 TEXT, m4 TEXT, m5 TEXT, m6 TEXT, m7 TEXT,
                f1 TEXT, f2 TEXT, f3 TEXT,
                attiva BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS partecipanti_fantagts (
                id TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                email TEXT,
                telefono TEXT,
                crediti INTEGER DEFAULT 2000,
                punti_totali INTEGER DEFAULT 0,
                posizione_classifica INTEGER,
                attivo BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS slots (
                id TEXT PRIMARY KEY,
                squadra_numero INTEGER NOT NULL,
                colore TEXT NOT NULL,
                posizione TEXT NOT NULL,
                giocatore_attuale TEXT,
                punti_totali INTEGER DEFAULT 0,
                attivo BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (squadra_numero) REFERENCES squadre_circolo(numero)
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS aste (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                round TEXT NOT NULL,
                partecipante_id TEXT NOT NULL,
                slot_id TEXT NOT NULL,
                offerta INTEGER NOT NULL,
                costo_finale INTEGER NOT NULL,
                premium REAL DEFAULT 0,
                vincitore BOOLEAN DEFAULT 0,
                condiviso BOOLEAN DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (partecipante_id) REFERENCES partecipanti_fantagts(id),
                FOREIGN KEY (slot_id) REFERENCES slots(id)
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS sostituzioni (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slot_id TEXT NOT NULL,
                giocatore_vecchio TEXT NOT NULL,
                giocatore_nuovo TEXT NOT NULL,
                dal_turno INTEGER,
                motivo TEXT,
                approvato BOOLEAN DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (slot_id) REFERENCES slots(id)
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS risultati_partite (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                turno INTEGER NOT NULL,
                squadra_1 INTEGER NOT NULL,
                squadra_2 INTEGER NOT NULL,
                risultato TEXT, -- es: "1-0", "0-1", "1-1"
                vincitori TEXT, -- JSON array degli ID giocatori vincitori
                inserito_da TEXT,
                verificato BOOLEAN DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (squadra_1) REFERENCES squadre_circolo(numero),
                FOREIGN KEY (squadra_2) REFERENCES squadre_circolo(numero)
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS configurazione (
                chiave TEXT PRIMARY KEY,
                valore TEXT,
                descrizione TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS backup_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT, -- 'auto', 'manuale', 'pre_reset'
                filename TEXT,
                dimensione INTEGER,
                descrizione TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Inserisci configurazione predefinita
            this.db.run(`INSERT OR IGNORE INTO configurazione (chiave, valore, descrizione) VALUES 
                ('crediti_iniziali', '2000', 'Crediti iniziali per ogni partecipante'),
                ('durata_asta_secondi', '30', 'Durata di ogni round di aste'),
                ('premium_condivisione', '0.10', 'Premium percentuale per giocatori condivisi'),
                ('max_partecipanti', '30', 'Numero massimo di partecipanti'),
                ('backup_auto_minuti', '5', 'Frequenza backup automatici in minuti')`);

            console.log('✅ Database FantaGTS inizializzato con successo');
        });
    }

    // Metodi per squadre circolo
    async getSquadre() {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT * FROM squadre_circolo WHERE attiva = 1 ORDER BY numero", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async addSquadra(squadra) {
        return new Promise((resolve, reject) => {
            const { numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3 } = squadra;
            
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO squadre_circolo 
                (numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            stmt.run(numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    }

    async deleteSquadra(numero) {
        return new Promise((resolve, reject) => {
            this.db.run("UPDATE squadre_circolo SET attiva = 0 WHERE numero = ?", numero, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    // Metodi per partecipanti
    async getPartecipanti() {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT *, 
                (SELECT COUNT(*) FROM aste WHERE partecipante_id = partecipanti_fantagts.id AND vincitore = 1) as giocatori_vinti
                FROM partecipanti_fantagts WHERE attivo = 1 ORDER BY nome`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async addPartecipante(partecipante) {
        return new Promise((resolve, reject) => {
            const { nome, email, telefono, crediti = 2000 } = partecipante;
            const id = nome.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO partecipanti_fantagts 
                (id, nome, email, telefono, crediti) VALUES (?, ?, ?, ?, ?)`);
            
            stmt.run(id, nome, email, telefono, crediti, function(err) {
                if (err) reject(err);
                else resolve({ id: id, insertedId: this.lastID });
            });
        });
    }

    async deletePartecipante(id) {
        return new Promise((resolve, reject) => {
            this.db.run("UPDATE partecipanti_fantagts SET attivo = 0 WHERE id = ?", id, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    // Metodi per slots
    async generaSlots() {
        return new Promise((resolve, reject) => {
            this.getSquadre().then(squadre => {
                const posizioni = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'F1', 'F2', 'F3'];
                
                // Cancella slots esistenti
                this.db.run("DELETE FROM slots", (err) => {
                    if (err) return reject(err);

                    const stmt = this.db.prepare("INSERT INTO slots (id, squadra_numero, colore, posizione, giocatore_attuale) VALUES (?, ?, ?, ?, ?)");
                    
                    let inserimenti = 0;
                    const totaleInserimenti = squadre.length * posizioni.length;

                    squadre.forEach(squadra => {
                        posizioni.forEach(pos => {
                            const slotId = `${pos}_${squadra.colore.toUpperCase()}`;
                            const giocatore = squadra[pos.toLowerCase()];
                            
                            stmt.run(slotId, squadra.numero, squadra.colore, pos, giocatore, (err) => {
                                if (err) return reject(err);
                                
                                inserimenti++;
                                if (inserimenti === totaleInserimenti) {
                                    stmt.finalize();
                                    resolve(inserimenti);
                                }
                            });
                        });
                    });
                });
            }).catch(reject);
        });
    }

    async getSlotsPerRound(round) {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT * FROM slots WHERE posizione = ? AND attivo = 1 ORDER BY squadra_numero", round, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Metodi per aste
    async salvaRisultatiAste(round, risultati) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run("BEGIN TRANSACTION");

                const stmt = this.db.prepare(`INSERT INTO aste 
                    (round, partecipante_id, slot_id, offerta, costo_finale, premium, vincitore, condiviso) 
                    VALUES (?, ?, ?, ?, ?, ?, 1, ?)`);

                let completati = 0;
                const totale = risultati.length;

                risultati.forEach(r => {
                    stmt.run(round, r.partecipante, r.slot, r.offertaOriginale, r.costoFinale, r.premium, r.condiviso ? 1 : 0, (err) => {
                        if (err) {
                            this.db.run("ROLLBACK");
                            return reject(err);
                        }
                        
                        // Aggiorna crediti partecipante
                        this.db.run(`UPDATE partecipanti_fantagts 
                                    SET crediti = crediti - ? 
                                    WHERE id = ?`, r.costoFinale, r.partecipante, (err) => {
                            if (err) {
                                this.db.run("ROLLBACK");
                                return reject(err);
                            }

                            completati++;
                            if (completati === totale) {
                                stmt.finalize();
                                this.db.run("COMMIT");
                                resolve(completati);
                            }
                        });
                    });
                });
            });
        });
    }

    async getAstePerRound(round) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT a.*, p.nome as partecipante_nome, s.giocatore_attuale, s.colore 
                        FROM aste a 
                        JOIN partecipanti_fantagts p ON a.partecipante_id = p.id 
                        JOIN slots s ON a.slot_id = s.id 
                        WHERE a.round = ? AND a.vincitore = 1 
                        ORDER BY a.costo_finale DESC`, round, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getSquadraPartecipante(partecipanteId) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT a.*, s.posizione, s.giocatore_attuale, s.colore, s.punti_totali
                        FROM aste a 
                        JOIN slots s ON a.slot_id = s.id 
                        WHERE a.partecipante_id = ? AND a.vincitore = 1 
                        ORDER BY s.posizione`, partecipanteId, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Metodi per sostituzioni
    async addSostituzione(sostituzione) {
        return new Promise((resolve, reject) => {
            const { slotId, giocatoreVecchio, giocatoreNuovo, dalTurno, motivo } = sostituzione;
            
            const stmt = this.db.prepare(`INSERT INTO sostituzioni 
                (slot_id, giocatore_vecchio, giocatore_nuovo, dal_turno, motivo) 
                VALUES (?, ?, ?, ?, ?)`);
            
            stmt.run(slotId, giocatoreVecchio, giocatoreNuovo, dalTurno, motivo, function(err) {
                if (err) reject(err);
                else {
                    // Aggiorna il giocatore attuale nello slot
                    this.db.run("UPDATE slots SET giocatore_attuale = ? WHERE id = ?", 
                               giocatoreNuovo, slotId, (err) => {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                }
            });
        });
    }

    async getSostituzioni(slotId = null) {
        return new Promise((resolve, reject) => {
            let query = `SELECT s.*, sl.posizione, sl.colore 
                        FROM sostituzioni s 
                        JOIN slots sl ON s.slot_id = sl.id 
                        ORDER BY s.timestamp DESC`;
            let params = [];

            if (slotId) {
                query = `SELECT s.*, sl.posizione, sl.colore 
                        FROM sostituzioni s 
                        JOIN slots sl ON s.slot_id = sl.id 
                        WHERE s.slot_id = ? 
                        ORDER BY s.timestamp DESC`;
                params = [slotId];
            }

            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Metodi per risultati partite
    async addRisultatoPartita(risultato) {
        return new Promise((resolve, reject) => {
            const { turno, squadra1, squadra2, risultatoPartita, vincitori, inseritoDa } = risultato;
            
            const stmt = this.db.prepare(`INSERT INTO risultati_partite 
                (turno, squadra_1, squadra_2, risultato, vincitori, inserito_da) 
                VALUES (?, ?, ?, ?, ?, ?)`);
            
            stmt.run(turno, squadra1, squadra2, risultatoPartita, JSON.stringify(vincitori), inseritoDa, function(err) {
                if (err) reject(err);
                else {
                    // Aggiorna punti nei slots
                    this.aggiornaPuntiSlots(vincitori).then(() => {
                        resolve(this.lastID);
                    }).catch(reject);
                }
            });
        });
    }

    async aggiornaPuntiSlots(vincitoriIds) {
        return new Promise((resolve, reject) => {
            if (!vincitoriIds || vincitoriIds.length === 0) {
                return resolve(0);
            }

            const placeholders = vincitoriIds.map(() => '?').join(',');
            const query = `UPDATE slots SET punti_totali = punti_totali + 1 
                          WHERE id IN (${placeholders})`;

            this.db.run(query, vincitoriIds, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    async getRisultatiPartite(turno = null) {
        return new Promise((resolve, reject) => {
            let query = `SELECT r.*, 
                        s1.colore as squadra_1_colore, s2.colore as squadra_2_colore
                        FROM risultati_partite r 
                        JOIN squadre_circolo s1 ON r.squadra_1 = s1.numero 
                        JOIN squadre_circolo s2 ON r.squadra_2 = s2.numero 
                        ORDER BY r.turno DESC, r.timestamp DESC`;
            let params = [];

            if (turno) {
                query = `SELECT r.*, 
                        s1.colore as squadra_1_colore, s2.colore as squadra_2_colore
                        FROM risultati_partite r 
                        JOIN squadre_circolo s1 ON r.squadra_1 = s1.numero 
                        JOIN squadre_circolo s2 ON r.squadra_2 = s2.numero 
                        WHERE r.turno = ?
                        ORDER BY r.timestamp DESC`;
                params = [turno];
            }

            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else {
                    // Parse JSON vincitori
                    rows.forEach(row => {
                        try {
                            row.vincitori = JSON.parse(row.vincitori || '[]');
                        } catch (e) {
                            row.vincitori = [];
                        }
                    });
                    resolve(rows);
                }
            });
        });
    }

    // Metodi per classifiche
    async getClassificaGenerale() {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT 
                p.id, p.nome, p.crediti, 
                COUNT(a.id) as giocatori_totali,
                COALESCE(SUM(s.punti_totali), 0) as punti_totali,
                COALESCE(SUM(a.costo_finale), 0) as crediti_spesi
                FROM partecipanti_fantagts p 
                LEFT JOIN aste a ON p.id = a.partecipante_id AND a.vincitore = 1
                LEFT JOIN slots s ON a.slot_id = s.id 
                WHERE p.attivo = 1
                GROUP BY p.id, p.nome, p.crediti 
                ORDER BY punti_totali DESC, crediti_spesi ASC`, (err, rows) => {
                
                if (err) reject(err);
                else {
                    // Aggiungi posizione in classifica
                    rows.forEach((row, index) => {
                        row.posizione = index + 1;
                    });
                    resolve(rows);
                }
            });
        });
    }

    // Metodi per configurazione
    async getConfigurazione(chiave = null) {
        return new Promise((resolve, reject) => {
            if (chiave) {
                this.db.get("SELECT * FROM configurazione WHERE chiave = ?", chiave, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            } else {
                this.db.all("SELECT * FROM configurazione ORDER BY chiave", (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            }
        });
    }

    async setConfigurazione(chiave, valore, descrizione = null) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO configurazione 
                (chiave, valore, descrizione, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`);
            
            stmt.run(chiave, valore, descrizione, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    // Metodi per backup e reset
    async resetDatabase(livello) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run("BEGIN TRANSACTION");

                switch (livello) {
                    case 'aste':
                        this.db.run("DELETE FROM aste", (err) => {
                            if (err) {
                                this.db.run("ROLLBACK");
                                return reject(err);
                            }
                            
                            this.db.run("UPDATE partecipanti_fantagts SET crediti = 2000", (err) => {
                                if (err) {
                                    this.db.run("ROLLBACK");
                                    return reject(err);
                                }
                                
                                this.db.run("COMMIT");
                                resolve('Aste resettate con successo');
                            });
                        });
                        break;

                    case 'totale':
                        const tables = ['aste', 'risultati_partite', 'sostituzioni', 'slots', 'partecipanti_fantagts', 'squadre_circolo'];
                        let completed = 0;

                        tables.forEach(table => {
                            this.db.run(`DELETE FROM ${table}`, (err) => {
                                if (err) {
                                    this.db.run("ROLLBACK");
                                    return reject(err);
                                }
                                
                                completed++;
                                if (completed === tables.length) {
                                    this.db.run("COMMIT");
                                    resolve('Database completamente resettato');
                                }
                            });
                        });
                        break;

                    default:
                        this.db.run("ROLLBACK");
                        reject('Livello di reset non valido');
                }
            });
        });
    }

    // Metodi per export
    async exportToJSON() {
        const data = {};
        
        try {
            data.squadre = await this.getSquadre();
            data.partecipanti = await this.getPartecipanti();
            data.aste = await this.getAstePerRound();
            data.sostituzioni = await this.getSostituzioni();
            data.risultati = await this.getRisultatiPartite();
            data.configurazione = await this.getConfigurazione();
            data.classifica = await this.getClassificaGenerale();
            data.exportTimestamp = new Date().toISOString();
            
            return data;
        } catch (error) {
            throw new Error('Errore durante export: ' + error.message);
        }
    }

    // Chiusura connessione
    close() {
        return new Promise((resolve) => {
            this.db.close((err) => {
                if (err) console.error('Errore chiusura database:', err);
                else console.log('✅ Database chiuso correttamente');
                resolve();
            });
        });
    }
}

module.exports = FantaGTSDatabase;