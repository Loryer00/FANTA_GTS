// js/edit-squadra.js - Frontend per editing manuale squadre partecipanti

// Stato globale del modal di editing
let editSquadraState = {
    partecipanteId: null,
    partecipanteNome: '',
    sessioneId: null,
    modalita: null,
    crediti: 0,
    creditiIniziali: 0,
    posizioni: [],
    squadra: {},
    posizioneCorrente: null
};

// =====================================================
// APERTURA / CHIUSURA MODAL PRINCIPALE
// =====================================================

async function apriEditSquadra(partecipanteId, partecipanteNome) {
    const sessioneId = sessioneCorrente || gameState.sessioneAttiva;

    if (!sessioneId) {
        showNotification('Nessuna sessione attiva', 'error');
        return;
    }

    editSquadraState.partecipanteId = partecipanteId;
    editSquadraState.partecipanteNome = partecipanteNome;
    editSquadraState.sessioneId = sessioneId;

    // Mostra il modal con loading
    document.getElementById('editSquadraModal').style.display = 'flex';
    document.getElementById('editSquadraContent').innerHTML = '<p style="text-align:center; padding: 40px;">Caricamento...</p>';
    document.getElementById('editSquadraTitolo').textContent = 'Modifica Squadra - ' + partecipanteNome;

    try {
        const response = await fetch(`/api/edit-squadra/dettaglio/${partecipanteId}?sessione_id=${sessioneId}`);

        if (!response.ok) {
            throw new Error('Errore caricamento dettaglio squadra');
        }

        const data = await response.json();
        editSquadraState.modalita = data.modalita;
        editSquadraState.crediti = data.crediti;
        editSquadraState.creditiIniziali = data.crediti_iniziali;
        editSquadraState.posizioni = data.posizioni;
        editSquadraState.squadra = data.squadra;

        renderEditSquadra();

    } catch (err) {
        console.error('Errore apertura edit squadra:', err);
        document.getElementById('editSquadraContent').innerHTML =
            '<p style="text-align:center; color: #f56565; padding: 40px;">Errore nel caricamento dei dati</p>';
    }
}

function chiudiEditSquadra() {
    document.getElementById('editSquadraModal').style.display = 'none';

    // Ricarica le squadre nel master per riflettere le modifiche
    if (typeof caricaSquadreInFormazione === 'function') {
        caricaSquadreInFormazione();
    }
}

// =====================================================
// RENDER DEL MODAL PRINCIPALE
// =====================================================

function renderEditSquadra() {
    const container = document.getElementById('editSquadraContent');
    const isDraft = editSquadraState.modalita === 'draft_libero';

    let html = '';

    // Info crediti (solo per asta)
    if (!isDraft) {
        html += `
            <div id="editCreditiInfo" style="
                background: rgba(245, 158, 11, 0.15);
                border: 1px solid rgba(245, 158, 11, 0.3);
                border-radius: 10px;
                padding: 12px;
                margin-bottom: 15px;
                text-align: center;
                font-size: 0.95em;
            ">
                Crediti disponibili: <strong id="editCreditiDisplay" style="color: #f59e0b; font-size: 1.2em;">${editSquadraState.crediti}</strong>
                / ${editSquadraState.creditiIniziali}
            </div>
        `;
    }

    // Griglia posizioni
    html += '<div style="display: flex; flex-direction: column; gap: 8px;">';

    editSquadraState.posizioni.forEach(pos => {
        const giocatore = editSquadraState.squadra[pos];

        if (giocatore) {
            // Slot OCCUPATO
            const teamColor = typeof getTeamColorForMaster === 'function'
                ? getTeamColorForMaster(giocatore.colore)
                : '#4299e1';

            html += `
                <div id="edit-slot-${pos}" style="
                    background: linear-gradient(135deg, ${teamColor}40, ${teamColor}20);
                    border: 2px solid ${teamColor};
                    border-radius: 10px;
                    padding: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                ">
                    <div style="flex: 0 0 45px; text-align: center;">
                        <div style="font-weight: bold; font-size: 0.85em; color: #a0aec0;">${pos}</div>
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: bold; font-size: 1em;">${giocatore.giocatore}</div>
                        <div style="font-size: 0.8em; opacity: 0.7;">Squadra ${giocatore.colore}${!isDraft ? ' | Costo: ' + giocatore.costo : ''}</div>
                    </div>
                    <div style="display: flex; gap: 6px; flex-shrink: 0;">
                        <button onclick="apriSelezioneGiocatoreModal('${pos}')" style="
                            background: #f59e0b; color: #000; border: none; border-radius: 6px;
                            padding: 6px 10px; cursor: pointer; font-size: 0.8em; font-weight: bold;
                        ">Cambia</button>
                        <button onclick="rimuoviGiocatoreEdit('${pos}')" style="
                            background: #f56565; color: white; border: none; border-radius: 6px;
                            padding: 6px 10px; cursor: pointer; font-size: 0.8em; font-weight: bold;
                        ">Rimuovi</button>
                    </div>
                </div>
            `;
        } else {
            // Slot VUOTO
            html += `
                <div id="edit-slot-${pos}" style="
                    background: rgba(74, 85, 104, 0.2);
                    border: 2px dashed #4a5568;
                    border-radius: 10px;
                    padding: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                ">
                    <div style="flex: 0 0 45px; text-align: center;">
                        <div style="font-weight: bold; font-size: 0.85em; color: #a0aec0;">${pos}</div>
                    </div>
                    <div style="flex: 1; opacity: 0.5; font-style: italic;">- vuoto -</div>
                    <button onclick="apriSelezioneGiocatoreModal('${pos}')" style="
                        background: #48bb78; color: white; border: none; border-radius: 6px;
                        padding: 6px 12px; cursor: pointer; font-size: 0.8em; font-weight: bold;
                    ">Aggiungi</button>
                </div>
            `;
        }
    });

    html += '</div>';

    container.innerHTML = html;
}

// =====================================================
// MODAL SELEZIONE GIOCATORE (seconda finestra)
// =====================================================

async function apriSelezioneGiocatoreModal(posizione) {
    editSquadraState.posizioneCorrente = posizione;

    // Apri la seconda modal
    document.getElementById('selezioneGiocatoreModal').style.display = 'flex';
    document.getElementById('selezioneGiocatoreTitolo').textContent = 'Giocatori disponibili per ' + posizione;
    document.getElementById('selezioneGiocatoreContent').innerHTML = '<p style="text-align:center; padding: 30px;">Caricamento...</p>';

    try {
        const response = await fetch(
            `/api/edit-squadra/giocatori-disponibili?sessione_id=${editSquadraState.sessioneId}&posizione=${posizione}`
        );

        if (!response.ok) throw new Error('Errore caricamento');

        const data = await response.json();
        const isDraft = editSquadraState.modalita === 'draft_libero';

        let html = '';

        if (data.giocatori.length === 0) {
            html = '<p style="text-align:center; opacity: 0.6; padding: 20px;">Nessun giocatore disponibile</p>';
        } else {
            data.giocatori.forEach(g => {
                const teamColor = typeof getTeamColorForMaster === 'function'
                    ? getTeamColorForMaster(g.colore)
                    : '#4299e1';

                const isAssegnato = g.assegnato_a !== null;
                const isAssegnatoAMe = isAssegnato && g.assegnato_a.partecipante_id === editSquadraState.partecipanteId;

                let badgeHtml = '';
                if (isAssegnatoAMe) {
                    badgeHtml = '<span style="color: #48bb78; font-size: 0.8em; font-weight: bold;">GIA TUO</span>';
                } else if (isAssegnato) {
                    badgeHtml = `<span style="color: #f59e0b; font-size: 0.75em;">Assegnato a ${g.assegnato_a.nome}</span>`;
                }

                // Input costo (solo per asta)
                let costoInput = '';
                if (!isDraft) {
                    costoInput = `
                        <input type="number" id="costo-${g.slot_id}" value="0" min="0" 
                            placeholder="Costo" style="
                                width: 70px; padding: 6px 8px; border-radius: 6px; border: 1px solid #4a5568;
                                background: rgba(255,255,255,0.1); color: #e2e8f0; font-size: 0.9em;
                                text-align: center;
                            "
                        />
                    `;
                }

                html += `
                    <div style="
                        display: flex; align-items: center; gap: 12px;
                        padding: 10px 12px; margin-bottom: 6px;
                        background: ${isAssegnatoAMe ? 'rgba(72, 187, 120, 0.15)' : 'rgba(255,255,255,0.05)'};
                        border-radius: 10px;
                        border-left: 4px solid ${teamColor};
                        ${isAssegnato && !isAssegnatoAMe ? 'opacity: 0.7;' : ''}
                    ">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: bold; font-size: 1em;">${g.nome}</div>
                            <div style="font-size: 0.8em; opacity: 0.7; margin-top: 2px;">
                                Squadra ${g.colore} (#${g.squadra_numero}) | Punti: ${g.punti_totali}
                            </div>
                            ${badgeHtml ? '<div style="margin-top: 3px;">' + badgeHtml + '</div>' : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                            ${costoInput}
                            <button onclick="assegnaGiocatoreEdit('${posizione}', '${g.slot_id}')" style="
                                background: ${isAssegnatoAMe ? '#4a5568' : '#48bb78'}; 
                                color: white; border: none; border-radius: 8px;
                                padding: 8px 14px; cursor: pointer; font-size: 0.85em; font-weight: bold;
                                ${isAssegnatoAMe ? 'cursor: not-allowed;' : ''}
                            " ${isAssegnatoAMe ? 'disabled' : ''}>
                                ${isAssegnatoAMe ? 'Assegnato' : 'Assegna'}
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        document.getElementById('selezioneGiocatoreContent').innerHTML = html;

    } catch (err) {
        console.error('Errore caricamento giocatori:', err);
        document.getElementById('selezioneGiocatoreContent').innerHTML =
            '<p style="text-align:center; color: #f56565; padding: 20px;">Errore nel caricamento</p>';
    }
}

function chiudiSelezioneGiocatoreModal() {
    document.getElementById('selezioneGiocatoreModal').style.display = 'none';
}

// =====================================================
// AZIONI: ASSEGNA / RIMUOVI
// =====================================================

async function assegnaGiocatoreEdit(posizione, slotId) {
    const isDraft = editSquadraState.modalita === 'draft_libero';
    let costo = 0;

    if (!isDraft) {
        const costoInput = document.getElementById('costo-' + slotId);
        costo = costoInput ? parseInt(costoInput.value) || 0 : 0;

        // Verifica crediti
        if (costo > editSquadraState.crediti) {
            showNotification('Crediti insufficienti! Disponibili: ' + editSquadraState.crediti, 'error');
            return;
        }
    }

    try {
        const response = await fetch('/api/edit-squadra/assegna', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessione_id: editSquadraState.sessioneId,
                partecipante_id: editSquadraState.partecipanteId,
                slot_id: slotId,
                posizione: posizione,
                costo: costo
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showNotification('Errore: ' + (data.error || 'Errore sconosciuto'), 'error');
            return;
        }

        showNotification(data.message, 'success');

        // Chiudi la modal di selezione
        chiudiSelezioneGiocatoreModal();

        // Ricarica i dati del modal principale
        await ricaricarDatiEdit();

    } catch (err) {
        console.error('Errore assegnazione:', err);
        showNotification('Errore di connessione', 'error');
    }
}

async function rimuoviGiocatoreEdit(posizione) {
    const giocatore = editSquadraState.squadra[posizione];
    if (!giocatore) return;

    const conferma = confirm(
        'Vuoi rimuovere ' + giocatore.giocatore + ' dalla posizione ' + posizione + '?'
    );

    if (!conferma) return;

    try {
        const response = await fetch('/api/edit-squadra/rimuovi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessione_id: editSquadraState.sessioneId,
                partecipante_id: editSquadraState.partecipanteId,
                posizione: posizione,
                restituisci_crediti: true
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showNotification('Errore: ' + (data.error || 'Errore sconosciuto'), 'error');
            return;
        }

        let msg = data.message;
        if (data.crediti_restituiti > 0) {
            msg += ' (+' + data.crediti_restituiti + ' crediti restituiti)';
        }
        showNotification(msg, 'success');

        // Ricarica i dati del modal principale
        await ricaricarDatiEdit();

    } catch (err) {
        console.error('Errore rimozione:', err);
        showNotification('Errore di connessione', 'error');
    }
}

// =====================================================
// RICARICA DATI DOPO MODIFICA
// =====================================================

async function ricaricarDatiEdit() {
    try {
        const response = await fetch(
            `/api/edit-squadra/dettaglio/${editSquadraState.partecipanteId}?sessione_id=${editSquadraState.sessioneId}`
        );

        if (!response.ok) throw new Error('Errore ricarica');

        const data = await response.json();
        editSquadraState.crediti = data.crediti;
        editSquadraState.squadra = data.squadra;

        renderEditSquadra();

    } catch (err) {
        console.error('Errore ricarica dati edit:', err);
    }
}