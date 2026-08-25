// Subcontracts API — actualizare reputație la finalizarea unui subcontract.
//
// success_rate: medie ponderată simplă pe toate subcontractele finalizate.
// outcome = 100 (confirmare reușită) sau 0 (dispută pierdută de seller).
//
// reputation_score: combinație calitate × volum dovedit.
// Formula: success_rate × log2(1 + n) / log2(1 + MAX_MEANINGFUL)
// - Un agent nou (n=0) pornește la 0, indiferent de success_rate
// - Crește organic cu fiecare livrare dovedită
// - Plafonează la 100 după ~50 livrări cu success_rate perfect
// - Previne ca un agent cu 1 livrare să aibă același scor cu unul cu 50
//
// win_rate: bids câștigate / total bids trimise.
// Actualizat în bids.js la momentul acceptării (nu aici).

const MAX_MEANINGFUL_DELIVERIES = 50;

function computeReputationScore(successRate, confirmedDeliveries) {
    if (confirmedDeliveries === 0) return 0;
    const volumeFactor = Math.log2(1 + confirmedDeliveries) / Math.log2(1 + MAX_MEANINGFUL_DELIVERIES);
    return Math.min(100, parseFloat(successRate) * volumeFactor);
}

async function updateSellerReputation(seller, wasSuccessful, Subcontract, Op, transaction) {
    const priorCount = await Subcontract.count({
        where: {
            seller_agent_id: seller.id,
            status: { [Op.in]: ['confirmed', 'resolved'] }
        },
        transaction
    });

    // success_rate: medie ponderată
    const oldRate = parseFloat(seller.success_rate);
    const outcome = wasSuccessful ? 100 : 0;
    seller.success_rate = ((oldRate * priorCount) + outcome) / (priorCount + 1);

    // reputation_score: calitate × volum (calculat pe noul success_rate)
    const newConfirmedCount = priorCount + 1;
    seller.reputation_score = computeReputationScore(seller.success_rate, newConfirmedCount);
}

// win_rate: bids câștigate / total bids trimise pentru un agent
async function updateWinRate(agent, Bid, transaction) {
    const [totalBids, wonBids] = await Promise.all([
        Bid.count({
            where: { agent_id: agent.id },
            transaction
        }),
        Bid.count({
            where: { agent_id: agent.id, status: 'accepted' },
            transaction
        })
    ]);
    agent.win_rate = totalBids > 0 ? (wonBids / totalBids) * 100 : 0;
}

module.exports = { updateSellerReputation, updateWinRate, computeReputationScore };
