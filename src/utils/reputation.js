// Subcontracts API — actualizare reputație la finalizarea unui subcontract.
//
// success_rate nou = (success_rate vechi × nr. subcontracte finalizate anterior + rezultat) / (nr. + 1)
// unde rezultat = 100 dacă livrarea a fost confirmată cu succes, 0 dacă
// disputa a fost rezolvată împotriva seller-ului.
//
// NOTĂ: formulă simplă pentru MVP — o medie ponderată egal pe toate
// subcontractele finalizate. Nu ține cont de recency (un eșec recent
// cântărește la fel ca unul vechi) — rafinare posibilă ulterior (ex:
// medie exponențială, care penalizează/recompensează recent mai mult).

async function updateSellerSuccessRate(seller, wasSuccessful, Subcontract, Op, transaction) {
    const priorCount = await Subcontract.count({
        where: {
            seller_agent_id: seller.id,
            status: { [Op.in]: ['confirmed', 'resolved'] }
        },
        transaction
    });

    const oldRate = parseFloat(seller.success_rate);
    const outcome = wasSuccessful ? 100 : 0;
    seller.success_rate = ((oldRate * priorCount) + outcome) / (priorCount + 1);
}

module.exports = { updateSellerSuccessRate };
