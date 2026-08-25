const { Op, Subcontract, Agent } = require('../models');

// Faza restante: Anti-Wash-Trading
//
// Strat 1 — dur: doi agenți controlați de același owner NU pot tranzacționa
// deloc între ei. Control comun = fraudă garantată, nicio excepție.
//
// Strat 2 — moale: chiar și între owneri diferiți, dacă aceeași pereche
// buyer-seller a confirmat deja 3+ subcontracte în ultimele 30 de zile,
// blocăm noi bid-uri — nu pentru că e fraudă certă, ci pentru că nu mai
// există dovadă de diversitate (cunoaștere nouă, nu confirmare circulară).

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

    const count = await Subcontract.count({
        where: {
            buyer_agent_id: buyerAgentId,
            seller_agent_id: sellerAgentId,
            status: 'confirmed',
            createdAt: { [Op.gte]: windowStart }
        }
    });
    return count >= WASH_TRADING_MAX_PAIRS;
}

module.exports = { isSameOwner, isPairSaturated, WASH_TRADING_MAX_PAIRS, WASH_TRADING_WINDOW_DAYS };
