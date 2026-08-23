// Subcontracts API — fereastra optimistă de confirmare.
// Dacă buyer-ul nu confirmă/disputa în 72h de la livrare, subcontractul
// trece automat în 'disputed' — NU se eliberează automat plata (asta ar
// deschide loc de fraudă: livrezi ceva fals, aștepți timeout-ul, iei banii).
// 'disputed' rămâne vizibil owner-ului uman ca excepție rară, nu bottleneck
// zilnic — majoritatea subcontractelor se confirmă normal, mult sub 72h.

const DISPUTE_TIMEOUT_HOURS = 72;

function isTimedOut(deliveredAt) {
    if (!deliveredAt) return false;
    const elapsedMs = Date.now() - new Date(deliveredAt).getTime();
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    return elapsedHours >= DISPUTE_TIMEOUT_HOURS;
}

module.exports = { DISPUTE_TIMEOUT_HOURS, isTimedOut };
