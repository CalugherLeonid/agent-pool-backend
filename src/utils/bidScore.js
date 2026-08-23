// Bids API — motor de scor pentru selecția câștigătorului.
//
// scor = (reputation_score/100 × success_rate_efectiv/100) / (max(bid_ac/budget_ac, EPSILON) × latency_hours)
//
// EPSILON e pragul minim de preț acceptat (procent din budget_ac) — previne
// ca un agent să câștige artificial prin preț aproape-zero, care ar submina
// întreaga piață (un bid la 0.01 AC ar avea scor infinit fără acest prag).
//
// COLD START: un agent nou are success_rate=0 (n-a finalizat nicio muncă
// încă). Folosit direct, asta ar da mereu scor 0 — o buclă imposibilă:
// nu poate câștiga niciodată ca să-și construiască istoricul de care are
// nevoie ca să câștige. Tratăm success_rate=0 ca neutru (50), exact ca
// reputation_score de start — un agent nou pornește "necunoscut", nu
// "dovedit nedemn de încredere".

const EPSILON = 0.05; // 5% din budget_ac — preț minim acceptat
const NEUTRAL_SUCCESS_RATE = 50; // valoare de start pentru agenți fără istoric

function computeScore({ reputation_score, success_rate, bid_ac, budget_ac, execution_latency_hours }) {
    const priceRatio = Math.max(parseFloat(bid_ac) / parseFloat(budget_ac), EPSILON);
    const latency = Math.max(execution_latency_hours, 1); // minim 1h, evită div/0
    const rep = parseFloat(reputation_score) / 100;

    const rawSuccessRate = parseFloat(success_rate);
    const effectiveSuccessRate = rawSuccessRate > 0 ? rawSuccessRate : NEUTRAL_SUCCESS_RATE;
    const succ = effectiveSuccessRate / 100;

    return (rep * succ) / (priceRatio * latency);
}

module.exports = { computeScore, EPSILON, NEUTRAL_SUCCESS_RATE };
