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
        console.log('🔧 Inizializzazione database in corso...');

        // 1️⃣ PRIMA: Crea tabelle "parent" (senza dipendenze)

        // Crea tabella configurazioni PRIMA di tutto
        await db.query(`CREATE TABLE IF NOT EXISTS configurazioni (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            anno INTEGER,
            descrizione TEXT,
            numero_squadre INTEGER DEFAULT 10,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella configurazioni creata/verificata');

        // Crea configurazione "default" per retrocompatibilità
        const defaultConfig = await db.query(`SELECT * FROM configurazioni WHERE id = 'default'`);
        if (defaultConfig.rows.length === 0) {
            await db.query(`
                INSERT INTO configurazioni (id, nome, anno, descrizione, numero_squadre)
                VALUES ('default', 'Configurazione Predefinita', 2025, 'Configurazione di default per compatibilità', 10)
            `);
            console.log('✅ Configurazione "default" creata per compatibilità');
        } else {
            console.log('ℹ️ Configurazione "default" già esistente');
        }

        // Crea tabella sessioni (senza foreign key ancora)
        await db.query(`CREATE TABLE IF NOT EXISTS sessioni_fantagts (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            anno INTEGER,
            descrizione TEXT,
            attiva BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella sessioni creata/verificata');

        // Crea tabella squadre_circolo (senza foreign key ancora)
        await db.query(`CREATE TABLE IF NOT EXISTS squadre_circolo (
            id SERIAL PRIMARY KEY,
            numero INTEGER NOT NULL,
            colore TEXT NOT NULL,
            m1 TEXT, m2 TEXT, m3 TEXT, m4 TEXT, m5 TEXT, m6 TEXT, m7 TEXT,
            f1 TEXT, f2 TEXT, f3 TEXT,
            attiva BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella squadre_circolo creata/verificata');

        // Crea tabella turni_configurazione (senza foreign key ancora)
        await db.query(`CREATE TABLE IF NOT EXISTS turni_configurazione (
            id SERIAL PRIMARY KEY,
            turno_numero INTEGER NOT NULL,
            nome_turno TEXT NOT NULL,
            descrizione TEXT,
            punti_vittoria INTEGER DEFAULT 1,
            attivo BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella turni_configurazione creata/verificata');

        // 2️⃣ Crea tabelle "child" (con foreign key)

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
            pin TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella partecipanti_fantagts creata/verificata');

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
        console.log('✅ Tabella slots creata/verificata');

        await db.query(`CREATE TABLE IF NOT EXISTS coppie_turno (
            id SERIAL PRIMARY KEY,
            turno_id INTEGER NOT NULL,
            coppia_numero INTEGER NOT NULL,
            pos1 TEXT NOT NULL,
            pos2 TEXT NOT NULL,
            squadra1 INTEGER,
            squadra2 INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella coppie_turno creata/verificata');

        await db.query(`CREATE TABLE IF NOT EXISTS scontri_squadre (
            id SERIAL PRIMARY KEY,
            turno_id INTEGER NOT NULL,
            squadra1 INTEGER NOT NULL,
            squadra2 INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella scontri_squadre creata/verificata');

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
        console.log('✅ Tabella aste creata/verificata');

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
        console.log('✅ Tabella sostituzioni creata/verificata');

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
        console.log('✅ Tabella risultati_partite creata/verificata');

        await db.query(`CREATE TABLE IF NOT EXISTS incontri (
            id SERIAL PRIMARY KEY,
            turno_id INTEGER NOT NULL,
            coppia_turno_id INTEGER NOT NULL,
            squadra1 INTEGER NOT NULL,
            squadra2 INTEGER NOT NULL,
            risultato_coppia1 TEXT,
            risultato_coppia2 TEXT,
            completato BOOLEAN DEFAULT false,
            inserito_da TEXT,
            sessione_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella incontri creata/verificata');

        await db.query(`CREATE TABLE IF NOT EXISTS accoppiamenti_posizioni (
            id SERIAL PRIMARY KEY,
            turno_id INTEGER NOT NULL,
            pos1 TEXT NOT NULL,
            pos2 TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella accoppiamenti_posizioni creata/verificata');

        await db.query(`CREATE TABLE IF NOT EXISTS risultati_dettaglio (
            id SERIAL PRIMARY KEY,
            incontro_id INTEGER NOT NULL,
            posizione TEXT NOT NULL,
            giocatore_squadra1 TEXT,
            giocatore_squadra2 TEXT,
            vincitore INTEGER,
            punti_assegnati INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella risultati_dettaglio creata/verificata');

        // Elimina e ricrea tabella squadre_draft con schema corretto
        await db.query(`CREATE TABLE IF NOT EXISTS squadre_draft (
            id SERIAL PRIMARY KEY,
            partecipante_id TEXT NOT NULL,
            sessione_id TEXT NOT NULL,
            posizione TEXT NOT NULL,
            slot_id TEXT,
            giocatore TEXT,
            numero_squadra_circolo INTEGER,
            colore_squadra TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(partecipante_id, sessione_id, posizione)
        )`);
        console.log('✅ Tabella squadre_draft creata/verificata (dati preservati)');

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
        console.log('✅ Tabella push_subscriptions creata/verificata');

        await db.query(`CREATE TABLE IF NOT EXISTS configurazione (
            chiave TEXT PRIMARY KEY,
            valore TEXT,
            descrizione TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella configurazione creata/verificata');

        // Inserisci configurazione predefinita
        await db.query(`INSERT INTO configurazione (chiave, valore, descrizione) VALUES 
            ('crediti_iniziali', '2000', 'Crediti iniziali per ogni partecipante'),
            ('durata_asta_secondi', '30', 'Durata di ogni round di aste'),
            ('premium_condivisione', '0.10', 'Premium percentuale per giocatori condivisi'),
            ('max_partecipanti', '30', 'Numero massimo di partecipanti'),
            ('backup_auto_minuti', '5', 'Frequenza backup automatici in minuti')
            ON CONFLICT (chiave) DO NOTHING`);
        console.log('✅ Configurazione predefinita inserita');

        console.log('✅ Database PostgreSQL inizializzato con successo');
    } catch (error) {
        console.error('❌ Errore inizializzazione database:', error);
    }
}

// Funzione per aggiornare database automaticamente
async function updateDatabaseSchema() {
    try {
        console.log('🔄 Aggiornando schema database...');

        // 1️⃣ PRIMA: Crea tabella sessioni se non esiste (DEVE ESISTERE PRIMA DELLE FOREIGN KEY!)
        await db.query(`CREATE TABLE IF NOT EXISTS sessioni_fantagts (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            anno INTEGER,
            descrizione TEXT,
            
            -- Configurazione
            modalita TEXT NOT NULL DEFAULT 'asta_competitiva',
            numero_partecipanti_previsti INTEGER NOT NULL DEFAULT 10,
            crediti_iniziali INTEGER DEFAULT 2000,
            numero_squadre INTEGER NOT NULL DEFAULT 10,
            
            -- Sistema condivisione
            condivisione_attiva BOOLEAN DEFAULT false,
            ripetizioni_necessarie INTEGER DEFAULT 0,
            premium_condivisione REAL DEFAULT 0.10,
            
            -- Stato
            stato TEXT DEFAULT 'setup',
            attiva BOOLEAN DEFAULT false,
            
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella sessioni creata/verificata');

        // 🆕 NUOVO: Crea tabella configurazioni (set di squadre/giocatori riutilizzabili)
        await db.query(`CREATE TABLE IF NOT EXISTS configurazioni (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            anno INTEGER,
            descrizione TEXT,
            numero_squadre INTEGER DEFAULT 10,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabella configurazioni creata/verificata');

        // 🆕 CREA CONFIGURAZIONE "default" SE NON ESISTE
        const checkDefaultConfig = await db.query(`SELECT id FROM configurazioni WHERE id = 'default'`);
        if (checkDefaultConfig.rows.length === 0) {
            await db.query(`
                INSERT INTO configurazioni (id, nome, anno, descrizione, numero_squadre)
                VALUES ('default', 'Configurazione Predefinita', 2025, 'Configurazione di default per compatibilità', 10)
            `);
            console.log('✅ Configurazione "default" creata per compatibilità');
        } else {
            console.log('ℹ️ Configurazione "default" già esistente');
        }

        // 🆕 CREA SESSIONE "default" SE NON ESISTE
        const checkDefaultSession = await db.query(`SELECT id FROM sessioni_fantagts WHERE id = 'default'`);
        if (checkDefaultSession.rows.length === 0) {
            await db.query(`
                INSERT INTO sessioni_fantagts (
                    id, nome, anno, descrizione, modalita, 
                    numero_partecipanti_previsti, crediti_iniziali, numero_squadre, 
                    stato, attiva, codice_accesso
                ) VALUES (
                    'default', 'Sessione Default', 2025, 
                    'Sessione di sistema per utenti non assegnati',
                    'asta_competitiva', 10, 2000, 10, 'setup', false, 'SYS00'
                )
            `);
            console.log('✅ Sessione "default" creata per compatibilità');
        } else {
            console.log('ℹ️ Sessione "default" già esistente');
        }

        // 2️⃣ Aggiorna tabella sessioni con colonne mancanti
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS modalita TEXT DEFAULT 'asta_competitiva'`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS numero_partecipanti_previsti INTEGER DEFAULT 10`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS crediti_iniziali INTEGER DEFAULT 2000`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS numero_squadre INTEGER DEFAULT 10`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS condivisione_attiva BOOLEAN DEFAULT false`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS ripetizioni_necessarie INTEGER DEFAULT 0`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS premium_condivisione REAL DEFAULT 0.10`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS stato TEXT DEFAULT 'setup'`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS codice_accesso VARCHAR(5) UNIQUE`);

        // 🆕 Aggiungi colonna configurazione_id alle sessioni
        await db.query(`ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS configurazione_id TEXT DEFAULT 'default'`);

        // Rimuovi il constraint se esiste già (per evitare duplicati)
        await db.query(`ALTER TABLE sessioni_fantagts DROP CONSTRAINT IF EXISTS fk_sessioni_configurazione`);

        // Aggiungi il foreign key
        await db.query(`
            ALTER TABLE sessioni_fantagts 
            ADD CONSTRAINT fk_sessioni_configurazione 
            FOREIGN KEY (configurazione_id) REFERENCES configurazioni(id) ON DELETE RESTRICT
        `);
        console.log('✅ Colonna configurazione_id aggiunta a sessioni_fantagts');

        // Crea tabella per tracciare accessi partecipanti
        await db.query(`CREATE TABLE IF NOT EXISTS partecipanti_sessioni_accesso (
            id SERIAL PRIMARY KEY,
            partecipante_id TEXT REFERENCES partecipanti_fantagts(id) ON DELETE CASCADE,
            sessione_id TEXT REFERENCES sessioni_fantagts(id) ON DELETE CASCADE,
            primo_accesso TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ultimo_accesso TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(partecipante_id, sessione_id)
        )`);
        console.log('✅ Tabella accessi partecipanti creata/verificata');

        // 3️⃣ Aggiungi colonne sessione_id alle tabelle che ancora la usano
        await db.query(`ALTER TABLE partecipanti_fantagts ADD COLUMN IF NOT EXISTS sessione_id TEXT DEFAULT 'default'`);
        await db.query(`ALTER TABLE aste ADD COLUMN IF NOT EXISTS sessione_id TEXT DEFAULT 'default'`);
        await db.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS sessione_id TEXT DEFAULT 'default'`);
        await db.query(`ALTER TABLE sostituzioni ADD COLUMN IF NOT EXISTS sessione_id TEXT DEFAULT 'default'`);

        // 4️⃣ RIMUOVI Foreign Key da partecipanti_fantagts (per permettere login/registrazione generica)
        await db.query(`ALTER TABLE partecipanti_fantagts DROP CONSTRAINT IF EXISTS fk_partecipanti_sessione`);
        await db.query(`ALTER TABLE partecipanti_fantagts DROP CONSTRAINT IF EXISTS partecipanti_fantagts_sessione_id_fkey`);
        console.log('✅ Foreign Key rimossa da partecipanti_fantagts');

        // 5️⃣ 🆕 MODIFICA SQUADRE_CIRCOLO: Ora collegate a configurazione_id
        console.log('🔧 Aggiornando squadre_circolo per usare configurazione_id...');

        // Aggiungi colonna configurazione_id se non esiste
        await db.query(`ALTER TABLE squadre_circolo ADD COLUMN IF NOT EXISTS configurazione_id TEXT`);

        // Migra i dati esistenti: mappa sessione_id → configurazione_id
        await db.query(`
            UPDATE squadre_circolo sq
            SET configurazione_id = COALESCE(
                (SELECT configurazione_id FROM sessioni_fantagts WHERE id = sq.sessione_id),
                'default'
            )
            WHERE configurazione_id IS NULL
        `);

        // Rimuovi il vecchio constraint unique su numero
        await db.query(`ALTER TABLE squadre_circolo DROP CONSTRAINT IF EXISTS squadre_circolo_numero_key CASCADE`);

        // Rimuovi foreign key verso sessione se esiste
        await db.query(`ALTER TABLE squadre_circolo DROP CONSTRAINT IF EXISTS fk_squadre_sessione CASCADE`);

        // Aggiungi foreign key verso configurazioni
        await db.query(`ALTER TABLE squadre_circolo DROP CONSTRAINT IF EXISTS fk_squadre_configurazione`);
        await db.query(`
            ALTER TABLE squadre_circolo 
            ADD CONSTRAINT fk_squadre_configurazione 
            FOREIGN KEY (configurazione_id) REFERENCES configurazioni(id) ON DELETE CASCADE
        `);

        // Crea nuovo vincolo: numero unico SOLO all'interno della stessa configurazione
        await db.query(`DROP INDEX IF EXISTS idx_squadre_numero_configurazione`);
        await db.query(`
            CREATE UNIQUE INDEX idx_squadre_numero_configurazione 
            ON squadre_circolo(numero, configurazione_id)
        `);

        console.log('✅ squadre_circolo ora collegata a configurazioni');

        // 6️⃣ 🆕 MODIFICA SLOTS: Ora collegati a configurazione_id
        await db.query(`ALTER TABLE slots ADD COLUMN IF NOT EXISTS configurazione_id TEXT`);

        // Verifica se sessione_id esiste ancora prima di usarla
        const checkSessioneId = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'slots' AND column_name = 'sessione_id'
        `);

        // Migra dati esistenti SOLO se sessione_id esiste ancora
        if (checkSessioneId.rows.length > 0) {
            await db.query(`
                UPDATE slots sl
                SET configurazione_id = COALESCE(
                    (SELECT configurazione_id FROM sessioni_fantagts WHERE id = sl.sessione_id),
                    'default'
                )
                WHERE configurazione_id IS NULL
            `);
            console.log('✅ Dati slots migrati da sessione_id a configurazione_id');
        } else {
            // Se sessione_id non esiste, imposta tutti a 'default'
            await db.query(`
                UPDATE slots
                SET configurazione_id = 'default'
                WHERE configurazione_id IS NULL
            `);
            console.log('✅ Slots senza configurazione impostati a default');
        }

        // Aggiungi foreign key
        await db.query(`ALTER TABLE slots DROP CONSTRAINT IF EXISTS fk_slots_configurazione`);
        await db.query(`
            ALTER TABLE slots 
            ADD CONSTRAINT fk_slots_configurazione 
            FOREIGN KEY (configurazione_id) REFERENCES configurazioni(id) ON DELETE CASCADE
        `);
        console.log('✅ slots ora collegati a configurazioni');

        // RIMUOVI sessione_id da slots (campo obsoleto) - SOLO se esiste
        if (checkSessioneId.rows.length > 0) {
            await db.query(`ALTER TABLE slots DROP COLUMN IF EXISTS sessione_id`);
            console.log('✅ Campo sessione_id rimosso da slots');
        }

        // 70 MODIFICA TURNI_CONFIGURAZIONE: Aggiungi sessione_id E configurazione_id
        await db.query(`ALTER TABLE turni_configurazione ADD COLUMN IF NOT EXISTS sessione_id TEXT`);
        await db.query(`ALTER TABLE turni_configurazione ADD COLUMN IF NOT EXISTS configurazione_id TEXT`);

        await db.query(`
            UPDATE turni_configurazione
            SET configurazione_id = COALESCE(
                (SELECT configurazione_id FROM sessioni_fantagts WHERE id = sessione_id),
                'default'
            )
            WHERE configurazione_id IS NULL
        `);

        await db.query(`ALTER TABLE turni_configurazione DROP CONSTRAINT IF EXISTS fk_turni_configurazione`);
        await db.query(`
            ALTER TABLE turni_configurazione 
            ADD CONSTRAINT fk_turni_configurazione 
            FOREIGN KEY (configurazione_id) REFERENCES configurazioni(id) ON DELETE CASCADE
        `);
        console.log('✅ turni_configurazione ora collegati a configurazioni e hanno sessione_id');

        // 8️⃣ 🆕 MODIFICA SCONTRI_SQUADRE
        await db.query(`ALTER TABLE scontri_squadre ADD COLUMN IF NOT EXISTS configurazione_id TEXT`);

        await db.query(`
            UPDATE scontri_squadre sc
            SET configurazione_id = COALESCE(
                (SELECT configurazione_id FROM turni_configurazione WHERE id = sc.turno_id),
                'default'
            )
            WHERE configurazione_id IS NULL
        `);

        await db.query(`ALTER TABLE scontri_squadre DROP CONSTRAINT IF EXISTS fk_scontri_configurazione`);
        await db.query(`
            ALTER TABLE scontri_squadre 
            ADD CONSTRAINT fk_scontri_configurazione 
            FOREIGN KEY (configurazione_id) REFERENCES configurazioni(id) ON DELETE CASCADE
        `);
        console.log('✅ scontri_squadre ora collegati a configurazioni');

        // 9️⃣ 🆕 MODIFICA RISULTATI_PARTITE
        await db.query(`ALTER TABLE risultati_partite ADD COLUMN IF NOT EXISTS configurazione_id TEXT`);

        await db.query(`
            UPDATE risultati_partite
            SET configurazione_id = 'default'
            WHERE configurazione_id IS NULL
        `);

        await db.query(`ALTER TABLE risultati_partite DROP CONSTRAINT IF EXISTS fk_risultati_configurazione`);
        await db.query(`
            ALTER TABLE risultati_partite 
            ADD CONSTRAINT fk_risultati_configurazione 
            FOREIGN KEY (configurazione_id) REFERENCES configurazioni(id) ON DELETE CASCADE
        `);
        console.log('✅ risultati_partite ora collegati a configurazioni');

        // 🔟 🆕 MODIFICA INCONTRI: Aggiungi sessione_id E configurazione_id
        const incontriExists = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'incontri'
            )
        `);

        if (incontriExists.rows[0].exists) {
            await db.query(`ALTER TABLE incontri ADD COLUMN IF NOT EXISTS sessione_id TEXT`);
            await db.query(`ALTER TABLE incontri ADD COLUMN IF NOT EXISTS configurazione_id TEXT`);

            await db.query(`
                UPDATE incontri
                SET configurazione_id = 'default'
                WHERE configurazione_id IS NULL
            `);

            await db.query(`ALTER TABLE incontri DROP CONSTRAINT IF EXISTS fk_incontri_configurazione`);
            await db.query(`
                ALTER TABLE incontri 
                ADD CONSTRAINT fk_incontri_configurazione 
                FOREIGN KEY (configurazione_id) REFERENCES configurazioni(id) ON DELETE CASCADE
            `);
            console.log('✅ incontri ora collegati a configurazioni e hanno sessione_id');
        }

        // 1️⃣1️⃣ 🆕 MODIFICA RISULTATI_DETTAGLIO: Aggiungi sessione_id
        const risultatiDettaglioExists = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'risultati_dettaglio'
            )
        `);

        if (risultatiDettaglioExists.rows[0].exists) {
            await db.query(`ALTER TABLE risultati_dettaglio ADD COLUMN IF NOT EXISTS sessione_id TEXT`);
            console.log('✅ risultati_dettaglio ora ha sessione_id');
        }

        // 1️⃣2️⃣ CREA VIEW per statistiche sessioni
        await db.query(`DROP VIEW IF EXISTS v_sessioni_stats CASCADE`);
        await db.query(`CREATE VIEW v_sessioni_stats AS
            SELECT 
                s.id,
                s.nome,
                s.anno,
                s.descrizione,
                s.attiva,
                s.created_at,
                s.modalita,
                s.numero_partecipanti_previsti,
                s.crediti_iniziali,
                s.numero_squadre,
                s.condivisione_attiva,
                s.ripetizioni_necessarie,
                s.premium_condivisione,
                s.stato,
                s.last_modified,
                s.codice_accesso,
                s.configurazione_id,
                COALESCE(COUNT(DISTINCT psa.partecipante_id), 0)::INTEGER as partecipanti_iscritti,
                COALESCE(
                    (SELECT COUNT(DISTINCT numero) 
                     FROM squadre_circolo 
                     WHERE configurazione_id = s.configurazione_id AND attiva = true), 
                    0
                )::INTEGER as squadre_create,
                COALESCE(COUNT(DISTINCT a.id), 0)::INTEGER as aste_completate
            FROM sessioni_fantagts s
            LEFT JOIN partecipanti_sessioni_accesso psa ON psa.sessione_id = s.id
            LEFT JOIN aste a ON a.sessione_id = s.id
            GROUP BY s.id, s.nome, s.anno, s.descrizione, s.attiva, s.created_at, 
                     s.modalita, s.numero_partecipanti_previsti, s.crediti_iniziali, 
                     s.numero_squadre, s.condivisione_attiva, s.ripetizioni_necessarie, 
                     s.premium_condivisione, s.stato, s.last_modified, s.configurazione_id
        `);
        console.log('✅ View v_sessioni_stats creata/aggiornata');

        console.log('✅ Schema database aggiornato completamente con sistema configurazioni e sessioni');
    } catch (error) {
        console.error('❌ Errore aggiornamento schema:', error);
    }
}

// Stato del gioco in memoria
let gameState = {
    fase: 'setup',
    roundAttivo: null,
    asteAttive: false,

    // 🆕 NUOVO: Tracciamento sessione attiva
    sessioneAttiva: null, // ID della sessione attualmente in uso

    connessi: new Map(),
    offerteTemporanee: new Map(),

    // Campi per multi-asta
    astaCorrente: 1,
    partecipantiAssegnati: new Set(),
    slotsRimasti: [],
    partecipantiInAttesa: [],

    // Campi per controllo logging
    lastMonitorLog: null,
    lastOfferteCount: 0
};

// Genera codice sessione univoco (5 caratteri)
function generaCodiceSessione() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Esclusi 0,O,1,I per chiarezza
    let codice = '';
    for (let i = 0; i < 5; i++) {
        codice += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return codice;
}

// Verifica unicità codice sessione
async function generaCodiceUnico() {
    let codice;
    let esistente = true;

    while (esistente) {
        codice = generaCodiceSessione();
        const check = await db.query(
            'SELECT id FROM sessioni_fantagts WHERE codice_accesso = $1',
            [codice]
        );
        esistente = check.rows.length > 0;
    }

    return codice;
}

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

// =====================================================
// 🆕 FASE 3: SISTEMA CONDIVISIONE GIOCATORI
// =====================================================

/**
 * Calcola il numero di ripetizioni necessarie per categoria
 * @param {string} categoria - Es: 'M1', 'M2', 'F1'
 * @param {number} numeroPartecipanti - Totale partecipanti alla sessione
 * @param {number} numeroSquadre - Numero di squadre del circolo
 * @returns {number} - Numero di ripetizioni necessarie (0 se non serve condivisione)
 */
function calcolaRipetizioniNecessarie(categoria, numeroPartecipanti, numeroSquadre) {
    const giocatoriNecessari = numeroPartecipanti; // Ogni partecipante ha bisogno di 1 giocatore per categoria
    const giocatoriDisponibili = numeroSquadre; // 1 giocatore per squadra

    const ripetizioni = Math.max(0, giocatoriNecessari - giocatoriDisponibili);

    console.log(`📊 Categoria ${categoria}: ${giocatoriNecessari} necessari, ${giocatoriDisponibili} disponibili → ${ripetizioni} ripetizioni`);

    return ripetizioni;
}

/**
 * Raggruppa le offerte per giocatore e calcola la somma totale
 * @param {Array} offerte - Array di oggetti {partecipante, nome, offerta, slot}
 * @returns {Object} - Oggetto con struttura: { nomeGiocatore: { sommaOfferte, offerte: [...] } }
 */
function raggruppaOffertePerGiocatore(offerte) {
    const gruppi = {};

    offerte.forEach(offerta => {
        const nomeGiocatore = offerta.giocatore || offerta.slot; // slot contiene il nome del giocatore

        if (!gruppi[nomeGiocatore]) {
            gruppi[nomeGiocatore] = {
                nomeGiocatore: nomeGiocatore,
                sommaOfferte: 0,
                offerte: []
            };
        }

        gruppi[nomeGiocatore].sommaOfferte += offerta.offerta;
        gruppi[nomeGiocatore].offerte.push(offerta);
    });

    return gruppi;
}

/**
 * Seleziona i TOP N giocatori da replicare basandosi sulla somma delle offerte (Opzione D)
 * @param {Object} gruppiGiocatori - Oggetto restituito da raggruppaOffertePerGiocatore
 * @param {number} numeroRipetizioni - Quanti giocatori devono essere replicati
 * @returns {Array} - Array di nomi dei giocatori da replicare
 */
function selezionaGiocatoriDaReplicare(gruppiGiocatori, numeroRipetizioni) {
    // Converte l'oggetto in array e ordina per somma decrescente
    const giocatoriOrdinati = Object.values(gruppiGiocatori)
        .sort((a, b) => b.sommaOfferte - a.sommaOfferte);

    // Prende i TOP N
    const giocatoriReplicati = giocatoriOrdinati
        .slice(0, numeroRipetizioni)
        .map(g => g.nomeGiocatore);

    console.log(`🎯 TOP ${numeroRipetizioni} giocatori da replicare:`);
    giocatoriOrdinati.slice(0, numeroRipetizioni).forEach((g, idx) => {
        console.log(`   ${idx + 1}. ${g.nomeGiocatore}: somma offerte = ${g.sommaOfferte} (${g.offerte.length} offerte)`);
    });

    return giocatoriReplicati;
}

/**
 * Calcola i costi finali applicando il premium del 10% dal secondo posto in poi
 * @param {Array} offerte - Array di offerte per un singolo giocatore, ordinate per importo decrescente
 * @param {number} premiumPercentuale - Percentuale di premium (default 0.10 = 10%)
 * @returns {Array} - Array di oggetti {partecipante, nome, offerta, costoFinale, premium, posizione}
 */
function calcolaCostiConPremium(offerte, premiumPercentuale = 0.10) {
    // Ordina per offerta decrescente
    const offerteOrdinate = [...offerte].sort((a, b) => b.offerta - a.offerta);

    return offerteOrdinate.map((offerta, index) => {
        const posizione = index + 1;
        let costoFinale = offerta.offerta;
        let premium = 0;

        // Dal secondo posto in poi applica il premium
        if (posizione > 1) {
            premium = premiumPercentuale;
            costoFinale = Math.ceil(offerta.offerta * (1 + premium));
        }

        return {
            ...offerta,
            costoFinale: costoFinale,
            premium: premium,
            posizione: posizione,
            condiviso: true
        };
    });
}

/**
 * Elabora i risultati delle aste applicando l'algoritmo di condivisione (Opzione D)
 * @param {Array} tutteLeOfferte - Tutte le offerte del round
 * @param {number} numeroPartecipanti - Numero totale di partecipanti
 * @param {number} numeroSquadre - Numero di squadre del circolo
 * @param {string} categoria - Categoria corrente (es: 'M1')
 * @returns {Object} - { risultatiFinali: [], giocatoriReplicati: [], stats: {} }
 */
function elaboraCondivisioneGiocatori(tutteLeOfferte, numeroPartecipanti, numeroSquadre, categoria) {
    console.log(`\n🔄 === ELABORAZIONE CONDIVISIONE per ${categoria} ===`);

    // 1. Calcola quante ripetizioni servono
    const ripetizioniNecessarie = calcolaRipetizioniNecessarie(categoria, numeroPartecipanti, numeroSquadre);

    if (ripetizioniNecessarie === 0) {
        console.log(`✅ Nessuna condivisione necessaria per ${categoria}`);
        // Modalità normale: 1 vincitore per giocatore
        const risultatiNormali = elaboraRisultatiNormali(tutteLeOfferte);
        return {
            risultatiFinali: risultatiNormali,
            giocatoriReplicati: [],
            stats: {
                ripetizioniNecessarie: 0,
                giocatoriReplicati: 0,
                conCondivisione: 0,
                senzaCondivisione: risultatiNormali.length
            }
        };
    }

    // 2. Raggruppa offerte per giocatore
    const gruppiGiocatori = raggruppaOffertePerGiocatore(tutteLeOfferte);

    // 3. Seleziona i TOP N giocatori da replicare
    const giocatoriDaReplicare = selezionaGiocatoriDaReplicare(gruppiGiocatori, ripetizioniNecessarie);

    // 4. Elabora i risultati
    const risultatiFinali = [];
    const stats = {
        ripetizioniNecessarie: ripetizioniNecessarie,
        giocatoriReplicati: giocatoriDaReplicare.length,
        conCondivisione: 0,
        senzaCondivisione: 0
    };

    Object.entries(gruppiGiocatori).forEach(([nomeGiocatore, dati]) => {
        const deveEssereReplicato = giocatoriDaReplicare.includes(nomeGiocatore);

        if (deveEssereReplicato) {
            // Giocatore condiviso: applica premium e assegna a tutti
            const risultatiConPremium = calcolaCostiConPremium(dati.offerte);
            risultatiFinali.push(...risultatiConPremium);
            stats.conCondivisione += risultatiConPremium.length;

            console.log(`🔁 ${nomeGiocatore} CONDIVISO tra ${risultatiConPremium.length} partecipanti`);
        } else {
            // Giocatore unico: vince solo l'offerta più alta
            const vincitore = elaboraVincitoreUnico(dati.offerte);
            risultatiFinali.push(vincitore);
            stats.senzaCondivisione++;

            console.log(`✅ ${nomeGiocatore} assegnato UNICO a ${vincitore.nome}`);
        }
    });

    console.log(`\n📊 STATISTICHE CONDIVISIONE:`);
    console.log(`   Ripetizioni necessarie: ${stats.ripetizioniNecessarie}`);
    console.log(`   Giocatori replicati: ${stats.giocatoriReplicati}`);
    console.log(`   Assegnazioni con condivisione: ${stats.conCondivisione}`);
    console.log(`   Assegnazioni senza condivisione: ${stats.senzaCondivisione}`);

    return {
        risultatiFinali,
        giocatoriReplicati: giocatoriDaReplicare,
        stats
    };
}

/**
 * Elabora risultati in modalità normale (senza condivisione)
 */
function elaboraRisultatiNormali(offerte) {
    const offertePerSlot = {};

    offerte.forEach(offerta => {
        if (!offertePerSlot[offerta.slot]) {
            offertePerSlot[offerta.slot] = [];
        }
        offertePerSlot[offerta.slot].push(offerta);
    });

    const risultati = [];
    Object.values(offertePerSlot).forEach(offerte => {
        const vincitore = elaboraVincitoreUnico(offerte);
        risultati.push(vincitore);
    });

    return risultati;
}

/**
 * Elabora il vincitore unico di un giocatore (gestisce pareggi)
 */
function elaboraVincitoreUnico(offerte) {
    const offerteOrdinate = [...offerte].sort((a, b) => b.offerta - a.offerta);
    const offertaMassima = offerteOrdinate[0].offerta;
    const offerteVincenti = offerteOrdinate.filter(o => o.offerta === offertaMassima);

    let vincitore;
    if (offerteVincenti.length === 1) {
        vincitore = offerteVincenti[0];
    } else {
        // Pareggio - sorteggio casuale
        const randomIndex = Math.floor(Math.random() * offerteVincenti.length);
        vincitore = offerteVincenti[randomIndex];
        console.log(`🎲 PAREGGIO! Estratto: ${vincitore.nome}`);
    }

    return {
        partecipante: vincitore.partecipante,
        nome: vincitore.nome,
        slot: vincitore.slot,
        offerta: vincitore.offerta,
        costoFinale: vincitore.offerta,
        premium: 0,
        condiviso: false,
        posizione: 1
    };
}

// =====================================================
// FINE FASE 3: SISTEMA CONDIVISIONE GIOCATORI
// =====================================================

async function generaSlots(configurazioneId = 'default') {
    try {
        console.log('🎯 Inizio generazione slots...');
        console.log('📌 Configurazione ricevuta:', configurazioneId);

        // FILTRO PER CONFIGURAZIONE
        const squadreResult = await db.query(
            "SELECT * FROM squadre_circolo WHERE attiva = true AND configurazione_id = $1 ORDER BY numero",
            [configurazioneId]
        );

        const squadre = squadreResult.rows;
        console.log(`✅ Trovate ${squadre.length} squadre attive per configurazione ${configurazioneId}`);

        // Verifica che ci siano squadre
        if (squadre.length === 0) {
            throw new Error(`Nessuna squadra trovata per la configurazione ${configurazioneId}`);
        }

        const posizioni = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'F1', 'F2', 'F3'];

        // CANCELLA SLOTS ESISTENTI per questa configurazione
        console.log('🗑️ Cancellazione slots esistenti per configurazione...');

        await db.query(`
            DELETE FROM slots 
            WHERE configurazione_id = $1
        `, [configurazioneId]);
        console.log('✅ Slots esistenti cancellati');

        let inserimenti = 0;
        for (const squadra of squadre) {
            for (const pos of posizioni) {
                // ID univoco: include il numero della squadra per evitare conflitti
                const slotId = `${pos}_SQ${squadra.numero}_${squadra.colore.toUpperCase()}`;
                const giocatore = squadra[pos.toLowerCase()];

                await db.query(
                    "INSERT INTO slots (id, squadra_numero, colore, posizione, giocatore_attuale, configurazione_id) VALUES ($1, $2, $3, $4, $5, $6)",
                    [slotId, squadra.numero, squadra.colore, pos, giocatore, configurazioneId]
                );
                inserimenti++;
            }
        }

        console.log(`✅ Generati ${inserimenti} slots da ${squadre.length} squadre per configurazione ${configurazioneId}`);
        return inserimenti;
    } catch (error) {
        console.error('❌ ERRORE generaSlots:', error.message);
        console.error('Stack:', error.stack);
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

    // 📤 Invia stato asta SOLO ai partecipanti in attesa
    gameState.partecipantiInAttesa.forEach(partecipanteId => {
        for (let [socketId, connesso] of gameState.connessi.entries()) {
            if (connesso.partecipanteId === partecipanteId) {
                io.to(socketId).emit('asta_started', {
                    round: gameState.roundAttivo,
                    astaNumero: gameState.astaCorrente,
                    slots: gameState.slotsRimasti,
                    partecipantiInAttesa: gameState.partecipantiInAttesa,
                    sistema: 'multi-asta',
                    slotsDisponibili: gameState.slotsRimasti.map(s => s.id)
                });
                break;
            }
        }
    });

    // Invia anche ai master per monitoraggio
    for (let [socketId, connesso] of gameState.connessi.entries()) {
        if (connesso.tipo === 'master') {
            io.to(socketId).emit('asta_started', {
                round: gameState.roundAttivo,
                astaNumero: gameState.astaCorrente,
                slots: gameState.slotsRimasti,
                partecipantiInAttesa: gameState.partecipantiInAttesa,
                sistema: 'multi-asta'
            });
        }
    }

    // Avvia monitoraggio per questa asta
    avviaMonitoraggioOfferte();
}

// NUOVA FUNZIONE: Termina round completo
async function terminaRoundCompleto() {
    console.log(`\n🏁 === ROUND ${gameState.roundAttivo} COMPLETATO ===`);

    const roundCompletato = gameState.roundAttivo;

    // 🆕 RECUPERA I RISULTATI DAL DATABASE CON NOME GIOCATORE
    let risultati = [];
    try {
        const result = await db.query(`
            SELECT 
                a.slot_id as slot,
                s.giocatore_attuale as giocatore,
                p.nome,
                a.partecipante_id as partecipante,
                a.offerta as "offertaOriginale",
                a.costo_finale as "costoFinale",
                a.condiviso,
                a.premium
            FROM aste a
            JOIN partecipanti_fantagts p ON p.id = a.partecipante_id
            LEFT JOIN slots s ON s.id = a.slot_id
            WHERE a.round = $1 AND a.sessione_id = $2
            ORDER BY a.timestamp
        `, [roundCompletato, sessioneCorrente]);

        risultati = result.rows;
        console.log(`📊 Risultati recuperati per ${roundCompletato}:`, risultati.length);
    } catch (error) {
        console.error('❌ Errore recupero risultati:', error);
    }

    gameState.asteAttive = false;
    gameState.roundAttivo = null;
    gameState.astaCorrente = 1;
    gameState.partecipantiAssegnati.clear();
    gameState.slotsRimasti = [];
    gameState.partecipantiInAttesa = [];
    gameState.offerteTemporanee.clear();

    // 📤 Notifica fine round CON RISULTATI
    io.emit('round_ended', {
        round: roundCompletato,
        completato: true,
        risultati: risultati,
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

        // Cerca subscription nel database - Recupera la sessione attiva dinamicamente
        try {
            // 🔍 Recupera la sessione attiva corrente
            const sessioneAttivaQuery = await db.query(
                'SELECT id FROM sessioni_fantagts WHERE attiva = true LIMIT 1'
            );
            
            const sessioneAttiva = sessioneAttivaQuery.rows.length > 0 
                ? sessioneAttivaQuery.rows[0].id 
                : null;
            
            if (!sessioneAttiva) {
                console.log('⚠️ Nessuna sessione attiva trovata per le notifiche push');
                return {
                    success: true,
                    websocket: notificheTramiteSocket,
                    push_sent: 0,
                    push_failed: 0,
                    message: 'Notifiche WebSocket inviate, nessuna sessione attiva per push'
                };
            }
            
            console.log(`🎮 Usando sessione attiva: ${sessioneAttiva} per notifiche push`);
            
            let query, params;
            if (targetUsers && targetUsers.length > 0) {
                const placeholders = targetUsers.map((_, i) => `$${i + 2}`).join(',');
                query = `SELECT * FROM push_subscriptions 
            WHERE partecipante_id IN (${placeholders}) 
            AND partecipante_id IN (
                SELECT id FROM partecipanti_fantagts 
                WHERE sessione_id = $1 AND attivo = true
            ) AND attiva = true`;
                params = [sessioneAttiva, ...targetUsers];
            } else {
                query = `SELECT * FROM push_subscriptions 
            WHERE partecipante_id IN (
                SELECT id FROM partecipanti_fantagts 
                WHERE sessione_id = $1 AND attivo = true
            ) AND attiva = true`;
                params = [sessioneAttiva];
            }

            const result = await db.query(query, params);
            subscriptions = result.rows;
            console.log(`📱 SUBSCRIPTION TROVATE: ${subscriptions.length} per sessione ${sessioneAttiva}`);
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

// Route per servire la pagina archivio sessioni
app.get('/archivio-sessioni', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'archivio-sessioni.html'));
});

// Setup squadre circolo
app.get('/api/squadre', async (req, res) => {
    try {
        const configurazione = req.query.configurazione;

        if (!configurazione) {
            return res.status(400).json({ error: 'Parametro configurazione mancante' });
        }

        const result = await db.query(
            'SELECT * FROM squadre_circolo WHERE attiva = true AND configurazione_id = $1 ORDER BY numero',
            [configurazione]
        );

        console.log(`✅ Caricate ${result.rows.length} squadre per configurazione: ${configurazione}`);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per ottenere squadre con giocatori strutturati per gli incontri
app.get('/api/squadre-con-giocatori', async (req, res) => {
    try {
        const sessioneId = req.query.sessione;

        if (!sessioneId) {
            return res.status(400).json({ error: 'Parametro sessione mancante' });
        }

        console.log(`🔄 Caricamento squadre con giocatori per sessione: ${sessioneId}`);

        // Ottieni configurazione_id dalla sessione specificata (non più sessioneCorrente)
        const sessioneResult = await db.query(
            'SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1',
            [sessioneId]
        );

        if (sessioneResult.rows.length === 0) {
            return res.status(404).json({ error: 'Sessione corrente non trovata' });
        }

        const configurazioneId = sessioneResult.rows[0].configurazione_id;

        const result = await db.query(`
            SELECT numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3, attiva 
            FROM squadre_circolo 
            WHERE attiva = true AND configurazione_id = $1
            ORDER BY numero
        `, [configurazioneId]);

        // Trasforma i dati dal formato DB al formato necessario per gli incontri
        const squadre = result.rows.map(squadra => {
            // Crea array di giocatori strutturati
            const giocatori = [];

            // Aggiungi giocatori maschili
            for (let i = 1; i <= 7; i++) {
                const nomeGiocatore = squadra[`m${i}`];
                if (nomeGiocatore && nomeGiocatore.trim() !== '') {
                    giocatori.push({
                        posizione: `M${i}`,
                        nome: nomeGiocatore.trim()
                    });
                }
            }

            // Aggiungi giocatori femminili
            for (let i = 1; i <= 3; i++) {
                const nomeGiocatore = squadra[`f${i}`];
                if (nomeGiocatore && nomeGiocatore.trim() !== '') {
                    giocatori.push({
                        posizione: `F${i}`,
                        nome: nomeGiocatore.trim()
                    });
                }
            }

            return {
                numero: squadra.numero,
                colore: squadra.colore,
                giocatori: giocatori,
                attiva: squadra.attiva
            };
        });

        console.log(`✅ Caricate ${squadre.length} squadre con giocatori:`,
            squadre.map(s => `${s.colore} (${s.giocatori.length} giocatori)`));

        res.json(squadre);

    } catch (err) {
        console.error('❌ Errore API squadre-con-giocatori:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/squadre-complete', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3, attiva 
            FROM squadre_circolo 
            WHERE attiva = true 
            ORDER BY numero
        `);

        const squadre = result.rows.map(squadra => {
            // Crea array di giocatori strutturati
            const giocatori = [];

            // Aggiungi giocatori maschili
            for (let i = 1; i <= 7; i++) {
                const nomeGiocatore = squadra[`m${i}`];
                if (nomeGiocatore && nomeGiocatore.trim() !== '') {
                    giocatori.push({
                        posizione: `M${i}`,
                        nome: nomeGiocatore.trim()
                    });
                }
            }

            // Aggiungi giocatori femminili
            for (let i = 1; i <= 3; i++) {
                const nomeGiocatore = squadra[`f${i}`];
                if (nomeGiocatore && nomeGiocatore.trim() !== '') {
                    giocatori.push({
                        posizione: `F${i}`,
                        nome: nomeGiocatore.trim()
                    });
                }
            }

            return {
                numero: squadra.numero,
                colore: squadra.colore,
                giocatori: giocatori,
                attiva: squadra.attiva
            };
        });

        res.json(squadre);
    } catch (err) {
        console.error('Errore API squadre-complete:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== API INCONTRI ====================

// API per turni
app.get('/api/turni', async (req, res) => {
    try {
        // I turni sono globali, non legati a sessioni specifiche
        const result = await db.query(
            `SELECT id, turno_numero, nome_turno, descrizione, punti_vittoria 
             FROM turni_configurazione 
             WHERE attivo = true 
             ORDER BY turno_numero ASC`
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Errore recupero turni:", error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

app.post('/api/turni', async (req, res) => {
    try {
        const { turno_numero, nome_turno, descrizione, punti_vittoria } = req.body;

        // Verifica che il numero turno non esista già
        const existing = await db.query("SELECT id FROM turni_configurazione WHERE turno_numero = $1 AND attivo = true", [turno_numero]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Numero turno già esistente' });
        }

        const result = await db.query(`INSERT INTO turni_configurazione 
            (turno_numero, nome_turno, descrizione, punti_vittoria) 
            VALUES ($1, $2, $3, $4) RETURNING id`,
            [turno_numero, nome_turno, descrizione, punti_vittoria]);

        res.json({ message: 'Turno creato con successo', id: result.rows[0].id });
    } catch (err) {
        console.error('Errore POST turni:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per coppie turno
app.get('/api/coppie-turno/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;
        const result = await db.query(`SELECT c.*, ROW_NUMBER() OVER (ORDER BY c.id) as coppia_numero
            FROM coppie_turno c WHERE turno_id = $1 ORDER BY c.id`, [turnoId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API coppie-turno:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/coppie-turno', async (req, res) => {
    try {
        const { turno_id, pos1, pos2, squadra1, squadra2 } = req.body;

        // Calcola il numero della coppia
        const countResult = await db.query("SELECT COUNT(*) as count FROM coppie_turno WHERE turno_id = $1", [turno_id]);
        const coppia_numero = parseInt(countResult.rows[0].count) + 1;

        await db.query(`INSERT INTO coppie_turno 
            (turno_id, coppia_numero, pos1, pos2, squadra1, squadra2) 
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [turno_id, coppia_numero, pos1, pos2, squadra1, squadra2]);

        res.json({ message: 'Coppia aggiunta con successo' });
    } catch (err) {
        console.error('Errore POST coppie-turno:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/coppie-turno/:coppiaId', async (req, res) => {
    try {
        await db.query("DELETE FROM coppie_turno WHERE id = $1", [req.params.coppiaId]);
        res.json({ message: 'Coppia eliminata con successo' });
    } catch (err) {
        console.error('Errore DELETE coppie-turno:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== API SCONTRI SQUADRE ====================

// Salva scontro tra squadre
app.post('/api/scontri-squadre', async (req, res) => {
    try {
        const { turno_id, squadra1, squadra2 } = req.body;

        const result = await db.query(`
            INSERT INTO scontri_squadre (turno_id, squadra1, squadra2) 
            VALUES ($1, $2, $3) 
            RETURNING id`, [turno_id, squadra1, squadra2]);

        res.json({
            id: result.rows[0].id,
            message: 'Scontro salvato con successo'
        });
    } catch (err) {
        console.error('Errore POST scontri-squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni scontri squadre per turno
app.get('/api/scontri-squadre/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;
        const result = await db.query(`
            SELECT ss.*, 
                   s1.colore as colore_squadra1,
                   s2.colore as colore_squadra2
            FROM scontri_squadre ss
            LEFT JOIN squadre_circolo s1 ON ss.squadra1 = s1.numero
            LEFT JOIN squadre_circolo s2 ON ss.squadra2 = s2.numero
            WHERE ss.turno_id = $1 
            ORDER BY ss.id`, [turnoId]);

        res.json(result.rows);
    } catch (err) {
        console.error('Errore GET scontri-squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

// Elimina scontro squadre
app.delete('/api/scontri-squadre/:id', async (req, res) => {
    try {
        await db.query("DELETE FROM scontri_squadre WHERE id = $1", [req.params.id]);
        res.json({ message: 'Scontro eliminato con successo' });
    } catch (err) {
        console.error('Errore DELETE scontri-squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== API ACCOPPIAMENTI POSIZIONI ====================

// Salva accoppiamento posizioni
app.post('/api/accoppiamenti-posizioni', async (req, res) => {
    try {
        const { turno_id, pos1, pos2 } = req.body;

        const result = await db.query(`
            INSERT INTO accoppiamenti_posizioni (turno_id, pos1, pos2) 
            VALUES ($1, $2, $3) 
            RETURNING id`, [turno_id, pos1, pos2]);

        res.json({
            id: result.rows[0].id,
            message: 'Accoppiamento salvato con successo'
        });
    } catch (err) {
        console.error('Errore POST accoppiamenti-posizioni:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni accoppiamenti posizioni per turno
app.get('/api/accoppiamenti-posizioni/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;
        const result = await db.query(`
            SELECT * FROM accoppiamenti_posizioni 
            WHERE turno_id = $1 
            ORDER BY id`, [turnoId]);

        res.json(result.rows);
    } catch (err) {
        console.error('Errore GET accoppiamenti-posizioni:', err);
        res.status(500).json({ error: err.message });
    }
});

// Elimina accoppiamento posizioni
app.delete('/api/accoppiamenti-posizioni/:id', async (req, res) => {
    try {
        await db.query("DELETE FROM accoppiamenti_posizioni WHERE id = $1", [req.params.id]);
        res.json({ message: 'Accoppiamento eliminato con successo' });
    } catch (err) {
        console.error('Errore DELETE accoppiamenti-posizioni:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== API GENERAZIONE INCONTRI COMPLETA ====================

// Genera tutti gli incontri per un turno (scontri × accoppiamenti)
app.post('/api/genera-incontri-completi/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;

        // ✅ Prendi sessione_id dal BODY della richiesta
        const { sessione_id } = req.body;

        if (!sessione_id) {
            return res.status(400).json({
                error: 'sessione_id è richiesto nel body della richiesta'
            });
        }

        // ✅ Recupera configurazione_id dalla sessione
        const sessioneInfo = await db.query(
            'SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1',
            [sessione_id]
        );

        if (sessioneInfo.rows.length === 0) {
            return res.status(404).json({ error: 'Sessione non trovata' });
        }

        const configurazioneId = sessioneInfo.rows[0].configurazione_id;

        console.log(`🎯 Generazione incontri per turno ${turnoId}`);
        console.log(`   📍 Sessione: ${sessione_id}`);
        console.log(`   ⚙️ Configurazione: ${configurazioneId}`);

        // Inizio transazione
        await db.query('BEGIN');

        // 1. Ottieni scontri squadre per questo turno (dalla configurazione)
        const scontriResult = await db.query(`
            SELECT * FROM scontri_squadre 
            WHERE turno_id = $1`, [turnoId]);

        const scontri = scontriResult.rows;

        // 2. Ottieni accoppiamenti posizioni per questo turno
        const accoppiamentiResult = await db.query(`
            SELECT * FROM accoppiamenti_posizioni 
            WHERE turno_id = $1`, [turnoId]);

        const accoppiamenti = accoppiamentiResult.rows;

        if (scontri.length === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'Nessuno scontro configurato per questo turno' });
        }

        if (accoppiamenti.length === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'Nessun accoppiamento configurato per questo turno' });
        }

        // 3. ✅ Elimina solo gli incontri di QUESTA SESSIONE per questo turno
        const deleteResult = await db.query(
            "DELETE FROM incontri WHERE turno_id = $1 AND sessione_id = $2 RETURNING id",
            [turnoId, sessione_id]
        );
        console.log(`🗑️ Eliminati ${deleteResult.rowCount} incontri esistenti per questa sessione`);

        // Elimina anche le coppie_turno relative (se non usate da altre sessioni)
        await db.query("DELETE FROM coppie_turno WHERE turno_id = $1", [turnoId]);

        let incontriGenerati = 0;
        let coppiaNumero = 1;

        // 4. Per ogni scontro tra squadre
        for (const scontro of scontri) {
            console.log(`📋 Scontro: Squadra ${scontro.squadra1} vs Squadra ${scontro.squadra2}`);

            // 5. Per ogni accoppiamento di posizioni
            for (const accoppiamento of accoppiamenti) {
                console.log(`   ⚔️ Accoppiamento ${coppiaNumero}: ${accoppiamento.pos1} vs ${accoppiamento.pos2}`);

                // 6. Crea la coppia
                const coppiaResult = await db.query(`
                    INSERT INTO coppie_turno (turno_id, pos1, pos2, coppia_numero, squadra1, squadra2) 
                    VALUES ($1, $2, $3, $4, $5, $6) 
                    RETURNING id`,
                    [turnoId, accoppiamento.pos1, accoppiamento.pos2, coppiaNumero, scontro.squadra1, scontro.squadra2]);

                const coppiaId = coppiaResult.rows[0].id;

                // 7. ✅ Crea l'incontro CON sessione_id e configurazione_id
                await db.query(`
                    INSERT INTO incontri (turno_id, coppia_turno_id, squadra1, squadra2, sessione_id, configurazione_id) 
                    VALUES ($1, $2, $3, $4, $5, $6)`,
                    [turnoId, coppiaId, scontro.squadra1, scontro.squadra2, sessione_id, configurazioneId]);

                incontriGenerati++;
                coppiaNumero++;
            }
        }

        // Conferma transazione
        await db.query('COMMIT');

        console.log(`✅ Generati ${incontriGenerati} incontri per il turno ${turnoId} nella sessione ${sessione_id}`);

        res.json({
            message: 'Incontri generati con successo',
            count: incontriGenerati,
            scontri_configurati: scontri.length,
            accoppiamenti_configurati: accoppiamenti.length,
            sessione_id: sessione_id,
            configurazione_id: configurazioneId
        });

    } catch (err) {
        await db.query('ROLLBACK');
        console.error('❌ Errore generazione incontri completa:', err);
        res.status(500).json({ error: err.message });
    }
});

('/api/genera-incontri-completi/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;
        // ✅ AGGIUNGI: Recupera sessione_id dal turno
        const turnoResult = await db.query('SELECT sessione_id FROM turni_configurazione WHERE id = $1', [turnoId]);
        const sessioneId = turnoResult.rows[0]?.sessione_id || sessioneCorrente;
        console.log(`🎯 Generazione incontri per turno ${turnoId}, sessione: ${sessioneId}`);

        // 1. Inizio Transazione
        await db.query('BEGIN');

        // 2. Recupera tutte le coppie_turno per questo turno
        const coppieResult = await db.query(`
            SELECT id, pos1, pos2
            FROM coppie_turno
            WHERE turno_id = $1
        `, [turnoId]);
        const coppie = coppieResult.rows;

        // 3. Genera tutti gli scontri (Matchup) possibili tra le coppie
        const scontri = [];
        for (let i = 0; i < coppie.length; i++) {
            for (let j = i + 1; j < coppie.length; j++) {
                // Ogni scontro incrocia due coppie (Slot)
                scontri.push({
                    coppia1: coppie[i].id, // coppia_turno_id
                    coppia2: coppie[j].id, // coppia_turno_id

                    // Squadra 1 vs Squadra 2 (dati simulati, saranno reali in un sistema di squadre complesso)
                    squadra1: coppie[i].pos1,
                    squadra2: coppie[j].pos1
                    // N.B.: Pos1 e Pos2 qui rappresentano la squadra_id della coppia,
                    // in un sistema più complesso andrebbero recuperati i veri ID squadra.
                });
            }
        }

        // 4. Cancella gli incontri esistenti per questo turno
        await db.query('DELETE FROM incontri WHERE turno_id = $1', [turnoId]);

        // 5. Inserisce gli incontri generati
        const incontriCreati = [];
        for (const scontro of scontri) {
            // Qui assumo che squadra1 sia il ID della prima squadra, squadra2 il ID della seconda squadra
            const squadra1Id = scontro.squadra1;
            const squadra2Id = scontro.squadra2;

            // Inserisci l'incontro (es: Scontro tra Slot 1 e Slot 2)
            let coppiaId = scontro.coppia1;
            const incontroInsertResult = await db.query(`
                INSERT INTO incontri (turno_id, coppia_turno_id, sessione_id, squadra1, squadra2) 
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `, [turnoId, coppiaId, sessioneId, squadra1Id, squadra2Id]); // ✅sessioneId inserito

            incontriCreati.push(incontroInsertResult.rows[0].id);

            // Inserisci anche l'incontro speculare (per Slot 2 vs Slot 1) se necessario
            coppiaId = scontro.coppia2;
            const incontroInsertResult2 = await db.query(`
                INSERT INTO incontri (turno_id, coppia_turno_id, sessione_id, squadra1, squadra2) 
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `, [turnoId, coppiaId, sessioneId, squadra2Id, squadra1Id]); // ✅sessioneId inserito

            incontriCreati.push(incontroInsertResult2.rows[0].id);
        }

        await db.query('COMMIT');

        // Aggiorna tutti i client
        io.emit('dbUpdate');

        res.status(200).json({
            message: `Generati ${incontriCreati.length} incontri per il turno ${turnoId}.`,
            incontri: incontriCreati.length
        });

    } catch (err) {
        await db.query('ROLLBACK');
        console.error('Errore nella generazione incontri:', err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ==================== API MODIFICA TURNI ESISTENTI ====================

// Modifica turno esistente
app.put('/api/turni/:id', async (req, res) => {
    try {
        const turnoId = req.params.id;
        const { nome_turno, descrizione, punti_vittoria } = req.body;

        await db.query(`
            UPDATE turni_configurazione 
            SET nome_turno = $1, descrizione = $2, punti_vittoria = $3
            WHERE id = $4`,
            [nome_turno, descrizione, punti_vittoria, turnoId]);

        res.json({ message: 'Turno aggiornato con successo' });
    } catch (err) {
        console.error('Errore PUT turni:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== API STATISTICHE TURNO ====================

// Ottieni statistiche complete di un turno
app.get('/api/turno-statistiche/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;

        // Informazioni base turno
        const turnoResult = await db.query(`
            SELECT * FROM turni_configurazione 
            WHERE id = $1`, [turnoId]);

        if (turnoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Turno non trovato' });
        }

        const turno = turnoResult.rows[0];

        // Conta scontri
        const scontriResult = await db.query(`
            SELECT COUNT(*) as count FROM scontri_squadre 
            WHERE turno_id = $1`, [turnoId]);

        // Conta accoppiamenti
        const accoppiamentiResult = await db.query(`
            SELECT COUNT(*) as count FROM accoppiamenti_posizioni 
            WHERE turno_id = $1`, [turnoId]);

        // Conta incontri
        const incontriResult = await db.query(`
            SELECT 
                COUNT(*) as totali,
                COUNT(CASE WHEN completato = true THEN 1 END) as completati
            FROM incontri 
            WHERE turno_id = $1`, [turnoId]);

        res.json({
            turno: turno,
            statistiche: {
                scontri_configurati: parseInt(scontriResult.rows[0].count),
                accoppiamenti_configurati: parseInt(accoppiamentiResult.rows[0].count),
                incontri_totali: parseInt(incontriResult.rows[0].totali),
                incontri_completati: parseInt(incontriResult.rows[0].completati),
                incontri_rimanenti: parseInt(incontriResult.rows[0].totali) - parseInt(incontriResult.rows[0].completati)
            }
        });

    } catch (err) {
        console.error('Errore statistiche turno:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per ottenere incontri di un turno
app.get('/api/incontri-turno/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;
        const configurazione = req.query.configurazione;

        if (!configurazione) {
            return res.status(400).json({ error: 'Parametro configurazione mancante' });
        }

        const result = await db.query(`
            SELECT 
                i.*, 
                c.pos1, 
                c.pos2, 
                c.coppia_numero,
                CASE 
                    WHEN i.completato = true AND i.risultato_coppia1 = 'Vittoria' THEN i.squadra1
                    WHEN i.completato = true AND i.risultato_coppia2 = 'Vittoria' THEN i.squadra2
                    ELSE NULL 
                END as squadra_vincente
            FROM incontri i 
            JOIN coppie_turno c ON i.coppia_turno_id = c.id 
            WHERE i.turno_id = $1 AND i.configurazione_id = $2
            ORDER BY c.coppia_numero`,
            [turnoId, configurazione]
        );

        console.log(`✅ Caricati ${result.rows.length} incontri per turno ${turnoId}, configurazione: ${configurazione}`);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API incontri-turno:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/squadre', async (req, res) => {
    try {
        const { numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3, sessione_id } = req.body;

        // Usa sessione_id dal body, oppure sessioneCorrente
        const sessioneIdValue = sessione_id || sessioneCorrente;

        // Ottieni configurazione dalla sessione
        const sessione = await db.query('SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1', [sessioneIdValue]);
        const configurazioneId = sessione.rows[0]?.configurazione_id || 'default';

        console.log(`💾 Salvando squadra ${numero} - ${colore} nella configurazione: ${configurazioneId}`);

        // Prima elimina la squadra con lo stesso numero NELLA STESSA CONFIGURAZIONE
        // Poi inserisci la nuova (questo evita il problema del constraint)
        await db.query('BEGIN');

        try {
            // Elimina squadra esistente con stesso numero nella stessa configurazione
            await db.query(
                'DELETE FROM squadre_circolo WHERE numero = $1 AND configurazione_id = $2',
                [numero, configurazioneId]
            );

            // Inserisci la nuova squadra
            await db.query(`
                INSERT INTO squadre_circolo 
                (numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3, configurazione_id) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [numero, colore, m1, m2, m3, m4, m5, m6, m7, f1, f2, f3, configurazioneId]
            );

            await db.query('COMMIT');

            console.log(`✅ Squadra ${numero} - ${colore} salvata nella configurazione ${configurazioneId}`);
            res.json({ message: 'Squadra salvata con successo' });

        } catch (insertErr) {
            await db.query('ROLLBACK');
            throw insertErr;
        }

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

// API per eliminare un turno
app.delete('/api/turni/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;

        // Inizia transazione per eliminare tutto in cascata
        await db.query('BEGIN');

        // 1. Elimina risultati dettaglio degli incontri di questo turno
        await db.query(`DELETE FROM risultati_dettaglio 
            WHERE incontro_id IN (
                SELECT id FROM incontri WHERE turno_id = $1
            )`, [turnoId]);

        // 2. Elimina gli incontri
        await db.query("DELETE FROM incontri WHERE turno_id = $1", [turnoId]);

        // 3. Elimina le coppie
        await db.query("DELETE FROM coppie_turno WHERE turno_id = $1", [turnoId]);

        // 4. Elimina gli scontri squadre
        await db.query("DELETE FROM scontri_squadre WHERE turno_id = $1", [turnoId]);

        // 5. Elimina gli accoppiamenti posizioni
        await db.query("DELETE FROM accoppiamenti_posizioni WHERE turno_id = $1", [turnoId]);

        // 6. Elimina il turno
        const result = await db.query("DELETE FROM turni_configurazione WHERE id = $1", [turnoId]);

        await db.query('COMMIT');

        if (result.rowCount > 0) {
            res.json({ message: 'Turno eliminato con successo' });
        } else {
            res.status(404).json({ error: 'Turno non trovato' });
        }
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('Errore DELETE turno:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per accoppiamenti posizioni
app.get('/api/accoppiamenti-posizioni/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;
        const result = await db.query("SELECT * FROM accoppiamenti_posizioni WHERE turno_id = $1 ORDER BY id", [turnoId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API accoppiamenti-posizioni:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/accoppiamenti-posizioni', async (req, res) => {
    try {
        const { turno_id, pos1, pos2 } = req.body;

        // Verifica che non esista già lo stesso accoppiamento
        const existing = await db.query(`SELECT id FROM accoppiamenti_posizioni 
            WHERE turno_id = $1 AND ((pos1 = $2 AND pos2 = $3) OR (pos1 = $3 AND pos2 = $2))`,
            [turno_id, pos1, pos2]);

        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Accoppiamento già esistente tra queste posizioni' });
        }

        await db.query(`INSERT INTO accoppiamenti_posizioni (turno_id, pos1, pos2) 
            VALUES ($1, $2, $3)`, [turno_id, pos1, pos2]);

        res.json({ message: 'Accoppiamento aggiunto con successo' });
    } catch (err) {
        console.error('Errore POST accoppiamenti-posizioni:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/accoppiamenti-posizioni/:accoppiamentoId', async (req, res) => {
    try {
        await db.query("DELETE FROM accoppiamenti_posizioni WHERE id = $1", [req.params.accoppiamentoId]);
        res.json({ message: 'Accoppiamento eliminato con successo' });
    } catch (err) {
        console.error('Errore DELETE accoppiamenti-posizioni:', err);
        res.status(500).json({ error: err.message });
    }
});

// Setup partecipanti
app.get('/api/partecipanti', async (req, res) => {
    try {
        // 🆕 USA sessione_id dalla query string se presente
        const sessioneId = req.query.sessione_id || sessioneCorrente;

        console.log(`📊 Caricamento partecipanti per sessione: ${sessioneId}`);

        // 🆕 Query che supporta sia sessioni asta che draft
        // Per le sessioni con partecipanti_sessioni_accesso (draft), fa JOIN
        // Per le vecchie sessioni con sessione_id diretto, usa quello
        const result = await db.query(`
            SELECT DISTINCT p.* 
            FROM partecipanti_fantagts p
            LEFT JOIN partecipanti_sessioni_accesso psa ON p.id = psa.partecipante_id
            WHERE p.attivo = true 
            AND (p.sessione_id = $1 OR psa.sessione_id = $1)
            ORDER BY p.nome
        `, [sessioneId]);

        console.log(`✅ Trovati ${result.rows.length} partecipanti per sessione ${sessioneId}`);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API partecipanti:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partecipanti', async (req, res) => {
    try {
        const { nome } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'Nome richiesto' });
        }

        const nomeClean = nome.trim();

        // RECUPERA I CREDITI INIZIALI DALLA SESSIONE CORRENTE
        let crediti = 2000; // fallback di default
        if (sessioneCorrente) {
            const sessioneResult = await db.query(
                'SELECT crediti_iniziali FROM sessioni_fantagts WHERE id = $1',
                [sessioneCorrente]
            );
            if (sessioneResult.rows.length > 0) {
                crediti = sessioneResult.rows[0].crediti_iniziali || 2000;
                console.log(`ðŸ'° Crediti iniziali dalla sessione: ${crediti}`);
            }
        }

        // CONTROLLO DUPLICATI RAFFORZATO
        const duplicateCheck = await db.query(`
            SELECT id, nome, sessione_id FROM partecipanti_fantagts 
            WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) AND attivo = true
        `, [nomeClean]);

        if (duplicateCheck.rows.length > 0) {
            const existing = duplicateCheck.rows[0];
            if (existing.sessione_id === sessioneCorrente) {
                return res.status(409).json({
                    error: `Il nome "${nomeClean}" Ã¨ giÃ  registrato in questa sessione`,
                    action: 'login_required'
                });
            } else {
                return res.status(409).json({
                    error: `Il nome "${nomeClean}" Ã¨ giÃ  utilizzato in un'altra sessione`,
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

// ========================================
// API: Controlla disponibilità nickname
// ========================================
app.post('/api/check-nickname', async (req, res) => {
    try {
        const { nickname } = req.body;

        if (!nickname) {
            return res.status(400).json({ error: 'Nickname richiesto' });
        }

        const nicknameClean = nickname.trim();

        const result = await db.query(`
            SELECT id FROM partecipanti_fantagts 
            WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) 
            AND attivo = true 
            AND sessione_id = $2
        `, [nicknameClean, sessioneCorrente]);

        res.json({
            available: result.rows.length === 0,
            nickname: nicknameClean
        });

    } catch (error) {
        console.error('❌ Errore controllo nickname:', error);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ========================================
// API: Login con nickname e PIN
// ========================================
app.post('/api/login', async (req, res) => {
    try {
        const { nickname, pin } = req.body;

        if (!nickname || !pin) {
            return res.status(400).json({
                success: false,
                error: 'Nickname e PIN richiesti'
            });
        }

        const nicknameClean = nickname.trim();
        const pinClean = pin.trim();

        // Controllo nel database - cerca in TUTTE le sessioni
        const result = await db.query(`
            SELECT p.id, p.nome, p.crediti, p.pin
            FROM partecipanti_fantagts p
            WHERE LOWER(TRIM(p.nome)) = LOWER(TRIM($1)) 
            AND p.attivo = true
        `, [nicknameClean]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Utente non trovato'
            });
        }

        const player = result.rows[0];

        // Verifica PIN
        if (player.pin !== pinClean) {
            return res.status(401).json({
                success: false,
                error: 'PIN errato'
            });
        }

        // Login riuscito
        console.log(`✅ Login effettuato: ${player.nome}`);

        res.json({
            success: true,
            player: {
                id: player.id,
                nome: player.nome,
                crediti: player.crediti
            }
        });

    } catch (error) {
        console.error('❌ Errore login:', error);
        res.status(500).json({
            success: false,
            error: 'Errore server'
        });
    }
});

// ========================================
// API: Registrazione con nickname e PIN
// ========================================
app.post('/api/register', async (req, res) => {
    try {
        const { nickname, pin, crediti = 2000 } = req.body;

        if (!nickname || !pin) {
            return res.status(400).json({
                success: false,
                error: 'Nickname e PIN richiesti'
            });
        }

        const nicknameClean = nickname.trim();
        const pinClean = pin.trim();

        // Validazione PIN
        if (!/^\d{4}$/.test(pinClean)) {
            return res.status(400).json({
                success: false,
                error: 'Il PIN deve essere di 4 cifre numeriche'
            });
        }

        // Controlla se nickname già in uso
        const existingCheck = await db.query(`
            SELECT id FROM partecipanti_fantagts 
            WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) 
            AND attivo = true
        `, [nicknameClean]);

        if (existingCheck.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Nickname già in uso'
            });
        }

        // Genera ID dal nickname
        const id = nicknameClean.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

        // Inserimento nuovo partecipante
        const result = await db.query(`
            INSERT INTO partecipanti_fantagts (id, nome, pin, crediti, attivo)
            VALUES ($1, $2, $3, $4, true)
            RETURNING id, nome, crediti
        `, [id, nicknameClean, pinClean, crediti]);

        const player = result.rows[0];

        console.log(`✅ Nuovo partecipante registrato: ${player.nome} (ID: ${player.id})`);

        res.status(201).json({
            success: true,
            player: {
                id: player.id,
                nome: player.nome,
                crediti: player.crediti
            }
        });

    } catch (error) {
        console.error('❌ Errore registrazione:', error);
        res.status(500).json({
            success: false,
            error: 'Errore server durante la registrazione'
        });
    }
});
// Entra in sessione con codice
app.post('/api/join-session-with-code', async (req, res) => {
    try {
        const { partecipanteId, codiceSessione } = req.body;

        if (!partecipanteId || !codiceSessione) {
            return res.status(400).json({ error: 'Parametri mancanti' });
        }

        // Verifica codice sessione
        const sessioneResult = await db.query(
            'SELECT id, nome, anno, modalita, attiva, crediti_iniziali FROM sessioni_fantagts WHERE codice_accesso = $1',
            [codiceSessione.toUpperCase()]
        );

        if (sessioneResult.rows.length === 0) {
            return res.status(404).json({ error: 'Codice sessione non valido' });
        }

        const sessione = sessioneResult.rows[0];

        // Verifica che partecipante esista
        const partCheck = await db.query(
            'SELECT id, nome, crediti FROM partecipanti_fantagts WHERE id = $1',
            [partecipanteId]
        );

        if (partCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Partecipante non trovato' });
        }

        const partecipante = partCheck.rows[0];

        // 🆕 AGGIORNA I CREDITI DEL PARTECIPANTE CON I CREDITI DELLA SESSIONE
        const creditiSessione = sessione.crediti_iniziali || 2000;

        // Solo se i crediti sono diversi da quelli della sessione (evita update inutili)
        if (partecipante.crediti !== creditiSessione) {
            await db.query(
                'UPDATE partecipanti_fantagts SET crediti = $1, sessione_id = $2 WHERE id = $3',
                [creditiSessione, sessione.id, partecipanteId]
            );
            console.log(`💰 Crediti aggiornati per ${partecipante.nome}: ${partecipante.crediti} → ${creditiSessione}`);
        } else {
            // Aggiorna solo la sessione
            await db.query(
                'UPDATE partecipanti_fantagts SET sessione_id = $1 WHERE id = $2',
                [sessione.id, partecipanteId]
            );
        }

        // Registra accesso (INSERT o UPDATE ultimo_accesso)
        await db.query(`
            INSERT INTO partecipanti_sessioni_accesso (partecipante_id, sessione_id, ultimo_accesso)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (partecipante_id, sessione_id) 
            DO UPDATE SET ultimo_accesso = CURRENT_TIMESTAMP
        `, [partecipanteId, sessione.id]);

        console.log(`✅ Partecipante ${partecipanteId} collegato a sessione ${sessione.nome} con ${creditiSessione} crediti`);

        // 🆕 Ritorna anche i crediti aggiornati
        res.json({
            success: true,
            sessione: sessione,
            crediti: creditiSessione,  // 🆕 Aggiungi i crediti nella risposta
            message: `Accesso garantito alla sessione "${sessione.nome}"`
        });

    } catch (err) {
        console.error('Errore join-session-with-code:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni sessioni a cui il partecipante ha accesso
app.get('/api/my-sessions/:partecipanteId', async (req, res) => {
    try {
        const partecipanteId = req.params.partecipanteId;

        const result = await db.query(`
            SELECT 
                s.id, 
                s.nome, 
                s.anno, 
                s.codice_accesso,
                s.modalita,
                s.attiva,
                s.stato,
                psa.primo_accesso,
                psa.ultimo_accesso
            FROM partecipanti_sessioni_accesso psa
            JOIN sessioni_fantagts s ON psa.sessione_id = s.id
            WHERE psa.partecipante_id = $1
            ORDER BY psa.ultimo_accesso DESC
        `, [partecipanteId]);

        res.json({
            success: true,
            sessioni: result.rows
        });

    } catch (err) {
        console.error('Errore my-sessions:', err);
        res.status(500).json({ error: err.message });
    }
});

// 🆕 Ottieni partecipante di una sessione per nome (case-insensitive)
app.get('/api/sessioni/:sessionId/partecipante/:nome', async (req, res) => {
    try {
        const { sessionId, nome } = req.params;

        // 🆕 CERCA nella tabella degli accessi, poi prendi i dati del partecipante
        const result = await db.query(
            `SELECT p.id, p.nome, p.crediti 
             FROM partecipanti_sessioni_accesso psa
             JOIN partecipanti_fantagts p ON psa.partecipante_id = p.id
             WHERE psa.sessione_id = $1 AND LOWER(p.nome) = LOWER($2)`,
            [sessionId, nome]
        );

        if (result.rows.length === 0) {
            console.error(`❌ Partecipante non trovato: sessione=${sessionId}, nome=${nome}`);
            return res.status(404).json({ error: 'Partecipante non trovato' });
        }

        console.log(`✅ Partecipante trovato:`, result.rows[0]);
        res.json(result.rows[0]);

    } catch (err) {
        console.error('Errore API partecipante:', err);
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
        // Ottieni configurazione_id: prima dal body/query, poi dalla sessione corrente
        let configurazioneId = req.query.configurazione_id || req.body.configurazione_id;

        if (!configurazioneId) {
            const sessioneId = req.query.sessione || req.body.sessione_id || sessioneCorrente;
            const sessione = await db.query('SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1', [sessioneId]);
            configurazioneId = sessione.rows[0]?.configurazione_id || 'default';
        }

        console.log('🎯 Richiesta generazione slots...');
        console.log('📌 Configurazione:', configurazioneId);

        const result = await generaSlots(configurazioneId);

        console.log('✅ Slots generati con successo:', result);
        res.json({ message: 'Slots generati con successo', count: result });
    } catch (err) {
        console.error('❌ ERRORE genera-slots:', err.message);
        console.error('Stack completo:', err.stack);
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

        // Ottieni configurazione dalla sessione corrente
        const sessione = await db.query('SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1', [sessioneCorrente]);
        const configurazioneId = sessione.rows[0]?.configurazione_id || 'default';

        const result = await db.query("SELECT * FROM slots WHERE id = $1 AND configurazione_id = $2", [slotId, configurazioneId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Slot non trovato' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Errore slot-info:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Ottieni tutti gli slots (con filtro sessione)
app.get('/api/slots', async (req, res) => {
    try {
        const sessioneId = req.query.sessione || sessioneCorrente;

        // Ottieni configurazione dalla sessione
        const sessione = await db.query('SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1', [sessioneId]);
        const configurazioneId = sessione.rows[0]?.configurazione_id || 'default';

        const result = await db.query(
            'SELECT * FROM slots WHERE configurazione_id = $1 ORDER BY posizione, colore',
            [configurazioneId]
        );

        console.log(`✅ Slots caricati per configurazione ${configurazioneId}: ${result.rows.length}`);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API slots:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni squadra di un partecipante
app.get('/api/squadra-partecipante/:partecipanteId', async (req, res) => {
    try {
        const partecipanteId = req.params.partecipanteId;
        // ✅ AGGIUNGI QUESTA RIGA
        const sessioneId = req.query.sessione_id;

        // ✅ AGGIUNGI VALIDAZIONE
        if (!sessioneId) {
            return res.status(400).json({ error: 'sessione_id è richiesto come parametro query' });
        }

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
            WHERE a.partecipante_id = $1 
            AND a.vincitore = true 
            AND a.sessione_id = $2
            ORDER BY s.posizione`, [partecipanteId, sessioneId]); // ✅ USA sessioneId invece di sessioneCorrente

        // Ottieni crediti aggiornati
        const creditiResult = await db.query(`SELECT crediti FROM partecipanti_fantagts WHERE id = $1 AND sessione_id = $2`, [partecipanteId, sessioneId]); // ✅ AGGIUNGI filtro sessione

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
    const { sessioneId } = req.body; // 🆕 LEGGI sessioneId dal body
    // 🆕 USA sessioneId se fornito, altrimenti fallback a sessioneCorrente
    const sessione = sessioneId || sessioneCorrente;
    gameState.sessioneCorrente = sessione;
    console.log(`🎯 Avvio round ${round} per sessione:`, sessione);  // 🔧 PARENTESI TONDE
    if (gameState.asteAttive) {
        return res.status(400).json({ error: 'Un round è già attivo' });
    }
    try {
        // Ottieni tutti i partecipanti dal database
        const partecipantiResult = await db.query(`
        SELECT DISTINCT p.id, p.nome 
        FROM partecipanti_fantagts p
        INNER JOIN partecipanti_sessioni_accesso psa ON p.id = psa.partecipante_id
        WHERE p.attivo = true 
        AND psa.sessione_id = $1
    `, [sessione]);

        // Ottieni tutti i slots disponibili per questo round
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
        // Ottieni TUTTI i partecipanti dal database
        const partecipantiResult = await db.query(`
        SELECT DISTINCT p.id, p.nome 
        FROM partecipanti_fantagts p
        INNER JOIN partecipanti_sessioni_accesso psa ON p.id = psa.partecipante_id
        WHERE p.attivo = true 
        AND psa.sessione_id = $1
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
        // 🆕 USA sessione_id dalla query string se presente, altrimenti usa sessioneCorrente
        const sessioneId = req.query.sessione_id || sessioneCorrente;

        console.log(`📊 Caricamento aste round ${round}, sessione: ${sessioneId}`);

        const result = await db.query(`SELECT a.*, p.nome as partecipante_nome, s.giocatore_attuale, s.colore 
        FROM aste a 
        JOIN partecipanti_fantagts p ON a.partecipante_id = p.id 
        JOIN slots s ON a.slot_id = s.id 
        WHERE a.round = $1 
        AND a.vincitore = true 
        AND a.sessione_id = $2
        ORDER BY a.costo_finale DESC`, [round, sessioneId]);

        res.json(result.rows);
    } catch (err) {
        console.error('Errore aste-round:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ottieni classifica generale
app.get('/api/classifica', async (req, res) => {
    try {
        // Ottieni configurazione dalla sessione
        const sessione = await db.query('SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1', [sessioneCorrente]);
        const configurazioneId = sessione.rows[0]?.configurazione_id || 'default';

        const result = await db.query(`SELECT 
            p.id, p.nome, p.crediti, 
            COUNT(a.id) as giocatori_totali,
            COALESCE(SUM(s.punti_totali), 0) as punti_totali,
            COALESCE(SUM(a.costo_finale), 0) as crediti_spesi
            FROM partecipanti_fantagts p 
            LEFT JOIN aste a ON p.id = a.partecipante_id AND a.vincitore = true AND a.sessione_id = $1
            LEFT JOIN slots s ON a.slot_id = s.id AND s.configurazione_id = $2
            WHERE p.sessione_id = $1 AND p.attivo = true
            GROUP BY p.id, p.nome, p.crediti 
            ORDER BY punti_totali DESC, crediti_spesi ASC`, [sessioneCorrente, configurazioneId]);

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

// 🆕 Ottieni classifica DRAFT
app.get('/api/classifica-draft', async (req, res) => {
    try {
        const { sessione_id } = req.query;

        if (!sessione_id) {
            return res.status(400).json({ error: 'sessione_id richiesto' });
        }

        // Ottieni configurazione dalla sessione
        const sessione = await db.query('SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1', [sessione_id]);
        const configurazioneId = sessione.rows[0]?.configurazione_id || 'default';

        const result = await db.query(`
    SELECT 
        p.id, 
        p.nome, 
        COUNT(sd.id) as giocatori_totali,
        COALESCE(SUM(s.punti_totali), 0) as punti_totali
    FROM partecipanti_fantagts p 
    INNER JOIN partecipanti_sessioni_accesso psa ON p.id = psa.partecipante_id
    LEFT JOIN squadre_draft sd ON p.id = sd.partecipante_id AND sd.sessione_id = $1
    LEFT JOIN slots s ON sd.slot_id = s.id AND s.configurazione_id = $2
    WHERE psa.sessione_id = $1 AND p.attivo = true
    GROUP BY p.id, p.nome
    ORDER BY punti_totali DESC
`, [sessione_id, configurazioneId]);

        // Aggiungi posizione in classifica
        const classifica = result.rows.map((row, index) => {
            row.posizione = index + 1;
            return row;
        });

        console.log('✅ Classifica DRAFT caricata:', classifica.length, 'partecipanti');
        res.json(classifica);
    } catch (err) {
        console.error('Errore classifica draft:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== NUOVE API PER SCONTRI E ACCOPPIAMENTI ====================

// API per scontri tra squadre
app.get('/api/scontri-squadre/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;
        const result = await db.query("SELECT * FROM scontri_squadre WHERE turno_id = $1 ORDER BY id", [turnoId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API scontri-squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/scontri-squadre', async (req, res) => {
    try {
        const { turno_id, squadra1, squadra2 } = req.body;

        // Verifica che non esista già lo stesso scontro
        const existing = await db.query(`SELECT id FROM scontri_squadre 
            WHERE turno_id = $1 AND ((squadra1 = $2 AND squadra2 = $3) OR (squadra1 = $3 AND squadra2 = $2))`,
            [turno_id, squadra1, squadra2]);

        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Scontro già esistente tra queste squadre' });
        }

        await db.query(`INSERT INTO scontri_squadre (turno_id, squadra1, squadra2) 
            VALUES ($1, $2, $3)`, [turno_id, squadra1, squadra2]);

        res.json({ message: 'Scontro aggiunto con successo' });
    } catch (err) {
        console.error('Errore POST scontri-squadre:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/scontri-squadre/:scontroId', async (req, res) => {
    try {
        await db.query("DELETE FROM scontri_squadre WHERE id = $1", [req.params.scontroId]);
        res.json({ message: 'Scontro eliminato con successo' });
    } catch (err) {
        console.error('Errore DELETE scontri-squadre:', err);
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

// API per ottenere risultati degli scontri per l'overview
app.get('/api/risultati-scontri/:turnoId', async (req, res) => {
    try {
        const turnoId = req.params.turnoId;

        const result = await db.query(`
            SELECT 
                i.id as incontro_id,
                i.squadra1, 
                i.squadra2,
                i.completato,
                rd.posizione,
                rd.vincitore,
                sc1.colore as colore_squadra1,
                sc2.colore as colore_squadra2
            FROM incontri i
            JOIN squadre_circolo sc1 ON i.squadra1 = sc1.numero
            JOIN squadre_circolo sc2 ON i.squadra2 = sc2.numero
            LEFT JOIN risultati_dettaglio rd ON i.id = rd.incontro_id
            WHERE i.turno_id = $1
            ORDER BY i.squadra1, i.squadra2, rd.posizione
        `, [turnoId]);

        res.json(result.rows);
    } catch (err) {
        console.error('Errore API risultati-scontri:', err);
        res.status(500).json({ error: err.message });
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

// API per dettagli incontro
app.get('/api/dettagli-incontro/:incontroId', async (req, res) => {
    try {
        const incontroId = req.params.incontroId;
        const result = await db.query("SELECT * FROM risultati_dettaglio WHERE incontro_id = $1", [incontroId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Errore API dettagli-incontro:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per impostare vincitore di una posizione
app.post('/api/set-vincitore', async (req, res) => {
    try {
        const { incontro_id, posizione, vincitore, giocatore_squadra1, giocatore_squadra2, punti_assegnati } = req.body;

        // Verifica se esiste già un risultato per questa posizione
        const existing = await db.query("SELECT id FROM risultati_dettaglio WHERE incontro_id = $1 AND posizione = $2",
            [incontro_id, posizione]);

        if (existing.rows.length > 0) {
            // Aggiorna esistente
            await db.query(`UPDATE risultati_dettaglio 
                SET vincitore = $1, giocatore_squadra1 = $2, giocatore_squadra2 = $3, punti_assegnati = $4
                WHERE incontro_id = $5 AND posizione = $6`,
                [vincitore, giocatore_squadra1, giocatore_squadra2, punti_assegnati, incontro_id, posizione]);
        } else {
            // Inserisci nuovo
            await db.query(`INSERT INTO risultati_dettaglio 
                (incontro_id, posizione, vincitore, giocatore_squadra1, giocatore_squadra2, punti_assegnati)
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [incontro_id, posizione, vincitore, giocatore_squadra1, giocatore_squadra2, punti_assegnati]);
        }

        res.json({ message: 'Vincitore impostato con successo' });
    } catch (err) {
        console.error('Errore API set-vincitore:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per completare un incontro
app.post('/api/completa-incontro/:incontroId', async (req, res) => {
    try {
        const incontroId = req.params.incontroId;
        const sessioneId = req.query.sessione || req.body.sessione || sessioneCorrente;

        console.log(`📊 Completamento incontro ${incontroId} per sessione: ${sessioneId}`);

        // Verifica che ci siano risultati per tutte le posizioni
        const incontroResult = await db.query(`SELECT i.*, c.pos1, c.pos2 
            FROM incontri i 
            JOIN coppie_turno c ON i.coppia_turno_id = c.id 
            WHERE i.id = $1`, [incontroId]);

        if (incontroResult.rows.length === 0) {
            return res.status(404).json({ error: 'Incontro non trovato' });
        }

        const incontro = incontroResult.rows[0];
        const posizioni = [incontro.pos1, incontro.pos2];

        // Verifica che ci siano risultati per tutte le posizioni
        const risultatiResult = await db.query("SELECT * FROM risultati_dettaglio WHERE incontro_id = $1", [incontroId]);
        const risultati = risultatiResult.rows;

        const posizioniConRisultato = risultati.map(r => r.posizione);
        const mancanti = posizioni.filter(pos => !posizioniConRisultato.includes(pos));

        if (mancanti.length > 0) {
            return res.status(400).json({
                error: `Mancano risultati per le posizioni: ${mancanti.join(', ')}`
            });
        }

        // Calcola risultato finale
        let vittorie_squadra1 = 0;
        let vittorie_squadra2 = 0;

        risultati.forEach(r => {
            if (r.vincitore === 1) vittorie_squadra1++;
            else if (r.vincitore === 2) vittorie_squadra2++;
        });

        let risultato_coppia1, risultato_coppia2;
        if (vittorie_squadra1 > vittorie_squadra2) {
            risultato_coppia1 = 'Vittoria';
            risultato_coppia2 = 'Sconfitta';
        } else if (vittorie_squadra2 > vittorie_squadra1) {
            risultato_coppia1 = 'Sconfitta';
            risultato_coppia2 = 'Vittoria';
        } else {
            risultato_coppia1 = 'Pareggio';
            risultato_coppia2 = 'Pareggio';
        }

        // Aggiorna incontro come completato
        await db.query(`UPDATE incontri 
            SET completato = true, risultato_coppia1 = $1, risultato_coppia2 = $2, inserito_da = 'Master'
            WHERE id = $3`,
            [risultato_coppia1, risultato_coppia2, incontroId]);

        // Aggiorna punti nei slots (solo per i vincitori)
        // 🔍 DEBUG: Verifica esistenza slots per questa configurazione
        const sessione = await db.query('SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1', [sessioneId]);
        const configurazioneId = sessione.rows[0]?.configurazione_id || 'default';

        const debugSlots = await db.query(
            "SELECT id, squadra_numero, colore, posizione, configurazione_id FROM slots WHERE configurazione_id = $1 LIMIT 5",
            [configurazioneId]
        );
        console.log(`🔍 DEBUG: Trovati ${debugSlots.rows.length} slots per configurazione ${configurazioneId}:`, debugSlots.rows);

        for (const risultato of risultati) {
            if (risultato.vincitore > 0 && risultato.punti_assegnati > 0) {
                const squadraVincitrice = risultato.vincitore === 1 ? incontro.squadra1 : incontro.squadra2;

                // Trova i dettagli della squadra vincitrice (filtrata per configurazione!)
                const squadreResult = await db.query(
                    "SELECT colore FROM squadre_circolo WHERE numero = $1 AND configurazione_id = $2",
                    [squadraVincitrice, configurazioneId]
                );

                if (squadreResult.rows.length > 0) {
                    const coloreSquadra = squadreResult.rows[0].colore;
                    const slotId = `${risultato.posizione}_SQ${squadraVincitrice}_${coloreSquadra.toUpperCase()}`;

                    console.log(`Aggiornando punti per slot ${slotId}: +${risultato.punti_assegnati} punti`);

                    // Aggiorna i punti dello slot specifico (lo slotId è univoco per configurazione)
                    const updateResult = await db.query(
                        "UPDATE slots SET punti_totali = punti_totali + $1 WHERE id = $2 RETURNING punti_totali",
                        [risultato.punti_assegnati, slotId]
                    );

                    if (updateResult.rows.length === 0) {
                        console.warn(`⚠️ Slot ${slotId} non trovato!`);
                    } else {
                        console.log(`✅ Slot ${slotId} aggiornato. Punti totali: ${updateResult.rows[0].punti_totali}`);
                    }
                }
            }
        }

        // 🆕 EMIT SOCKET.IO: Notifica aggiornamento punti a tutti i client
        console.log('📡 Emissione evento aggiornamento_punti via Socket.io');
        io.emit('aggiornamento_punti', {
            incontroId: incontroId,
            sessioneId: sessioneId,
            timestamp: new Date().toISOString()
        });

        res.json({
            message: 'Incontro completato con successo',
            risultato: `${risultato_coppia1} vs ${risultato_coppia2}`,
            vittorie_squadra1: vittorie_squadra1,
            vittorie_squadra2: vittorie_squadra2
        });
    } catch (err) {
        console.error('Errore API completa-incontro:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per resettare un incontro
app.post('/api/reset-incontro/:incontroId', async (req, res) => {
    try {
        const incontroId = req.params.incontroId;
        const sessioneId = req.query.sessione || req.body.sessione || sessioneCorrente;

        console.log(`🔄 Reset incontro ${incontroId} - Rimuovendo punti...`);

        // 1. Prima di eliminare i risultati, salviamo i punti da togliere
        const risultatiDaRimuovere = await db.query(
            "SELECT * FROM risultati_dettaglio WHERE incontro_id = $1",
            [incontroId]
        );

        console.log(`📋 Trovati ${risultatiDaRimuovere.rows.length} risultati da rimuovere:`, risultatiDaRimuovere.rows);

        // 🚀 OTTIMIZZAZIONE: Carica l'incontro UNA SOLA VOLTA (non per ogni risultato)
        const incontroResult = await db.query(`
            SELECT i.squadra1, i.squadra2, i.configurazione_id
            FROM incontri i 
            WHERE i.id = $1`, [incontroId]
        );

        if (incontroResult.rows.length === 0) {
            return res.status(404).json({ error: 'Incontro non trovato' });
        }

        const incontro = incontroResult.rows[0];

        // 2. Per ogni risultato, togliamo i punti dalla tabella slots
        for (const risultato of risultatiDaRimuovere.rows) {
            if (risultato.vincitore > 0 && risultato.punti_assegnati > 0) {

                // Determina quale squadra ha vinto
                const squadraVincitrice = risultato.vincitore === 1 ?
                    incontro.squadra1 : incontro.squadra2;

                // Trova il colore della squadra vincitrice (filtrata per configurazione!)
                const squadreResult = await db.query(
                    "SELECT colore FROM squadre_circolo WHERE numero = $1 AND configurazione_id = $2",
                    [squadraVincitrice, incontro.configurazione_id]
                );

                if (squadreResult.rows.length > 0) {
                    const coloreSquadra = squadreResult.rows[0].colore;
                    const slotId = `${risultato.posizione}_SQ${squadraVincitrice}_${coloreSquadra.toUpperCase()}`;

                    console.log(`➖ Rimuovendo ${risultato.punti_assegnati} punti da slot ${slotId}`);

                    // TOGLIE i punti (usa sottrazione invece di addizione)
                    const updateResult = await db.query(
                        "UPDATE slots SET punti_totali = punti_totali - $1 WHERE id = $2 RETURNING punti_totali",
                        [risultato.punti_assegnati, slotId]
                    );

                    if (updateResult.rows.length > 0) {
                        console.log(`✅ Slot ${slotId} aggiornato. Punti rimanenti: ${updateResult.rows[0].punti_totali}`);
                    } else {
                        console.warn(`⚠️ Slot ${slotId} non trovato!`);
                    }
                }
            }
        }

        // 3. Ora elimina i risultati dettaglio
        await db.query("DELETE FROM risultati_dettaglio WHERE incontro_id = $1", [incontroId]);

        // 4. Reset stato incontro
        await db.query(`UPDATE incontri 
            SET completato = false, risultato_coppia1 = NULL, risultato_coppia2 = NULL
            WHERE id = $1`, [incontroId]);

        console.log(`✅ Incontro ${incontroId} resettato completamente`);

        // 🆕 EMIT SOCKET.IO: Notifica aggiornamento punti dopo reset
        console.log('📡 Emissione evento aggiornamento_punti dopo reset via Socket.io');
        io.emit('aggiornamento_punti', {
            incontroId: incontroId,
            sessioneId: sessioneId,
            timestamp: new Date().toISOString(),
            tipo: 'reset'
        });

        res.json({
            message: 'Incontro resettato con successo',
            punti_rimossi: risultatiDaRimuovere.rows.length
        });

    } catch (err) {
        console.error('❌ Errore API reset-incontro:', err);
        res.status(500).json({ error: err.message });
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
            // 🆕 USA la sessione dal gameState se disponibile
            const sessione = gameState.sessioneCorrente || sessioneCorrente;

            // NUOVO: Ottieni TUTTI i partecipanti dal database
            const partecipantiResult = await db.query(`
                SELECT DISTINCT p.id, p.nome 
                FROM partecipanti_fantagts p
                INNER JOIN partecipanti_sessioni_accesso psa ON p.id = psa.partecipante_id
                WHERE p.attivo = true 
                AND psa.sessione_id = $1
            `, [sessione]);  // 🔧 USA sessione invece di sessioneCorrente

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

// ==================== API SOSTITUZIONI ====================

// ==================== API CONFIGURAZIONI ====================

// GET: Lista tutte le configurazioni
app.get('/api/configurazioni', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                c.*,
                COUNT(DISTINCT s.id) as sessioni_collegate,
                COUNT(DISTINCT sq.numero) as squadre_count
            FROM configurazioni c
            LEFT JOIN sessioni_fantagts s ON s.configurazione_id = c.id
            LEFT JOIN squadre_circolo sq ON sq.configurazione_id = c.id AND sq.attiva = true
            GROUP BY c.id, c.nome, c.anno, c.descrizione, c.numero_squadre, c.created_at, c.last_modified
            ORDER BY c.created_at DESC
        `);
        
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Errore caricamento configurazioni:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Dettagli singola configurazione
app.get('/api/configurazioni/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const configResult = await db.query(
            'SELECT * FROM configurazioni WHERE id = $1',
            [id]
        );
        
        if (configResult.rows.length === 0) {
            return res.status(404).json({ error: 'Configurazione non trovata' });
        }
        
        const config = configResult.rows[0];
        
        // Carica anche le squadre associate
        const squadreResult = await db.query(
            'SELECT * FROM squadre_circolo WHERE configurazione_id = $1 AND attiva = true ORDER BY numero',
            [id]
        );
        
        config.squadre = squadreResult.rows;
        
        res.json(config);
    } catch (err) {
        console.error('❌ Errore caricamento configurazione:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Crea nuova configurazione
app.post('/api/configurazioni', async (req, res) => {
    try {
        const { nome, anno, descrizione, numero_squadre } = req.body;

        if (!nome) {
            return res.status(400).json({ error: 'Nome configurazione richiesto' });
        }

        // --- RIGA MODIFICATA: Utilizzo di slice() anziché substr() ---
        const id = `config_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        const result = await db.query(`
            INSERT INTO configurazioni (id, nome, anno, descrizione, numero_squadre)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [id, nome, anno || null, descrizione || '', numero_squadre || 10]);

        console.log('✅ Configurazione creata:', id);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore creazione configurazione:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT: Aggiorna configurazione
app.put('/api/configurazioni/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, anno, descrizione, numero_squadre } = req.body;
        
        const result = await db.query(`
            UPDATE configurazioni 
            SET nome = $1, anno = $2, descrizione = $3, numero_squadre = $4, last_modified = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `, [nome, anno, descrizione, numero_squadre, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Configurazione non trovata' });
        }
        
        console.log('✅ Configurazione aggiornata:', id);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore aggiornamento configurazione:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Elimina configurazione (solo se non ha sessioni attive)
app.delete('/api/configurazioni/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verifica se ci sono sessioni attive che usano questa configurazione
        const sessioniAttive = await db.query(
            'SELECT COUNT(*) as count FROM sessioni_fantagts WHERE configurazione_id = $1 AND attiva = true',
            [id]
        );
        
        if (parseInt(sessioniAttive.rows[0].count) > 0) {
            return res.status(400).json({ 
                error: 'Impossibile eliminare: ci sono sessioni attive che usano questa configurazione' 
            });
        }
        
        await db.query('DELETE FROM configurazioni WHERE id = $1', [id]);
        
        console.log('✅ Configurazione eliminata:', id);
        res.json({ message: 'Configurazione eliminata con successo' });
    } catch (err) {
        console.error('❌ Errore eliminazione configurazione:', err);
        res.status(500).json({ error: err.message });
    }
});

// Route per servire la pagina sostituzioni
app.get('/sostituzioni', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sostituzioni.html'));
});

// API per gestire le sostituzioni
app.post('/api/sostituzioni', async (req, res) => {
    try {
        const { numeroSquadra, posizione, nomeVecchio, nomeNuovo, motivo } = req.body;

        console.log(`🔄 Richiesta sostituzione: Squadra ${numeroSquadra}, ${posizione}: "${nomeVecchio}" → "${nomeNuovo}"`);

        // Validazione input
        if (!numeroSquadra || !posizione || !nomeVecchio || !nomeNuovo) {
            return res.status(400).json({ error: 'Dati mancanti per la sostituzione' });
        }

        // Determina il campo da aggiornare (m1, m2, ..., f1, f2, f3)
        const campo = posizione.toLowerCase();

        // 🆕 TROVA IL COLORE DELLA SQUADRA per identificare lo slot
        const squadraResult = await db.query(
            'SELECT colore FROM squadre_circolo WHERE numero = $1',
            [numeroSquadra]
        );

        if (squadraResult.rows.length === 0) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }

        const coloreSquadra = squadraResult.rows[0].colore;
        const slotId = `${posizione}_${coloreSquadra.toUpperCase()}`;

        console.log(`🎯 Slot identificato: ${slotId}`);

        // 🆕 TROVA TUTTI I PARTECIPANTI CHE POSSIEDONO QUESTO GIOCATORE
        const partecipantiCoinvolti = await db.query(`
            SELECT DISTINCT p.id, p.nome
            FROM partecipanti_fantagts p
            JOIN aste a ON p.id = a.partecipante_id
            WHERE a.slot_id = $1 
              AND a.vincitore = true
              AND p.attivo = true
              AND p.sessione_id = $2
        `, [slotId, sessioneCorrente]);

        console.log(`👥 Trovati ${partecipantiCoinvolti.rows.length} partecipanti da notificare`);

        // Aggiorna il nome nella tabella squadre_circolo
        await db.query(
            `UPDATE squadre_circolo SET ${campo} = $1 WHERE numero = $2`,
            [nomeNuovo, numeroSquadra]
        );

        // 🆕 AGGIORNA ANCHE IL NOME NELLO SLOT
        await db.query(
            'UPDATE slots SET giocatore_attuale = $1 WHERE id = $2',
            [nomeNuovo, slotId]
        );

        // Registra la sostituzione nella tabella sostituzioni (se esiste)
        try {
            await db.query(
                `INSERT INTO sostituzioni (squadra_numero, posizione, giocatore_vecchio, giocatore_nuovo, motivo, timestamp)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [numeroSquadra, posizione, nomeVecchio, nomeNuovo, motivo || null]
            );
        } catch (err) {
            console.log('ℹ️ Tabella sostituzioni non disponibile, continuo comunque');
        }

        // 🆕 INVIA NOTIFICHE AI PARTECIPANTI COINVOLTI
        if (partecipantiCoinvolti.rows.length > 0) {
            const idsPartecipanti = partecipantiCoinvolti.rows.map(p => p.id);

            const messaggioNotifica = motivo
                ? `Il tuo giocatore ${nomeVecchio} (${posizione} - Squadra ${coloreSquadra}) è stato sostituito con ${nomeNuovo}. Motivo: ${motivo}`
                : `Il tuo giocatore ${nomeVecchio} (${posizione} - Squadra ${coloreSquadra}) è stato sostituito con ${nomeNuovo}`;

            await inviaNotifichePush({
                title: '🔄 Sostituzione Giocatore',
                body: messaggioNotifica,
                url: '/#section-classifica',
                targetUsers: idsPartecipanti
            });

            console.log(`✅ Notifiche inviate a: ${partecipantiCoinvolti.rows.map(p => p.nome).join(', ')}`);
        } else {
            console.log('ℹ️ Nessun partecipante possiede questo giocatore, nessuna notifica inviata');
        }

        console.log(`✅ Sostituzione completata con successo`);

        res.json({
            success: true,
            message: `${nomeVecchio} sostituito con ${nomeNuovo}`,
            notifiche_inviate: partecipantiCoinvolti.rows.length
        });

    } catch (err) {
        console.error('❌ Errore sostituzione:', err);
        res.status(500).json({ error: err.message });
    }
});

function terminaRound() {
    console.log('🔄 terminaRound chiamato - elaborando risultati asta');

    // NON settare asteAttive = false qui, perché potrebbe continuare il round
    // gameState.asteAttive = false; // RIMOSSO
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

async function elaboraRisultatiAste() {
    console.log(`\n📄 === ELABORAZIONE ASTA ${gameState.astaCorrente} ===`);
    console.log(`📊 Offerte temporanee totali: ${gameState.offerteTemporanee.size}`);
    console.log(`👥 Partecipanti in attesa: ${gameState.partecipantiInAttesa.length}`);
    console.log(`🎯 Slots rimasti: ${gameState.slotsRimasti.length}`);

    // Recupera info sessione per condivisione
    let sessioneAttiva = null;
    let condivisioneAttiva = false;

    try {
        const sessione = await db.query(
            'SELECT * FROM sessioni_fantagts WHERE attiva = true LIMIT 1'
        );

        if (sessione.rows.length > 0) {
            sessioneAttiva = sessione.rows[0];
            condivisioneAttiva = sessioneAttiva.condivisione_attiva;
            console.log(`🎮 Sessione attiva: ${sessioneAttiva.nome}`);
            console.log(`🔄 Condivisione: ${condivisioneAttiva ? 'ATTIVA' : 'DISATTIVATA'}`);
        }
    } catch (error) {
        console.error('⚠️ Errore recupero sessione:', error);
    }

    // Raccolta offerte valide
    const tutteLeOfferte = [];
    const partecipantiCheHannoOfferto = new Set();

    console.log('🔍 TUTTE LE OFFERTE TEMPORANEE:');
    gameState.offerteTemporanee.forEach((offerta, socketId) => {
        const connesso = gameState.connessi.get(socketId);
        console.log(`   Socket ${socketId}: ${connesso?.nome || 'Sconosciuto'} → ${offerta.slot} (${offerta.importo})`);
    });

    // Raggruppa offerte valide
    gameState.offerteTemporanee.forEach((offerta, socketId) => {
        const connesso = gameState.connessi.get(socketId);
        if (connesso && offerta.round === gameState.roundAttivo) {
            if (gameState.partecipantiInAttesa.includes(connesso.partecipanteId)) {
                console.log(`✅ Offerta valida: ${connesso.nome} → ${offerta.slot} (${offerta.importo} crediti)`);

                tutteLeOfferte.push({
                    partecipante: connesso.partecipanteId,
                    nome: connesso.nome,
                    offerta: offerta.importo,
                    slot: offerta.slot,
                    giocatore: offerta.slot,
                    socketId: socketId
                });
                partecipantiCheHannoOfferto.add(connesso.partecipanteId);
            } else {
                console.log(`⚠️ Offerta ignorata (già assegnato): ${connesso.nome} → ${offerta.slot}`);
            }
        }
    });

    let risultatiAsta = [];
    let giocatoriReplicati = [];
    let statsCondivisione = null;

    // Elabora con o senza condivisione
    if (condivisioneAttiva && sessioneAttiva) {
        console.log('\n🔄 === MODALITÀ CONDIVISIONE ATTIVA ===');

        const categoria = gameState.roundAttivo;
        const numeroPartecipanti = sessioneAttiva.numero_partecipanti_previsti;
        const numeroSquadre = sessioneAttiva.numero_squadre;

        const risultatoCondivisione = elaboraCondivisioneGiocatori(
            tutteLeOfferte,
            numeroPartecipanti,
            numeroSquadre,
            categoria
        );

        risultatiAsta = risultatoCondivisione.risultatiFinali;
        giocatoriReplicati = risultatoCondivisione.giocatoriReplicati;
        statsCondivisione = risultatoCondivisione.stats;

        console.log(`\n✅ Elaborazione condivisione completata:`);
        console.log(`   - Totale assegnazioni: ${risultatiAsta.length}`);
        console.log(`   - Giocatori condivisi: ${giocatoriReplicati.length}`);

    } else {
        console.log('\n📌 === MODALITÀ NORMALE (senza condivisione) ===');

        const offertePerSlot = {};
        tutteLeOfferte.forEach(offerta => {
            if (!offertePerSlot[offerta.slot]) {
                offertePerSlot[offerta.slot] = [];
            }
            offertePerSlot[offerta.slot].push(offerta);
        });

        console.log('🎯 Offerte valide per slot:', Object.keys(offertePerSlot).map(slot =>
            `${slot}: ${offertePerSlot[slot].length} offerte`
        ));

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
                    const randomIndex = Math.floor(Math.random() * offerteVincenti.length);
                    vincitore = offerteVincenti[randomIndex];
                    console.log(`🎲 PAREGGIO su ${slotId}! Estratto: ${vincitore.nome}`);
                    
                    // 📢 Notifica i perdenti del pareggio
                    const perdenti = offerteVincenti.filter(o => o.partecipante !== vincitore.partecipante);
                    console.log(`⚔️ Notificando ${perdenti.length} perdenti per pareggio su ${slotId}`);
                    
                    perdenti.forEach(perdente => {
                        for (let [socketId, connesso] of gameState.connessi.entries()) {
                            if (connesso.partecipanteId === perdente.partecipante) {
                                io.to(socketId).emit('show_notification', {
                                    title: '⚔️ Pareggio - Non hai vinto',
                                    body: `Pareggio su ${slotId} con ${vincitore.nome}. Entrambi ${offertaMassima} crediti, ma vince ${vincitore.nome} al sorteggio.`,
                                    url: '/'
                                });
                                console.log(`📢 Notifica pareggio inviata a: ${perdente.nome}`);
                                
                                // Invio anche notifica push se disponibile
                                inviaNotifichePush({
                                    title: '⚔️ Pareggio perso',
                                    body: `Non hai vinto ${slotId}. Pareggio con ${vincitore.nome} (${offertaMassima} crediti), sorteggio favorevole a lui.`,
                                    url: '/',
                                    targetUsers: [perdente.partecipante]
                                }).catch(err => console.log('⚠️ Errore notifica push pareggio:', err));
                                
                                break;
                            }
                        }
                    });
                }

                risultatiAsta.push({
                    partecipante: vincitore.partecipante,
                    nome: vincitore.nome,
                    slot: slotId,
                    offerta: vincitore.offerta,
                    costoFinale: vincitore.offerta,
                    premium: 0,
                    condiviso: false,
                    posizione: 1
                });

                console.log(`🏆 VINCITORE: ${vincitore.nome} vince ${slotId} per ${vincitore.offerta} crediti`);
            }
        });
    }

    console.log(`\n🎉 Risultati Asta ${gameState.astaCorrente}:`, risultatiAsta.length, 'assegnazioni');

    if (risultatiAsta.length > 0) {
        await salvaRisultatiAsta(gameState.roundAttivo, risultatiAsta, giocatoriReplicati, statsCondivisione);
    }

    // Aggiorna stato partecipanti SOLO in modalità normale
    if (!condivisioneAttiva) {
        for (const risultato of risultatiAsta) {
            gameState.partecipantiAssegnati.add(risultato.partecipante);
            gameState.partecipantiInAttesa = gameState.partecipantiInAttesa.filter(
                p => p !== risultato.partecipante
            );
            gameState.slotsRimasti = gameState.slotsRimasti.filter(
                s => s.id !== risultato.slot
            );

            for (let [socketId, connesso] of gameState.connessi.entries()) {
                if (connesso.partecipanteId === risultato.partecipante) {
                    // Recupera il nome reale del giocatore e il colore della squadra
                    const slotInfo = await db.query(
                        'SELECT giocatore_attuale, colore FROM slots WHERE id = $1',
                        [risultato.slot]
                    );

                    const nomeGiocatoreReale = slotInfo.rows.length > 0 ? slotInfo.rows[0].giocatore_attuale : risultato.slot;
                    const coloreSquadra = slotInfo.rows.length > 0 ? slotInfo.rows[0].colore : '';

                    io.to(socketId).emit('player_won_exit_auction', {
                        playerName: risultato.nome,
                        realPlayerName: nomeGiocatoreReale,
                        teamColor: coloreSquadra,
                        slotWon: risultato.slot,
                        amount: risultato.costoFinale,
                        shared: risultato.condiviso,
                        premium: risultato.premium,
                        message: risultato.condiviso
                            ? `Hai vinto ${nomeGiocatoreReale} (condiviso) per ${risultato.costoFinale} crediti!`
                            : `Hai vinto ${nomeGiocatoreReale}! La tua asta è terminata.`
                    });
                    break;
                }
            }
        }
    } else {
        // In modalità condivisione: aggiorna solo gli slot rimasti
        const slotsAssegnati = new Set(risultatiAsta.map(r => r.slot));
        gameState.slotsRimasti = gameState.slotsRimasti.filter(
            s => !slotsAssegnati.has(s.id)
        );

        // Notifica tutti i vincitori
        risultatiAsta.forEach(risultato => {
            for (let [socketId, connesso] of gameState.connessi.entries()) {
                if (connesso.partecipanteId === risultato.partecipante) {
                    io.to(socketId).emit('player_won_shared', {
                        playerName: risultato.nome,
                        slotWon: risultato.slot,
                        amount: risultato.costoFinale,
                        originalOffer: risultato.offerta,
                        premium: risultato.premium,
                        position: risultato.posizione,
                        shared: risultato.condiviso,
                        message: risultato.condiviso && risultato.posizione > 1
                            ? `Hai vinto ${risultato.slot} (condiviso - ${risultato.posizione}° posto) per ${risultato.costoFinale} crediti (premium +${Math.round(risultato.premium * 100)}%)`
                            : `Hai vinto ${risultato.slot} per ${risultato.costoFinale} crediti!`
                    });
                }
            }
        });

        console.log(`📊 Modalità condivisione: TUTTI i partecipanti continuano`);
    }

    console.log(`\n📊 STATO AGGIORNATO:`);
    console.log(`   ✅ Assegnati: ${Array.from(gameState.partecipantiAssegnati).length}`);
    console.log(`   ⏳ In attesa: ${gameState.partecipantiInAttesa.length}`);
    console.log(`   🎯 Slots rimasti: ${gameState.slotsRimasti.length}`);

    gameState.offerteTemporanee.clear();

    setTimeout(() => {
        const deveTerminare = condivisioneAttiva
            ? gameState.slotsRimasti.length === 0
            : (gameState.partecipantiInAttesa.length === 0 || gameState.slotsRimasti.length === 0);

        if (!deveTerminare && gameState.slotsRimasti.length > 0) {
            gameState.astaCorrente++;
            console.log(`\n➡️ PASSAGGIO AD ASTA ${gameState.astaCorrente}`);
            avviaAstaSuccessiva();
        } else {
            console.log(`🏁 ROUND COMPLETATO`);
            terminaRoundCompleto();
        }
    }, 3000);
}

// 🔄 Rinomina funzione salvataggio
async function salvaRisultatiAsta(round, risultati, giocatoriReplicati = [], statsCondivisione = null) {
    if (risultati.length === 0) return;

    try {
        console.log(`\n💾 === SALVATAGGIO RISULTATI ASTA ===`);
        console.log(`   Round: ${round}`);
        console.log(`   Risultati: ${risultati.length}`);
        console.log(`   Giocatori replicati: ${giocatoriReplicati.length}`);

        for (const r of risultati) {
            await db.query(`INSERT INTO aste 
                (round, partecipante_id, slot_id, offerta, costo_finale, premium, vincitore, condiviso, sessione_id) 
                VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
                [
                    round,
                    r.partecipante,
                    r.slot,
                    r.offerta || r.offertaOriginale,
                    r.costoFinale,
                    r.premium,
                    r.condiviso,
                    sessioneCorrente
                ]);

            await db.query(`UPDATE partecipanti_fantagts 
                    SET crediti = crediti - $1 
                    WHERE id = $2 AND sessione_id = $3`,
                [r.costoFinale, r.partecipante, sessioneCorrente]);

            const simbolo = r.condiviso ? '🔁' : '✅';
            const dettaglio = r.condiviso
                ? `(pos. ${r.posizione}, premium ${Math.round(r.premium * 100)}%)`
                : '';

            console.log(`${simbolo} ${r.nome} → ${r.slot} per ${r.costoFinale} crediti ${dettaglio}`);
        }

        if (statsCondivisione) {
            try {
                await db.query(`
                    UPDATE sessioni_fantagts 
                    SET ripetizioni_necessarie = GREATEST(ripetizioni_necessarie, $1),
                        last_modified = CURRENT_TIMESTAMP
                    WHERE attiva = true
                `, [statsCondivisione.ripetizioniNecessarie]);

                console.log(`📊 Statistiche condivisione salvate nella sessione`);
            } catch (err) {
                console.error('⚠️ Errore salvataggio stats condivisione:', err);
            }
        }

        io.emit('asta_ended', {
            round: round,
            astaNumero: gameState.astaCorrente,
            risultati: risultati.map(r => ({
                ...r,
                shared: r.condiviso,
                premium: r.premium,
                position: r.posizione || 1
            })),
            giocatoriReplicati: giocatoriReplicati,
            statsCondivisione: statsCondivisione,
            continuaRound: gameState.partecipantiInAttesa.length > 0 && gameState.slotsRimasti.length > 0
        });

        aggiornaCreditiPartecipanti();

        console.log(`✅ Salvataggio completato con successo`);

    } catch (error) {
        console.error('❌ Errore salvataggio asta:', error);
        throw error;
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
                // ❌ ELIMINA tabelle inutili (DROP completo)
                await db.query("DROP TABLE IF EXISTS backup_log CASCADE");
                await db.query("DROP TABLE IF EXISTS risultati_partite CASCADE");

                // ✅ SVUOTA tabelle utili nell'ORDINE CORRETTO (rispetta FOREIGN KEY)
                // Prima elimina i record "figli" (che hanno riferimenti), poi i "genitori"
                await db.query("DELETE FROM risultati_dettaglio");  // Dipende da incontri
                await db.query("DELETE FROM incontri");             // Dipende da coppie_turno e turni_configurazione
                await db.query("DELETE FROM coppie_turno");         // Dipende da turni_configurazione
                await db.query("DELETE FROM scontri_squadre");      // Dipende da turni_configurazione
                await db.query("DELETE FROM accoppiamenti_posizioni"); // Dipende da turni_configurazione
                await db.query("DELETE FROM turni_configurazione"); // Tabella "genitore"

                // Altre tabelle senza vincoli particolari
                await db.query("DELETE FROM aste");
                await db.query("DELETE FROM partecipanti_fantagts");
                await db.query("DELETE FROM squadre_circolo");
                await db.query("DELETE FROM slots");
                await db.query("DELETE FROM push_subscriptions");
                await db.query("DELETE FROM sostituzioni");
                await db.query("DELETE FROM sessioni_fantagts");

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

app.get('/gestione-incontri', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'gestione-incontri.html'));
});

app.get('/incontri', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'incontri.html'));
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
           SELECT id, nome, crediti, sessione_id FROM partecipanti_fantagts 
           WHERE id = $1 AND attivo = true
       `, [data.partecipanteId])
                .then(async result => {  // ← AGGIUNGI "async" QUI
                    if (result.rows.length === 0) {
                        console.log(`❌ ACCESSO NEGATO: ${data.nome} non è registrato nel database`);
                        socket.emit('registered', {
                            success: false,
                            error: 'Non sei registrato nel database. Effettua prima la registrazione.',
                            shouldReload: true
                        });
                        return;
                    }

                    // 🆕 AGGIUNGI QUESTE RIGHE NUOVE QUI
                    const partecipante = result.rows[0];

                    // 🆕 AGGIORNA LA SESSIONE DEL PARTECIPANTE SE DIVERSA
                    if (partecipante.sessione_id !== sessioneCorrente) {
                        console.log(`🔄 Aggiornamento sessione per ${data.nome}: ${partecipante.sessione_id} → ${sessioneCorrente}`);
                        await db.query(`
                            UPDATE partecipanti_fantagts 
                            SET sessione_id = $1 
                            WHERE id = $2
                        `, [sessioneCorrente, data.partecipanteId]);
                    }
                    // 🆕 FINE RIGHE NUOVE

                    // Registrazione WebSocket autorizzata
                    gameState.connessi.set(socket.id, {
                        nome: data.nome,
                        tipo: data.tipo,
                        partecipanteId: data.partecipanteId,
                        stato: 'connesso',
                        verified: true,
                        registeredAt: new Date().toISOString()
                    });

                    // 🆕 RIMUOVI TUTTI I VECCHI LISTENER PRIMA DI INVIARE
                    socket.removeAllListeners('carica_squadra');

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

                    // 🆕 SE C'È UN'ASTA ATTIVA, invia anche asta_started al client appena connesso
                    if (gameState.asteAttive && gameState.roundAttivo && gameState.partecipantiInAttesa.includes(data.partecipanteId)) {
                        console.log(`📤 Invio asta_started al client appena riconnesso: ${data.nome}`);
                        socket.emit('asta_started', {
                            round: gameState.roundAttivo,
                            astaNumero: gameState.astaCorrente,
                            slots: gameState.slotsRimasti,
                            partecipantiInAttesa: gameState.partecipantiInAttesa,
                            sistema: 'multi-asta',
                            slotsDisponibili: gameState.slotsRimasti.map(s => s.id)
                        });
                    }

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
        console.log(`🎯 STATO ASTE AL MOMENTO: asteAttive=${gameState.asteAttive}, roundAttivo=${gameState.roundAttivo}, astaCorrente=${gameState.astaCorrente}`);

        // Verifica che ci sia un round attivo
        if (!gameState.asteAttive) {
            console.log(`❌ Aste non attive: attivo=${gameState.asteAttive}`);
            socket.emit('bid_error', { message: 'Nessuna asta attiva al momento' });
            return;
        }

        // Controllo round - confronta direttamente senza split
        if (gameState.roundAttivo !== data.round) {
            console.log(`❌ Round non corrispondente: attuale=${gameState.roundAttivo}, richiesto=${data.round}`);
            socket.emit('bid_error', { message: `Round non corrispondente. Attuale: ${gameState.roundAttivo}, Richiesto: ${data.round}` });
            return;
        }

        console.log(`✅ Controllo round OK: ${gameState.roundAttivo} === ${data.round}`);

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
        // Confronta usando gameState.roundAttivo invece di data.round
        let hasAlreadyBid = false;
        for (let [existingSocketId, offerta] of gameState.offerteTemporanee.entries()) {
            if (existingSocketId !== socket.id) {
                const offerenteConnesso = gameState.connessi.get(existingSocketId);
                if (offerenteConnesso &&
                    offerenteConnesso.partecipanteId === connesso.partecipanteId &&
                    offerta.round === gameState.roundAttivo) {
                    hasAlreadyBid = true;
                    console.log(`⚠️ ${connesso.nome} aveva già un'offerta su ${offerta.slot}, verrà sovrascritta`);
                    // Rimuovi l'offerta precedente
                    gameState.offerteTemporanee.delete(existingSocketId);
                    break;
                }
            }
        }

        // Nota: Non blocchiamo più se ha già offerto, permettiamo di cambiare offerta
        // if (hasAlreadyBid) {
        //     console.log(`❌ ${connesso.nome} ha già fatto un'offerta in questa asta`);
        //     socket.emit('bid_error', { message: 'Hai già fatto un\'offerta in questa asta' });
        //     return;
        // }

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
            const result = await db.query("SELECT crediti FROM partecipanti_fantagts WHERE id = $1",
                [connesso.partecipanteId]); // ✅ CORRETTO
            if (result.rows.length === 0) {
                console.log(`❌ Partecipante ${connesso.partecipanteId} non trovato nel database`); // ✅ PARENTESI
                socket.emit('bid_error', { message: 'Partecipante non trovato nel database' });
                return;
            }
            const creditiDisponibili = result.rows[0].crediti;
            if (data.importo > creditiDisponibili) {
                console.log(`❌ ${connesso.nome} ha crediti insufficienti: ${data.importo} > ${creditiDisponibili}`); // ✅ PARENTESI
                socket.emit('bid_error', { message: `Crediti insufficienti. Disponibili: ${creditiDisponibili}` });
                return;
            }

            // Salva offerta temporanea usando gameState.roundAttivo invece di data.round
            gameState.offerteTemporanee.set(socket.id, {
                round: gameState.roundAttivo,  // ✅ Usa il round del server
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
// =============================================
// API GESTIONE SESSIONI
// =============================================

// ==================== UTILITY FUNCTIONS ====================

// Genera ID univoco per sessione
function generateSessionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `sess_${timestamp}_${random}`;
}

// Calcola se serve condivisione
function calcolaCondivisione(numPartecipanti, numSquadre) {
    const giocatoriNecessari = numPartecipanti * 10;
    const giocatoriDisponibili = numSquadre * 10;
    const ripetizioniNecessarie = Math.max(0, giocatoriNecessari - giocatoriDisponibili);

    return {
        condivisioneAttiva: ripetizioniNecessarie > 0,
        ripetizioniNecessarie: ripetizioniNecessarie
    };
}

// ==================== CRUD SESSIONI ====================

// GET: Lista tutte le sessioni (con filtri opzionali)
app.get('/api/sessioni', async (req, res) => {
    try {
        const { stato, modalita, anno } = req.query;

        // ðŸ†• Escludi sempre la sessione "default" dalla lista
        let query = "SELECT * FROM v_sessioni_stats WHERE id != 'default'";
        const params = [];

        if (stato) {
            params.push(stato);
            query += ` AND stato = $${params.length}`;
        }

        if (modalita) {
            params.push(modalita);
            query += ` AND modalita = $${params.length}`;
        }

        if (anno) {
            params.push(parseInt(anno));
            query += ` AND anno = $${params.length}`;
        }

        query += ' ORDER BY created_at DESC';

        const result = await db.query(query, params);

        console.log(`âœ… Lista sessioni caricata: ${result.rows.length} risultati (default esclusa)`);
        res.json(result.rows);
    } catch (err) {
        console.error('âŒ Errore caricamento sessioni:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Calcola statistiche condivisione (PRIMA DI /:id)
app.get('/api/sessioni/calcola-condivisione', async (req, res) => {
    try {
        const { partecipanti, squadre } = req.query;

        if (!partecipanti || !squadre) {
            return res.status(400).json({
                error: 'Parametri mancanti: partecipanti e squadre'
            });
        }

        const numPartecipanti = parseInt(partecipanti);
        const numSquadre = parseInt(squadre);

        const risultato = calcolaCondivisione(numPartecipanti, numSquadre);

        res.json({
            numeroPartecipanti: numPartecipanti,
            numeroSquadre: numSquadre,
            giocatoriDisponibili: numSquadre * 10,
            giocatoriNecessari: numPartecipanti * 10,
            ...risultato
        });
    } catch (err) {
        console.error('❌ Errore calcolo condivisione:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Sessione attiva per modalità (PRIMA DI /:id)
app.get('/api/sessioni/attiva/:modalita', async (req, res) => {
    try {
        const modalita = req.params.modalita;
        if (!['asta_competitiva', 'draft_libero'].includes(modalita)) {
            return res.status(400).json({ error: 'Modalità non valida' });
        }
        const result = await db.query(
            'SELECT * FROM v_sessioni_stats WHERE attiva = true AND modalita = $1',
            [modalita]
        );
        if (result.rows.length === 0) {
            return res.json(null);
        }
        console.log(`✅ Sessione attiva ${modalita}:`, result.rows[0].id);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore caricamento sessione attiva:', err);
        res.status(500).json({ error: err.message });
    }
});

// API per ottenere la prima sessione attiva (qualsiasi modalità)
app.get('/api/sessione-attiva', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM v_sessioni_stats WHERE attiva = true ORDER BY created_at DESC LIMIT 1'
        );

        if (result.rows.length === 0) {
            return res.json(null);
        }

        console.log('✅ Sessione attiva:', result.rows[0].id);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore caricamento sessione attiva:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Dettaglio sessione singola (DOPO tutti gli endpoint specifici)
app.get('/api/sessioni/:id', async (req, res) => {
    try {
        const sessioneId = req.params.id;

        const result = await db.query(
            'SELECT * FROM v_sessioni_stats WHERE id = $1',
            [sessioneId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sessione non trovata' });
        }

        console.log(`✅ Sessione caricata: ${sessioneId}`);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore caricamento sessione:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Crea nuova sessione
app.post('/api/sessioni', async (req, res) => {
    try {
        const {
            nome,
            anno,
            descrizione,
            modalita,
            numeroPartecipanti,
            creditiIniziali,
            numeroSquadre
        } = req.body;

        // Validazione
        if (!nome || !modalita || !numeroPartecipanti || !numeroSquadre) {
            return res.status(400).json({
                error: 'Campi obbligatori mancanti: nome, modalita, numeroPartecipanti, numeroSquadre'
            });
        }

        if (!['asta_competitiva', 'draft_libero'].includes(modalita)) {
            return res.status(400).json({ error: 'Modalità non valida' });
        }

        if (numeroPartecipanti < 2 || numeroPartecipanti > 100) {
            return res.status(400).json({ error: 'Numero partecipanti deve essere tra 2 e 100' });
        }

        if (numeroSquadre < 1 || numeroSquadre > 50) {
            return res.status(400).json({ error: 'Numero squadre deve essere tra 1 e 50' });
        }

        // Validazione crediti solo per asta competitiva
        let crediti = 2000;
        if (modalita === 'asta_competitiva') {
            crediti = creditiIniziali || 2000;
            if (crediti < 100 || crediti > 100000) {
                return res.status(400).json({ error: 'Crediti devono essere tra 100 e 100.000' });
            }
            if (crediti % 100 !== 0) {
                return res.status(400).json({ error: 'Crediti devono essere multipli di 100' });
            }
        }

        // Calcola condivisione
        const condivisione = calcolaCondivisione(numeroPartecipanti, numeroSquadre);

        // Genera ID univoco
        const sessioneId = generateSessionId();

        // Genera codice accesso univoco
        const codiceAccesso = await generaCodiceUnico();

        // Disattiva eventuali altre sessioni della stessa modalità
        await db.query(
            'UPDATE sessioni_fantagts SET attiva = false WHERE modalita = $1 AND attiva = true',
            [modalita]
        );

        // Inserisci nuova sessione
        const result = await db.query(`
    INSERT INTO sessioni_fantagts (
        id, nome, anno, descrizione, modalita,
        numero_partecipanti_previsti, crediti_iniziali, numero_squadre,
        condivisione_attiva, ripetizioni_necessarie, 
        stato, attiva, codice_accesso
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
        `, [
            sessioneId,
            nome,
            anno || new Date().getFullYear(),
            descrizione || '',
            modalita,
            numeroPartecipanti,
            crediti,
            numeroSquadre,
            condivisione.condivisioneAttiva,
            condivisione.ripetizioniNecessarie,
            'setup',
            true,
            codiceAccesso
        ]);
        console.log(`✅ Sessione creata: ${sessioneId} - ${nome} (${modalita}) - Codice: ${codiceAccesso}`);
        console.log(`   📊 Partecipanti: ${numeroPartecipanti}, Squadre: ${numeroSquadre}`);
        console.log(`   🔄 Condivisione: ${condivisione.condivisioneAttiva ? 'ATTIVA' : 'NON NECESSARIA'}`);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore creazione sessione:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT: Aggiorna sessione
app.put('/api/sessioni/:id', async (req, res) => {
    try {
        const sessioneId = req.params.id;
        const { nome, anno, descrizione, stato } = req.body;

        // Controlla che la sessione esista
        const check = await db.query('SELECT * FROM sessioni_fantagts WHERE id = $1', [sessioneId]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Sessione non trovata' });
        }

        const updates = [];
        const params = [];
        let paramIndex = 1;

        if (nome !== undefined) {
            params.push(nome);
            updates.push(`nome = $${paramIndex++}`);
        }

        if (anno !== undefined) {
            params.push(anno);
            updates.push(`anno = $${paramIndex++}`);
        }

        if (descrizione !== undefined) {
            params.push(descrizione);
            updates.push(`descrizione = $${paramIndex++}`);
        }

        if (stato !== undefined) {
            const statiValidi = ['setup', 'formazione_squadre', 'aste_in_corso', 'aste_completate', 'in_corso', 'completata', 'archiviata'];
            if (!statiValidi.includes(stato)) {
                return res.status(400).json({ error: 'Stato non valido' });
            }
            params.push(stato);
            updates.push(`stato = $${paramIndex++}`);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nessun campo da aggiornare' });
        }

        params.push(sessioneId);
        const query = `UPDATE sessioni_fantagts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

        const result = await db.query(query, params);

        console.log(`✅ Sessione aggiornata: ${sessioneId}`);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore aggiornamento sessione:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Toggle attiva/disattiva sessione
app.post('/api/sessioni/:id/toggle-attiva', async (req, res) => {
    try {
        const sessioneId = req.params.id;

        // Prima leggi lo stato attuale
        const current = await db.query('SELECT attiva, modalita FROM sessioni_fantagts WHERE id = $1', [sessioneId]);

        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'Sessione non trovata' });
        }

        const nuovoStato = !current.rows[0].attiva;
        const modalita = current.rows[0].modalita;

        // Se la stiamo attivando, disattiva le altre della stessa modalità
        if (nuovoStato) {
            await db.query(
                'UPDATE sessioni_fantagts SET attiva = false WHERE modalita = $1 AND id != $2',
                [modalita, sessioneId]
            );
        }

        // Aggiorna lo stato
        const result = await db.query(
            'UPDATE sessioni_fantagts SET attiva = $1 WHERE id = $2 RETURNING *',
            [nuovoStato, sessioneId]
        );

        // 🆕 AGGIORNA sessioneCorrente quando si attiva una sessione
        if (nuovoStato) {
            sessioneCorrente = sessioneId;
            console.log(`✅ Sessione attivata e impostata come corrente: ${sessioneId}`);
        }

        console.log(`✅ Sessione ${nuovoStato ? 'attivata' : 'disattivata'}: ${sessioneId}`);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore toggle attiva sessione:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Archivia sessione
app.post('/api/sessioni/:id/archivia', async (req, res) => {
    try {
        const sessioneId = req.params.id;

        const result = await db.query(
            `UPDATE sessioni_fantagts 
             SET stato = 'archiviata', attiva = false 
             WHERE id = $1 
             RETURNING *`,
            [sessioneId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sessione non trovata' });
        }

        console.log(`📦 Sessione archiviata: ${sessioneId}`);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Errore archiviazione sessione:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Reset sessione (mantiene config, cancella dati)
app.post('/api/sessioni/:id/reset', async (req, res) => {
    try {
        const sessioneId = req.params.id;

        await db.query('BEGIN');

        // Verifica che la sessione esista
        const check = await db.query('SELECT * FROM sessioni_fantagts WHERE id = $1', [sessioneId]);
        if (check.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Sessione non trovata' });
        }

        // Cancella dati ma mantiene configurazione
        await db.query('DELETE FROM aste WHERE sessione_id = $1', [sessioneId]);
        await db.query('DELETE FROM squadre_draft WHERE sessione_id = $1', [sessioneId]);
        // Elimina prima i record dalla tabella di accesso
        await db.query('DELETE FROM partecipanti_sessioni_accesso WHERE sessione_id = $1', [sessioneId]);
        // Non eliminare i partecipanti dalla tabella principale, sono condivisi tra sessioni

        // Reset stato sessione
        await db.query(
            `UPDATE sessioni_fantagts 
             SET stato = 'setup' 
             WHERE id = $1`,
            [sessioneId]
        );

        await db.query('COMMIT');

        console.log(`🔄 Sessione resettata: ${sessioneId}`);
        res.json({ success: true, message: 'Sessione resettata con successo' });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('❌ Errore reset sessione:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Elimina sessione completamente
app.delete('/api/sessioni/:id', async (req, res) => {
    try {
        const sessioneId = req.params.id;

        await db.query('BEGIN');

        // Verifica che la sessione esista
        const check = await db.query('SELECT * FROM sessioni_fantagts WHERE id = $1', [sessioneId]);
        if (check.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Sessione non trovata' });
        }

        // 🆕 ELIMINAZIONE CASCADE MANUALE - Elimina tutti i dati correlati nell'ordine corretto
        console.log(`🗑️ Eliminazione sessione: ${sessioneId}`);

        // 1. Elimina push subscriptions
        await db.query('DELETE FROM push_subscriptions WHERE sessione_id = $1', [sessioneId]);
        console.log('  ✓ Push subscriptions eliminate');

        // 2. Elimina aste (dipende da partecipanti e slots)
        await db.query('DELETE FROM aste WHERE sessione_id = $1', [sessioneId]);
        console.log('  ✓ Aste eliminate');

        // 3. Elimina squadre draft
        await db.query('DELETE FROM squadre_draft WHERE sessione_id = $1', [sessioneId]);
        console.log('  ✓ Squadre draft eliminate');

        // 4. NON eliminare slots e squadre_circolo (appartengono alla configurazione, non alla sessione!)
        console.log('  ℹ️ Slots e squadre circolo NON eliminati (appartengono alla configurazione)');

        // 6. Elimina risultati dettaglio, incontri, coppie turno, turni configurazione
        await db.query(`
            DELETE FROM risultati_dettaglio 
            WHERE incontro_id IN (
                SELECT id FROM incontri WHERE sessione_id = $1
            )
        `, [sessioneId]);
        console.log('  ✓ Risultati dettaglio eliminati');

        await db.query('DELETE FROM incontri WHERE sessione_id = $1', [sessioneId]);
        console.log('  ✓ Incontri eliminati');

        await db.query('DELETE FROM coppie_turno WHERE sessione_id = $1', [sessioneId]);
        console.log('  ✓ Coppie turno eliminate');

        await db.query('DELETE FROM turni_configurazione WHERE sessione_id = $1', [sessioneId]);
        console.log('  ✓ Turni configurazione eliminati');

        await db.query('DELETE FROM sostituzioni WHERE sessione_id = $1', [sessioneId]);
        console.log('  ✓ Sostituzioni eliminate');

        // 7. Elimina partecipanti (CASCADE dovrebbe già averli eliminati, ma per sicurezza)
        const partecipantiEliminati = await db.query(
            'DELETE FROM partecipanti_sessioni_accesso WHERE sessione_id = $1 RETURNING partecipante_id',
            [sessioneId]
        );
        console.log(`  ✓ ${partecipantiEliminati.rows.length} Partecipanti eliminati`);

        // 8. Finalmente elimina la sessione
        const result = await db.query(
            'DELETE FROM sessioni_fantagts WHERE id = $1 RETURNING *',
            [sessioneId]
        );

        await db.query('COMMIT');

        console.log(`✅ Sessione "${result.rows[0].nome}" eliminata completamente`);
        res.json({
            success: true,
            message: 'Sessione eliminata con successo',
            partecipantiEliminati: partecipantiEliminati.rows.length
        });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('❌ Errore eliminazione sessione:', err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint per aggiornare i crediti iniziali di una sessione
app.put('/api/sessioni/:sessioneId/crediti', async (req, res) => {
    try {
        const { sessioneId } = req.params;
        const { creditiIniziali } = req.body;

        if (!creditiIniziali || creditiIniziali < 100 || creditiIniziali > 100000) {
            return res.status(400).json({ error: 'Crediti devono essere tra 100 e 100.000' });
        }

        if (creditiIniziali % 100 !== 0) {
            return res.status(400).json({ error: 'Crediti devono essere multipli di 100' });
        }

        // Aggiorna i crediti della sessione
        await db.query(
            'UPDATE sessioni_fantagts SET crediti_iniziali = $1, last_modified = CURRENT_TIMESTAMP WHERE id = $2',
            [creditiIniziali, sessioneId]
        );

        // 🆕 AGGIORNA I CREDITI DI TUTTI I PARTECIPANTI DELLA SESSIONE
        const updateResult = await db.query(
            'UPDATE partecipanti_fantagts SET crediti = $1 WHERE sessione_id = $2 RETURNING id, nome',
            [creditiIniziali, sessioneId]
        );

        console.log(`✅ Crediti sessione ${sessioneId} aggiornati a ${creditiIniziali}`);
        console.log(`✅ Aggiornati ${updateResult.rows.length} partecipanti`);

        // 🆕 NOTIFICA TUTTI I CLIENT CONNESSI VIA WEBSOCKET
        updateResult.rows.forEach(part => {
            for (let [socketId, connesso] of gameState.connessi.entries()) {
                if (connesso.partecipanteId === part.id) {
                    io.to(socketId).emit('crediti_aggiornati', {
                        crediti: creditiIniziali
                    });
                    console.log(`📤 Crediti aggiornati inviati a ${part.nome}`);
                    break;
                }
            }
        });

        res.json({
            success: true,
            message: 'Crediti aggiornati con successo',
            creditiIniziali: creditiIniziali,
            partecipantiAggiornati: updateResult.rows.length
        });

    } catch (err) {
        console.error('❌ Errore aggiornamento crediti sessione:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== API MODALITA DRAFT LIBERO ====================

// GET: Lista completa giocatori disponibili per Draft
app.get('/api/draft/giocatori-disponibili', async (req, res) => {
    try {
        const { sessione_id } = req.query;

        if (!sessione_id) {
            return res.status(400).json({ error: 'sessione_id richiesto' });
        }

        // Verifica che la sessione sia Draft
        const sessioneResult = await db.query(
            'SELECT * FROM sessioni_fantagts WHERE id = $1',
            [sessione_id]
        );

        if (sessioneResult.rows.length === 0) {
            return res.status(404).json({ error: 'Sessione non trovata' });
        }

        const sessione = sessioneResult.rows[0];
        if (sessione.modalita !== 'draft_libero') {
            return res.status(400).json({ error: 'Questa sessione non Ã¨ in modalitÃ  Draft Libero' });
        }

        // Ottieni configurazione dalla sessione
        const configQuery = await db.query('SELECT configurazione_id FROM sessioni_fantagts WHERE id = $1', [sessione_id]);
        const configurazioneId = configQuery.rows[0]?.configurazione_id || 'default';

        // Recupera tutti gli slot delle squadre del circolo per questa configurazione
        const result = await db.query(`
            SELECT 
            s.id,
            s.posizione,
            s.giocatore_attuale,
            sc.colore as colore_squadra,
            s.squadra_numero as numero_squadra
        FROM slots s
        JOIN squadre_circolo sc ON s.squadra_numero = sc.numero AND s.configurazione_id = sc.configurazione_id
        WHERE s.configurazione_id = $1 AND s.attivo = true
            ORDER BY 
                CASE s.posizione
                    WHEN 'M1' THEN 1
                    WHEN 'M2' THEN 2
                    WHEN 'M3' THEN 3
                    WHEN 'M4' THEN 4
                    WHEN 'M5' THEN 5
                    WHEN 'M6' THEN 6
                    WHEN 'M7' THEN 7
                    WHEN 'F1' THEN 8
                    WHEN 'F2' THEN 9
                    WHEN 'F3' THEN 10
                END,
                sc.numero
        `, [configurazioneId]);

        // Raggruppa giocatori per posizione
        const giocatoriPerPosizione = {
            M1: [], M2: [], M3: [], M4: [], M5: [], M6: [], M7: [],
            F1: [], F2: [], F3: []
        };

        result.rows.forEach(slot => {
            giocatoriPerPosizione[slot.posizione].push({
                id: slot.id,
                nome: slot.giocatore_attuale,
                posizione: slot.posizione,
                coloreSquadra: slot.colore_squadra,
                numeroSquadra: slot.numero_squadra
            });
        });

        console.log(`âœ… Giocatori disponibili per Draft - Sessione ${sessione_id}: ${result.rows.length} totali`);

        res.json({
            sessione_id: sessione_id,
            sessione_nome: sessione.nome,
            giocatoriPerPosizione: giocatoriPerPosizione,
            totale: result.rows.length
        });

    } catch (err) {
        console.error('âŒ Errore caricamento giocatori Draft:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Recupera squadra salvata di un partecipante (Draft)

app.get('/api/draft/squadra/:partecipanteId', async (req, res) => {
    try {
        const partecipanteId = req.params.partecipanteId;
        const { sessione_id } = req.query;

        console.log(`🔍 Richiesta squadra draft - Partecipante: ${partecipanteId}, Sessione: ${sessione_id}`);

        if (!sessione_id) {
            return res.status(400).json({ error: 'sessione_id richiesto' });
        }

        const result = await db.query(`
            SELECT 
                sd.posizione, 
                sd.giocatore, 
                sd.slot_id, 
                sd.numero_squadra_circolo, 
                sd.colore_squadra,
                COALESCE(s.punti_totali, 0) as punti_totali
            FROM squadre_draft sd
            LEFT JOIN slots s ON sd.slot_id = s.id
            WHERE sd.partecipante_id = $1 AND sd.sessione_id = $2
            ORDER BY CASE
                WHEN sd.posizione = 'M1' THEN 1
                WHEN sd.posizione = 'M2' THEN 2
                WHEN sd.posizione = 'M3' THEN 3
                WHEN sd.posizione = 'M4' THEN 4
                WHEN sd.posizione = 'M5' THEN 5
                WHEN sd.posizione = 'M6' THEN 6
                WHEN sd.posizione = 'M7' THEN 7
                WHEN sd.posizione = 'F1' THEN 8
                WHEN sd.posizione = 'F2' THEN 9
                WHEN sd.posizione = 'F3' THEN 10
                ELSE 11
            END
        `, [partecipanteId, sessione_id]);

        console.log(`📊 Trovati ${result.rows.length} giocatori per ${partecipanteId} in sessione ${sessione_id}`);

        if (result.rows.length > 0) {
            console.log('🎨 Colori trovati:', result.rows.map(r => `${r.posizione}: ${r.colore_squadra}`).join(', '));
        }

        const squadra = {};
        result.rows.forEach(riga => {
            squadra[riga.posizione] = {
                giocatore: riga.giocatore,
                slotId: riga.slot_id,
                coloreSquadra: riga.colore_squadra,
                numeroSquadra: riga.numero_squadra_circolo,
                puntiTotali: riga.punti_totali
            };
        });

        const posizioniRichieste = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'F1', 'F2', 'F3'];
        const completata = posizioniRichieste.every(pos => squadra[pos]);

        res.json({
            partecipante_id: partecipanteId,
            sessione_id,
            squadra,
            completata,
            posizioniCompilate: result.rows.length
        });
    } catch (err) {
        console.error('❌ Errore recupero squadra Draft:', err);
        res.status(500).json({ error: err.message });
    }
});


// POST: Salva squadra completa Draft (finale e bloccata)

app.post('/api/draft/squadra', async (req, res) => {
    try {
        const { partecipante_id, sessione_id, squadra } = req.body;

        if (!partecipante_id || !sessione_id || !squadra) {
            return res.status(400).json({ error: 'Campi obbligatori: partecipante_id, sessione_id, squadra' });
        }

        // Cancella eventuali scelte precedenti
        await db.query('DELETE FROM squadre_draft WHERE partecipante_id = $1 AND sessione_id = $2', [partecipante_id, sessione_id]);

        // Inserisci le nuove scelte
        for (const [posizione, dati] of Object.entries(squadra)) {
            await db.query(`
                INSERT INTO squadre_draft (
                    partecipante_id, sessione_id, posizione, slot_id, giocatore, numero_squadra_circolo, colore_squadra
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                partecipante_id,
                sessione_id,
                posizione,
                dati.slotId,
                dati.giocatore,
                dati.numeroSquadra,
                dati.coloreSquadra
            ]);
        }

        console.log(`✅ Squadra Draft salvata per ${partecipante_id}`);
        res.json({ success: true, message: 'Squadra salvata con successo', giocatori_salvati: Object.keys(squadra).length });
    } catch (err) {
        console.error('❌ Errore salvataggio squadra Draft:', err);
        res.status(500).json({ error: err.message });
    }
});


// Avvio server
const PORT = process.env.PORT || 3000;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '0.0.0.0';

// Inizializza database prima di avviare il server
initializeDatabase().then(async () => {
    await updateDatabaseSchema();

    // 🆕 CARICA SESSIONE ATTIVA ALL'AVVIO
    try {
        const result = await db.query(`
            SELECT id, nome FROM sessioni_fantagts 
            WHERE attiva = true AND modalita = 'asta_competitiva'
            LIMIT 1
        `);

        if (result.rows.length > 0) {
            sessioneCorrente = result.rows[0].id;
            console.log(`✅ Sessione corrente caricata: ${result.rows[0].nome} (${sessioneCorrente})`);
        } else {
            console.log(`⚠️ Nessuna sessione attiva trovata, uso default: ${sessioneCorrente}`);
        }
    } catch (err) {
        console.error('❌ Errore caricamento sessione attiva:', err);
    }

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

// ==================== ESPORTA FUNZIONI UTILI ====================
// Queste possono essere usate in altri file se necessario
module.exports = {
    generateSessionId,
    calcolaCondivisione
};