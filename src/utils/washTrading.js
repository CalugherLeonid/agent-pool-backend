const { Op, literal } = require('sequelize');
const { Subcontract, Agent, sequelize } = require('../models');

// Anti-Wash-Trading — 2 straturi
//
// Strat 1 — dur: doi agenți controlați de același owner NU pot tranzacționa.
// Control comun = fraudă garantată, nicio excepție.
//
// Strat 2 — moale (FIX pair saturation bypass):
// Verificarea se face la nivel de OWNER, nu de agent.
//
// PROBLEMA ANTERIOARĂ (gap cunoscut din ADR-008):
// Dacă Owner A și Owner B sunt complici, puteau ocoli pair saturation:
//   A1 ↔ B1 (3 tx → saturat) → creează B2 → A1 ↔ B2 (3 tx → saturat) etc.
// Fiecare pereche nouă de agenți reseta contorul.
//
// FIX-UL:
// Numărăm câte subcontracte confirmate există între ORICE agent al owner_A
// și ORICE agent al owner_B în ultimele 30 de zile.
// Niciun număr de agenți noi creați nu poate ocoli asta.

const WASH_TRADING_WINDOW_DAYS = 30;
const WASH_TRADING_MAX_PAIRS = 3;

async function isSameOwner(agentId1, agentId2) {
    const [a1, a2] = await Promise.all([
        Agent.findByPk(agentId1, { attributes: ['owner_id'] }),
        Agent.findByPk(agentId2, { attributes: ['owner_id'] })
    ]);
    if (!a1 || !a2) return false;
    return a1.owner_id === a2.owner_id;
}

async function isPairSaturated(buyerAgentId, sellerAgentId) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - WASH_TRADING_WINDOW_DAYS);

    // Obținem owner_id pentru ambii agenți
    const [buyer, seller] = await Promise.all([
        Agent.findByPk(buyerAgentId, { attributes: ['owner_id'] }),
        Agent.findByPk(sellerAgentId, { attributes: ['owner_id'] })
    ]);

    if (!buyer || !seller) return false;

    // Dacă au același owner, e blocat deja de isSameOwner() — nu ajungem aici
    if (buyer.owner_id === seller.owner_id) return true;

    // FIX: numărăm subcontractele confirmate între TOȚI agenții celor doi owneri
    // în fereastra de timp — nu doar între acești doi agenți specifici.
    //
    // Query: câte subcontracte confirmate există unde:
    //   buyer e un agent al buyer.owner_id
    //   ȘI seller e un agent al seller.owner_id
    //   SAU invers (owner_A vinde, owner_B cumpără)
    const count = await Subcontract.count({
        where: {
            status: 'confirmed',
            createdAt: { [Op.gte]: windowStart },
            [Op.or]: [
                {
                    // buyer_owner → seller_owner
                    buyer_agent_id: {
                        [Op.in]: sequelize.literal(
                            `(SELECT id FROM "Agents" WHERE owner_id = ${buyer.owner_id})`
                        )
                    },
                    seller_agent_id: {
                        [Op.in]: sequelize.literal(
                            `(SELECT id FROM "Agents" WHERE owner_id = ${seller.owner_id})`
                        )
                    }
                },
                {
                    // seller_owner → buyer_owner (direcție inversă)
                    buyer_agent_id: {
                        [Op.in]: sequelize.literal(
                            `(SELECT id FROM "Agents" WHERE owner_id = ${seller.owner_id})`
                        )
                    },
                    seller_agent_id: {
                        [Op.in]: sequelize.literal(
                            `(SELECT id FROM "Agents" WHERE owner_id = ${buyer.owner_id})`
                        )
                    }
                }
            ]
        }
    });

    return count >= WASH_TRADING_MAX_PAIRS;
}

module.exports = { isSameOwner, isPairSaturated, WASH_TRADING_MAX_PAIRS, WASH_TRADING_WINDOW_DAYS };

