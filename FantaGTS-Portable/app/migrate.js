require('dotenv').config();
const { Pool } = require('pg');

// Configurazione database (usa le tue credenziali)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 Inizio migrazione database...\n');
        
        // Array di tutte le query da eseguire
        const queries = [
            // 1. Aggiungi colonne a sessioni_fantagts
            {
                name: 'Aggiungi colonna modalita',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS modalita TEXT`
            },
            {
                name: 'Aggiungi colonna numero_partecipanti_previsti',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS numero_partecipanti_previsti INTEGER`
            },
            {
                name: 'Aggiungi colonna crediti_iniziali',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS crediti_iniziali INTEGER DEFAULT 2000`
            },
            {
                name: 'Aggiungi colonna numero_squadre',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS numero_squadre INTEGER`
            },
            {
                name: 'Aggiungi colonna condivisione_attiva',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS condivisione_attiva BOOLEAN DEFAULT false`
            },
            {
                name: 'Aggiungi colonna ripetizioni_necessarie',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS ripetizioni_necessarie INTEGER DEFAULT 0`
            },
            {
                name: 'Aggiungi colonna premium_condivisione',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS premium_condivisione REAL DEFAULT 0.10`
            },
            {
                name: 'Aggiungi colonna stato',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS stato TEXT DEFAULT 'setup'`
            },
            {
                name: 'Aggiungi colonna last_modified',
                sql: `ALTER TABLE sessioni_fantagts ADD COLUMN IF NOT EXISTS last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
            },
            
            // 2. Aggiungi sessione_id alle altre tabelle
            {
                name: 'Aggiungi sessione_id a partecipanti_fantagts',
                sql: `ALTER TABLE partecipanti_fantagts ADD COLUMN IF NOT EXISTS sessione_id TEXT`
            },
            {
                name: 'Aggiungi sessione_id a aste',
                sql: `ALTER TABLE aste ADD COLUMN IF NOT EXISTS sessione_id TEXT`
            },
            {
                name: 'Aggiungi sessione_id a squadre_circolo',
                sql: `ALTER TABLE squadre_circolo ADD COLUMN IF NOT EXISTS sessione_id TEXT`
            },
            {
                name: 'Aggiungi sessione_id a slots',
                sql: `ALTER TABLE slots ADD COLUMN IF NOT EXISTS sessione_id TEXT`
            },
            
            // 3. Crea tabella squadre_draft
            {
                name: 'Crea tabella squadre_draft',
                sql: `CREATE TABLE IF NOT EXISTS squadre_draft (
                    id SERIAL PRIMARY KEY,
                    partecipante_id TEXT NOT NULL,
                    sessione_id TEXT NOT NULL,
                    m1_slot_id TEXT,
                    m2_slot_id TEXT,
                    m3_slot_id TEXT,
                    m4_slot_id TEXT,
                    m5_slot_id TEXT,
                    m6_slot_id TEXT,
                    m7_slot_id TEXT,
                    f1_slot_id TEXT,
                    f2_slot_id TEXT,
                    f3_slot_id TEXT,
                    completata BOOLEAN DEFAULT false,
                    locked BOOLEAN DEFAULT false,
                    locked_by TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    UNIQUE(partecipante_id, sessione_id)
                )`
            },
            
            // 4. Crea indici
            {
                name: 'Crea indice idx_sessioni_attiva',
                sql: `CREATE INDEX IF NOT EXISTS idx_sessioni_attiva ON sessioni_fantagts(attiva) WHERE attiva = true`
            },
            {
                name: 'Crea indice idx_sessioni_modalita',
                sql: `CREATE INDEX IF NOT EXISTS idx_sessioni_modalita ON sessioni_fantagts(modalita)`
            },
            {
                name: 'Crea indice idx_partecipanti_sessione',
                sql: `CREATE INDEX IF NOT EXISTS idx_partecipanti_sessione ON partecipanti_fantagts(sessione_id)`
            },
            {
                name: 'Crea indice idx_aste_sessione',
                sql: `CREATE INDEX IF NOT EXISTS idx_aste_sessione ON aste(sessione_id)`
            },
            {
                name: 'Crea indice idx_squadre_sessione',
                sql: `CREATE INDEX IF NOT EXISTS idx_squadre_sessione ON squadre_circolo(sessione_id)`
            },
            {
                name: 'Crea indice idx_slots_sessione',
                sql: `CREATE INDEX IF NOT EXISTS idx_slots_sessione ON slots(sessione_id)`
            },
            {
                name: 'Crea indice idx_squadre_draft_sessione',
                sql: `CREATE INDEX IF NOT EXISTS idx_squadre_draft_sessione ON squadre_draft(sessione_id)`
            },
            {
                name: 'Crea indice idx_squadre_draft_partecipante',
                sql: `CREATE INDEX IF NOT EXISTS idx_squadre_draft_partecipante ON squadre_draft(partecipante_id)`
            },
            
            // 5. Crea vista statistiche
            {
                name: 'Crea vista v_sessioni_stats',
                sql: `CREATE OR REPLACE VIEW v_sessioni_stats AS
                SELECT 
                    s.id,
                    s.nome,
                    s.anno,
                    s.modalita,
                    s.stato,
                    s.attiva,
                    s.numero_partecipanti_previsti,
                    s.numero_squadre,
                    s.condivisione_attiva,
                    s.crediti_iniziali,
                    COUNT(DISTINCT p.id) as partecipanti_registrati,
                    COUNT(DISTINCT sc.numero) as squadre_configurate,
                    COUNT(DISTINCT a.id) as aste_completate,
                    s.created_at,
                    s.last_modified
                FROM sessioni_fantagts s
                LEFT JOIN partecipanti_fantagts p ON s.id = p.sessione_id AND p.attivo = true
                LEFT JOIN squadre_circolo sc ON s.id = sc.sessione_id AND sc.attiva = true
                LEFT JOIN aste a ON s.id = a.sessione_id AND a.vincitore = true
                GROUP BY s.id`
            }
        ];
        
        // Esegui tutte le query
        for (const query of queries) {
            try {
                await client.query(query.sql);
                console.log(`✅ ${query.name}`);
            } catch (err) {
                // Se l'errore è "già esiste", va bene, continua
                if (err.message.includes('already exists') || err.message.includes('duplicate')) {
                    console.log(`⚠️  ${query.name} (già esistente, saltato)`);
                } else {
                    throw err;
                }
            }
        }
        
        console.log('\n🎉 MIGRAZIONE COMPLETATA CON SUCCESSO!');
        console.log('\n📊 Verifica risultati:');
        
        // Verifica colonne aggiunte
        const result = await client.query(`
            SELECT column_name 
            FROM information_schema.columns
            WHERE table_name = 'sessioni_fantagts'
            ORDER BY ordinal_position
        `);
        
        console.log('\nColonne in sessioni_fantagts:');
        result.rows.forEach(row => console.log(`  - ${row.column_name}`));
        
        // Verifica tabella squadre_draft
        const draftCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'squadre_draft'
            )
        `);
        
        if (draftCheck.rows[0].exists) {
            console.log('\n✅ Tabella squadre_draft creata');
        }
        
        // Verifica vista
        const viewCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.views 
                WHERE table_name = 'v_sessioni_stats'
            )
        `);
        
        if (viewCheck.rows[0].exists) {
            console.log('✅ Vista v_sessioni_stats creata');
        }
        
    } catch (err) {
        console.error('\n❌ ERRORE DURANTE LA MIGRAZIONE:');
        console.error(err.message);
        console.error('\nDettagli completi:');
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

// Esegui la migrazione
migrate();