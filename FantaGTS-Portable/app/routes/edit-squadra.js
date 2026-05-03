// routes/edit-squadra.js - API per editing manuale squadre partecipanti
const express = require('express');
const router = express.Router();

module.exports = function(db) {

    // =====================================================
    // GET: Tutti i giocatori disponibili per una posizione
    // =====================================================
    router.get('/api/edit-squadra/giocatori-disponibili', async (req, res) => {
        try {
            const { sessione_id, posizione } = req.query;

            if (!sessione_id || !posizione) {
                return res.status(400).json({ error: 'sessione_id e posizione sono obbligatori' });
            }

            // Ricava la configurazione dalla sessione
            const sessResult = await db.query(
                'SELECT configurazione_id, modalita FROM sessioni_fantagts WHERE id = $1',
                [sessione_id]
            );

            if (sessResult.rows.length === 0) {
                return res.status(404).json({ error: 'Sessione non trovata' });
            }

            const configurazioneId = sessResult.rows[0].configurazione_id;
            const modalita = sessResult.rows[0].modalita;

            // Prendi TUTTI gli slot di quella posizione nella configurazione
            const slotsResult = await db.query(`
                SELECT 
                    s.id as slot_id,
                    s.giocatore_attuale,
                    s.colore,
                    s.squadra_numero,
                    s.punti_totali
                FROM slots s
                WHERE s.configurazione_id = $1 
                AND s.posizione = $2
                AND s.attivo = true
                AND s.giocatore_attuale IS NOT NULL 
                AND TRIM(s.giocatore_attuale) != ''
                ORDER BY s.squadra_numero
            `, [configurazioneId, posizione]);

            // Per ogni giocatore, verifica se e' gia' assegnato a qualcuno in questa sessione
            const giocatori = [];

            for (const slot of slotsResult.rows) {
                let assegnatoA = null;

                if (modalita === 'draft_libero') {
                    // Cerca nelle squadre_draft
                    const draftCheck = await db.query(`
                        SELECT sd.partecipante_id, p.nome as nome_partecipante
                        FROM squadre_draft sd
                        JOIN partecipanti_fantagts p ON p.id = sd.partecipante_id
                        WHERE sd.slot_id = $1 AND sd.sessione_id = $2
                    `, [slot.slot_id, sessione_id]);

                    if (draftCheck.rows.length > 0) {
                        assegnatoA = {
                            partecipante_id: draftCheck.rows[0].partecipante_id,
                            nome: draftCheck.rows[0].nome_partecipante
                        };
                    }
                } else {
                    // Cerca nelle aste (vincitore = true)
                    const astaCheck = await db.query(`
                        SELECT a.partecipante_id, p.nome as nome_partecipante, a.costo_finale
                        FROM aste a
                        JOIN partecipanti_fantagts p ON p.id = a.partecipante_id
                        WHERE a.slot_id = $1 AND a.sessione_id = $2 AND a.vincitore = true
                    `, [slot.slot_id, sessione_id]);

                    if (astaCheck.rows.length > 0) {
                        assegnatoA = {
                            partecipante_id: astaCheck.rows[0].partecipante_id,
                            nome: astaCheck.rows[0].nome_partecipante,
                            costo: astaCheck.rows[0].costo_finale
                        };
                    }
                }

                giocatori.push({
                    slot_id: slot.slot_id,
                    nome: slot.giocatore_attuale,
                    colore: slot.colore,
                    squadra_numero: slot.squadra_numero,
                    punti_totali: slot.punti_totali || 0,
                    assegnato_a: assegnatoA
                });
            }

            res.json({
                posizione,
                sessione_id,
                modalita,
                giocatori
            });

        } catch (err) {
            console.error('Errore giocatori-disponibili-edit:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // =====================================================
    // POST: Assegna un giocatore a un partecipante
    // =====================================================
    router.post('/api/edit-squadra/assegna', async (req, res) => {
        try {
            const { sessione_id, partecipante_id, slot_id, posizione, costo } = req.body;

            if (!sessione_id || !partecipante_id || !slot_id || !posizione) {
                return res.status(400).json({ error: 'Campi obbligatori: sessione_id, partecipante_id, slot_id, posizione' });
            }

            // Ricava info sessione
            const sessResult = await db.query(
                'SELECT configurazione_id, modalita FROM sessioni_fantagts WHERE id = $1',
                [sessione_id]
            );

            if (sessResult.rows.length === 0) {
                return res.status(404).json({ error: 'Sessione non trovata' });
            }

            const configurazioneId = sessResult.rows[0].configurazione_id;
            const modalita = sessResult.rows[0].modalita;

            // Recupera info dello slot
            const slotResult = await db.query(
                'SELECT * FROM slots WHERE id = $1 AND configurazione_id = $2',
                [slot_id, configurazioneId]
            );

            if (slotResult.rows.length === 0) {
                return res.status(404).json({ error: 'Slot non trovato' });
            }

            const slot = slotResult.rows[0];
            const costoFinale = parseInt(costo) || 0;

            if (modalita === 'draft_libero') {
                // --- MODALITA' DRAFT ---

                // Rimuovi eventuale giocatore precedente in quella posizione
                await db.query(
                    'DELETE FROM squadre_draft WHERE partecipante_id = $1 AND sessione_id = $2 AND posizione = $3',
                    [partecipante_id, sessione_id, posizione]
                );

                // Inserisci il nuovo giocatore
                await db.query(`
                    INSERT INTO squadre_draft (partecipante_id, sessione_id, posizione, slot_id, giocatore, numero_squadra_circolo, colore_squadra)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    partecipante_id,
                    sessione_id,
                    posizione,
                    slot_id,
                    slot.giocatore_attuale,
                    slot.squadra_numero,
                    slot.colore
                ]);

                console.log(`[EDIT] Draft: assegnato ${slot.giocatore_attuale} (${posizione}) a partecipante ${partecipante_id}`);

            } else {
                // --- MODALITA' ASTA ---

                // Rimuovi eventuale asta vincente precedente per questa posizione/partecipante
                // (cerca se il partecipante ha gia' un vincitore per uno slot della stessa posizione)
                const asteEsistenti = await db.query(`
                    SELECT a.id, a.slot_id, a.costo_finale
                    FROM aste a
                    JOIN slots s ON a.slot_id = s.id AND s.configurazione_id = $3
                    WHERE a.partecipante_id = $1 
                    AND a.sessione_id = $2 
                    AND a.vincitore = true
                    AND s.posizione = $4
                `, [partecipante_id, sessione_id, configurazioneId, posizione]);

                // Se aveva un giocatore in questa posizione, restituisci i crediti
                if (asteEsistenti.rows.length > 0) {
                    const vecchioCosto = asteEsistenti.rows[0].costo_finale || 0;

                    // Elimina la vecchia asta
                    await db.query('DELETE FROM aste WHERE id = $1', [asteEsistenti.rows[0].id]);

                    // Restituisci i crediti
                    if (vecchioCosto > 0) {
                        await db.query(`
                            UPDATE partecipanti_sessioni_accesso 
                            SET crediti = crediti + $1 
                            WHERE partecipante_id = $2 AND sessione_id = $3
                        `, [vecchioCosto, partecipante_id, sessione_id]);
                    }

                    console.log(`[EDIT] Asta: rimosso vecchio giocatore, restituiti ${vecchioCosto} crediti`);
                }

                // Inserisci la nuova asta come vincente
                await db.query(`
                    INSERT INTO aste (round, partecipante_id, slot_id, offerta, costo_finale, vincitore, sessione_id, timestamp)
                    VALUES ($1, $2, $3, $4, $5, true, $6, NOW())
                `, [
                    'EDIT_MANUALE',
                    partecipante_id,
                    slot_id,
                    costoFinale,
                    costoFinale,
                    sessione_id
                ]);

                // Scala i crediti
                if (costoFinale > 0) {
                    await db.query(`
                        UPDATE partecipanti_sessioni_accesso 
                        SET crediti = crediti - $1 
                        WHERE partecipante_id = $2 AND sessione_id = $3
                    `, [costoFinale, partecipante_id, sessione_id]);
                }

                console.log(`[EDIT] Asta: assegnato ${slot.giocatore_attuale} (${posizione}) a partecipante ${partecipante_id} per ${costoFinale} crediti`);
            }

            res.json({
                success: true,
                message: `Giocatore ${slot.giocatore_attuale} assegnato con successo`,
                giocatore: slot.giocatore_attuale,
                posizione,
                costo: costoFinale
            });

        } catch (err) {
            console.error('Errore assegna giocatore edit:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // =====================================================
    // POST: Rimuovi un giocatore dalla squadra
    // =====================================================
    router.post('/api/edit-squadra/rimuovi', async (req, res) => {
        try {
            const { sessione_id, partecipante_id, posizione, restituisci_crediti } = req.body;

            if (!sessione_id || !partecipante_id || !posizione) {
                return res.status(400).json({ error: 'Campi obbligatori: sessione_id, partecipante_id, posizione' });
            }

            // Ricava info sessione
            const sessResult = await db.query(
                'SELECT configurazione_id, modalita FROM sessioni_fantagts WHERE id = $1',
                [sessione_id]
            );

            if (sessResult.rows.length === 0) {
                return res.status(404).json({ error: 'Sessione non trovata' });
            }

            const configurazioneId = sessResult.rows[0].configurazione_id;
            const modalita = sessResult.rows[0].modalita;
            let giocatoreRimosso = null;
            let creditiRestituiti = 0;

            if (modalita === 'draft_libero') {
                // Trova il giocatore da rimuovere
                const draftResult = await db.query(
                    'SELECT giocatore FROM squadre_draft WHERE partecipante_id = $1 AND sessione_id = $2 AND posizione = $3',
                    [partecipante_id, sessione_id, posizione]
                );

                if (draftResult.rows.length > 0) {
                    giocatoreRimosso = draftResult.rows[0].giocatore;
                }

                await db.query(
                    'DELETE FROM squadre_draft WHERE partecipante_id = $1 AND sessione_id = $2 AND posizione = $3',
                    [partecipante_id, sessione_id, posizione]
                );

            } else {
                // Trova l'asta vincente per questa posizione
                const astaResult = await db.query(`
                    SELECT a.id, a.costo_finale, s.giocatore_attuale
                    FROM aste a
                    JOIN slots s ON a.slot_id = s.id AND s.configurazione_id = $3
                    WHERE a.partecipante_id = $1 
                    AND a.sessione_id = $2 
                    AND a.vincitore = true
                    AND s.posizione = $4
                `, [partecipante_id, sessione_id, configurazioneId, posizione]);

                if (astaResult.rows.length > 0) {
                    giocatoreRimosso = astaResult.rows[0].giocatore_attuale;
                    const costo = astaResult.rows[0].costo_finale || 0;

                    // Elimina l'asta
                    await db.query('DELETE FROM aste WHERE id = $1', [astaResult.rows[0].id]);

                    // Restituisci i crediti se richiesto
                    if (restituisci_crediti !== false && costo > 0) {
                        await db.query(`
                            UPDATE partecipanti_sessioni_accesso 
                            SET crediti = crediti + $1 
                            WHERE partecipante_id = $2 AND sessione_id = $3
                        `, [costo, partecipante_id, sessione_id]);
                        creditiRestituiti = costo;
                    }
                }
            }

            console.log(`[EDIT] Rimosso ${giocatoreRimosso || 'nessuno'} da ${posizione} per partecipante ${partecipante_id}. Crediti restituiti: ${creditiRestituiti}`);

            res.json({
                success: true,
                message: giocatoreRimosso
                    ? `Giocatore ${giocatoreRimosso} rimosso dalla posizione ${posizione}`
                    : `Nessun giocatore trovato in posizione ${posizione}`,
                giocatore_rimosso: giocatoreRimosso,
                crediti_restituiti: creditiRestituiti
            });

        } catch (err) {
            console.error('Errore rimuovi giocatore edit:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // =====================================================
    // GET: Dettaglio completo squadra per editing
    // =====================================================
    router.get('/api/edit-squadra/dettaglio/:partecipanteId', async (req, res) => {
        try {
            const partecipanteId = req.params.partecipanteId;
            const { sessione_id } = req.query;

            if (!sessione_id) {
                return res.status(400).json({ error: 'sessione_id richiesto' });
            }

            // Info sessione
            const sessResult = await db.query(
                'SELECT configurazione_id, modalita, crediti_iniziali FROM sessioni_fantagts WHERE id = $1',
                [sessione_id]
            );

            if (sessResult.rows.length === 0) {
                return res.status(404).json({ error: 'Sessione non trovata' });
            }

            const configurazioneId = sessResult.rows[0].configurazione_id;
            const modalita = sessResult.rows[0].modalita;

            // Info partecipante
            const partResult = await db.query(
                'SELECT nome FROM partecipanti_fantagts WHERE id = $1',
                [partecipanteId]
            );

            // Crediti attuali
            const creditiResult = await db.query(
                'SELECT crediti FROM partecipanti_sessioni_accesso WHERE partecipante_id = $1 AND sessione_id = $2',
                [partecipanteId, sessione_id]
            );

            // Posizioni disponibili nella configurazione
            const posizioniResult = await db.query(
                "SELECT DISTINCT posizione, CASE posizione WHEN 'M1' THEN 1 WHEN 'M2' THEN 2 WHEN 'M3' THEN 3 WHEN 'M4' THEN 4 WHEN 'M5' THEN 5 WHEN 'M6' THEN 6 WHEN 'M7' THEN 7 WHEN 'F1' THEN 8 WHEN 'F2' THEN 9 WHEN 'F3' THEN 10 END as ordine FROM slots WHERE configurazione_id = $1 AND attivo = true AND giocatore_attuale IS NOT NULL AND TRIM(giocatore_attuale) != '' ORDER BY ordine",
                [configurazioneId]
            );

            // Squadra attuale
            let squadra = {};

            if (modalita === 'draft_libero') {
                const draftResult = await db.query(`
                    SELECT sd.posizione, sd.giocatore, sd.slot_id, sd.colore_squadra, sd.numero_squadra_circolo,
                           COALESCE(s.punti_totali, 0) as punti_totali
                    FROM squadre_draft sd
                    LEFT JOIN slots s ON sd.slot_id = s.id
                    WHERE sd.partecipante_id = $1 AND sd.sessione_id = $2
                `, [partecipanteId, sessione_id]);

                draftResult.rows.forEach(r => {
                    squadra[r.posizione] = {
                        giocatore: r.giocatore,
                        slot_id: r.slot_id,
                        colore: r.colore_squadra,
                        squadra_numero: r.numero_squadra_circolo,
                        punti_totali: r.punti_totali,
                        costo: 0
                    };
                });
            } else {
                const astaResult = await db.query(`
                    SELECT s.posizione, s.giocatore_attuale, a.slot_id, s.colore, s.squadra_numero,
                           COALESCE(s.punti_totali, 0) as punti_totali, a.costo_finale
                    FROM aste a
                    JOIN slots s ON a.slot_id = s.id AND s.configurazione_id = $3
                    WHERE a.partecipante_id = $1 AND a.sessione_id = $2 AND a.vincitore = true
                `, [partecipanteId, sessione_id, configurazioneId]);

                astaResult.rows.forEach(r => {
                    squadra[r.posizione] = {
                        giocatore: r.giocatore_attuale,
                        slot_id: r.slot_id,
                        colore: r.colore,
                        squadra_numero: r.squadra_numero,
                        punti_totali: r.punti_totali,
                        costo: r.costo_finale || 0
                    };
                });
            }

            res.json({
                partecipante_id: partecipanteId,
                nome: partResult.rows[0]?.nome || 'Sconosciuto',
                sessione_id,
                modalita,
                crediti: creditiResult.rows[0]?.crediti || 0,
                crediti_iniziali: sessResult.rows[0].crediti_iniziali,
                posizioni: posizioniResult.rows.map(r => r.posizione),
                squadra
            });

        } catch (err) {
            console.error('Errore dettaglio squadra edit:', err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};