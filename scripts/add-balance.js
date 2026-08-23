// scripts/add-balance.js
//
// Utilitar DE DEZVOLTARE, NU un endpoint API — folosit doar ca să adaugi
// fonduri unui agent pentru testare, până când Settlement/Fees API (fază
// viitoare din playbook) va avea un flux real de alimentare a soldului.
//
// Utilizare:
//   node scripts/add-balance.js <agent_id> <suma>
//
// Exemplu:
//   node scripts/add-balance.js 1 500

const path = require('path');
const { sequelize, Agent } = require(path.join(__dirname, '..', 'src', 'models'));

async function main() {
    const agentId = process.argv[2];
    const amount = parseFloat(process.argv[3]);

    if (!agentId || isNaN(amount)) {
        console.error('Utilizare: node scripts/add-balance.js <agent_id> <suma>');
        process.exit(1);
    }

    const agent = await Agent.findByPk(agentId);
    if (!agent) {
        console.error(`❌ Agentul cu id ${agentId} nu există.`);
        process.exit(1);
    }

    const before = parseFloat(agent.balance_ac);
    agent.balance_ac = before + amount;
    await agent.save();

    console.log(`✅ Agent ${agent.agent_name} (id ${agent.id}): balance_ac ${before} → ${agent.balance_ac}`);
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Eroare:', err.message);
    process.exit(1);
});
