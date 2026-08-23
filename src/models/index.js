const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: 'postgres',
        logging: false,
        pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
    }
);

// ---------- Definire modele ----------
const Owner = sequelize.define('Owner', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING(255), unique: true, allowNull: false },
    password_hash: { type: DataTypes.TEXT, allowNull: false },
    is_human: { type: DataTypes.BOOLEAN, defaultValue: true },
    stripe_customer_id: { type: DataTypes.STRING(255) }
}, { timestamps: true });

const Agent = sequelize.define('Agent', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    owner_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Owners', key: 'id' } },
    agent_name: { type: DataTypes.STRING(100), allowNull: false },
    // DEPRECAT (Faza 1.5 / 2.5.1): cheia în clar nu mai este scrisă pentru agenți noi.
    // Rămâne allowNull: true doar pentru compatibilitate cu rânduri vechi până la
    // finalizarea migrării (pasul 2: ștergerea coloanei, făcută manual, controlat).
    api_key: { type: DataTypes.STRING(255), unique: true, allowNull: true },
    // NOU (Faza 1.5 / 2.5.1): hash SHA-256+pepper al cheii API. Singura valoare
    // folosită pentru autentificare de acum înainte. Indexat unic pentru lookup rapid.
    api_key_hash: { type: DataTypes.STRING(64), unique: true, allowNull: true },
    balance_ac: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    daily_budget_ac: { type: DataTypes.DECIMAL(10, 2), defaultValue: 50 },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    kill_switch: { type: DataTypes.BOOLEAN, defaultValue: false },
    reputation_score: { type: DataTypes.DECIMAL(5, 2), defaultValue: 50 },
    win_rate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
    success_rate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
    // NOU (Faza 1.5 / 2.5.3): skill-uri dintr-o taxonomie controlată
    // (vezi utils/skillsTaxonomy.js). Folosit pentru matching automat
    // cu Bounties și pentru endpoint-ul public de discovery.
    skills: { type: DataTypes.ARRAY(DataTypes.STRING(50)), defaultValue: [] }
}, { timestamps: true });

const Bounty = sequelize.define('Bounty', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    creator_agent_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Agents', key: 'id' } },
    client_email: { type: DataTypes.STRING(255), allowNull: true },
    title: { type: DataTypes.TEXT, allowNull: false },
    description: { type: DataTypes.TEXT },
    budget_eur: { type: DataTypes.DECIMAL(10, 2) },
    budget_ac: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    // NOU (Bounties API): skill-uri necesare, din aceeași taxonomie controlată
    // ca Agent.skills — folosit pentru matching automat.
    required_skills: { type: DataTypes.ARRAY(DataTypes.STRING(50)), defaultValue: [] },
    status: { type: DataTypes.STRING(20), defaultValue: 'open' },
    assigned_agent_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Agents', key: 'id' } },
    draft_url: { type: DataTypes.TEXT },
    human_review_status: { type: DataTypes.STRING(20), defaultValue: 'pending' },
    revision_feedback: { type: DataTypes.TEXT },
    completed_at: { type: DataTypes.DATE }
}, { timestamps: true });

const Bid = sequelize.define('Bid', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    bounty_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Bounties', key: 'id' } },
    agent_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Agents', key: 'id' } },
    bid_ac: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    // NOU (Bids API): timp estimat de livrare, auto-declarat de agentul
    // licitant — folosit în formula de scor (Pilon 1).
    execution_latency_hours: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(20), defaultValue: 'pending' }
}, { timestamps: true });

const Transaction = sequelize.define('Transaction', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    agent_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Agents', key: 'id' } },
    type: { type: DataTypes.STRING(30), allowNull: false },
    amount_ac: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    fee_ac: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    description: { type: DataTypes.TEXT },
    metadata: { type: DataTypes.JSONB }
}, { timestamps: true });

const Subcontract = sequelize.define('Subcontract', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    buyer_agent_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Agents', key: 'id' } },
    seller_agent_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Agents', key: 'id' } },
    bounty_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Bounties', key: 'id' } },
    amount_ac: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    // NOU (Subcontracts API): momentul livrării — pornește ceasul de 72h
    // pentru confirmare optimistă / trecere automată în dispute.
    delivered_at: { type: DataTypes.DATE, allowNull: true },
    // Faza 1.5 / 2.5.6: schema pregătitoare pentru escrow. Logica efectivă
    // (blocare/eliberare fonduri) rămâne de implementat în Bounties/Bids API.
    status: {
        type: DataTypes.STRING(20),
        defaultValue: 'pending',
        validate: {
            isIn: [['pending', 'funded', 'in_progress', 'delivered', 'confirmed', 'disputed', 'resolved', 'cancelled']]
        }
    }
}, { timestamps: true });

const AgentMemory = sequelize.define('AgentMemory', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    agent_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Agents', key: 'id' } },
    experience: { type: DataTypes.TEXT, allowNull: false },
    lesson: { type: DataTypes.TEXT },
    validated: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { timestamps: true });

const SharedKnowledge = sequelize.define('SharedKnowledge', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    lesson: { type: DataTypes.TEXT, allowNull: false },
    validation_count: { type: DataTypes.INTEGER, defaultValue: 1 },
    confirmed: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { timestamps: true });

// ---------- Asociații ----------
Owner.hasMany(Agent, { foreignKey: 'owner_id' });
Agent.belongsTo(Owner, { foreignKey: 'owner_id' });

Agent.hasMany(Bounty, { foreignKey: 'assigned_agent_id', as: 'assignedBounties' });
Bounty.belongsTo(Agent, { foreignKey: 'assigned_agent_id', as: 'assignedAgent' });

Bounty.hasMany(Bid, { foreignKey: 'bounty_id' });
Bid.belongsTo(Bounty, { foreignKey: 'bounty_id' });

Agent.hasMany(Bid, { foreignKey: 'agent_id' });
Bid.belongsTo(Agent, { foreignKey: 'agent_id' });

Agent.hasMany(Transaction, { foreignKey: 'agent_id' });
Transaction.belongsTo(Agent, { foreignKey: 'agent_id' });

Agent.hasMany(Subcontract, { foreignKey: 'buyer_agent_id', as: 'buyerSubcontracts' });
Agent.hasMany(Subcontract, { foreignKey: 'seller_agent_id', as: 'sellerSubcontracts' });
Subcontract.belongsTo(Agent, { foreignKey: 'buyer_agent_id', as: 'buyer' });
Subcontract.belongsTo(Agent, { foreignKey: 'seller_agent_id', as: 'seller' });
Subcontract.belongsTo(Bounty, { foreignKey: 'bounty_id' });

Agent.hasMany(AgentMemory, { foreignKey: 'agent_id' });
AgentMemory.belongsTo(Agent, { foreignKey: 'agent_id' });

// ---------- Sincronizare automată (doar pentru dezvoltare) ----------
// Rulează o singură dată pentru a crea tabelele. După primul start, poți comenta acest bloc.
sequelize.sync({ alter: true })
    .then(() => console.log('✅ Tabelele au fost create/sincronizate'))
    .catch(err => console.error('❌ Sync error:', err));

module.exports = {
    sequelize,
    Owner,
    Agent,
    Bounty,
    Bid,
    Transaction,
    Subcontract,
    AgentMemory,
    SharedKnowledge
};