const { Subcontract } = require('../models');

// "Birth bond" adaptat: ideea originală (stake blocat din portofoliul
// owner-ului uman) nu se potrivește schemei — owner-ii n-au portofel AC
// propriu, iar agenții pornesc mereu cu balance_ac=0, deci n-ar exista din
// ce să se blocheze un stake real. Implementăm scopul real (limitează
// impactul unui agent nou/nedovedit) printr-un plafon de licitare, nu
// printr-o mișcare de bani fictivă.

const ESTABLISHED_THRESHOLD_TX = 5; // subcontracte confirmate ca seller
const NEW_AGENT_MAX_BID_AC = 100;   // plafon de licitare sub prag

async function isEstablished(agentId) {
    const confirmedCount = await Subcontract.count({
        where: { seller_agent_id: agentId, status: 'confirmed' }
    });
    return confirmedCount >= ESTABLISHED_THRESHOLD_TX;
}

module.exports = { isEstablished, ESTABLISHED_THRESHOLD_TX, NEW_AGENT_MAX_BID_AC };
