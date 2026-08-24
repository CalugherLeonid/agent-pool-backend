require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { sequelize } = require('./models');
const openapiSpec = require('./utils/openapiSpec');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Rute
app.use('/api/owners', require('./routes/owners'));
app.use('/api/agents', require('./routes/agents'));        //
app.use('/api/metabolism', require('./routes/metabolism')); //
app.use('/api/discovery', require('./routes/discovery'));   // Faza 1.5 / 2.5.4
app.use('/api/bounties', require('./routes/bounties'));      // Bounties API
app.use('/api/bids', require('./routes/bids'));               // Bids API
app.use('/api/subcontracts', require('./routes/subcontracts')); // Subcontracts API
app.use('/api/transactions', require('./routes/transactions'));  // Transactions API
app.use('/api/agent-memories', require('./routes/agentMemories')); // AgentMemory API
app.use('/api/shared-knowledge', require('./routes/sharedKnowledge')); // SharedKnowledge API

// Rute publice de discovery (fără autentificare)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Faza 1.5 / 2.5.7: spec OpenAPI + Swagger UI interactiv
app.get('/api/openapi.json', (req, res) => res.json(openapiSpec));
app.use('/api/openapi/ui', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// Ruta pentru Agent Card (A2A discovery)
// Faza 1.5 / 2.5.4: reflectă DOAR ce este implementat efectiv acum.
// Nu promitem MCP, Stripe sau bounty_market — acestea nu există încă și
// un agent extern care le încearcă și primește 404 pierde încrederea
// în tot pool-ul. Se extinde pe măsură ce fazele următoare sunt gata.
app.get('/.well-known/agent-card.json', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
        name: 'Agent Pool',
        description: 'Autonomous machine-to-machine agent economy. Agents register, track spend, and are discoverable by skill.',
        version: '4.2',
        protocol: 'a2a-compatible',
        capabilities: ['agent_management', 'metabolism_tracking', 'skill_discovery', 'bounty_market'],
        endpoints: {
            register: `${baseUrl}/api/owners/register`,
            login: `${baseUrl}/api/owners/login`,
            agents: `${baseUrl}/api/agents`,
            bounties: `${baseUrl}/api/bounties`,
            discovery: `${baseUrl}/api/discovery`,
            openapi: `${baseUrl}/api/openapi.json`
        },
        auth: {
            owner: 'JWT Bearer',
            agent: 'x-api-key header'
        },
        economy: {
            currency: 'AC',
            description: 'Internal unit for agent-to-agent transactions'
        },
        skills_taxonomy_url: `${baseUrl}/api/discovery/skills`
    });
});

// Webhook Stripe (pentru plăți) – deocamdată placeholder
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
    res.json({ received: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    try {
        await sequelize.authenticate();
        console.log(`✅ PostgreSQL connected`);
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📚 Health: http://localhost:${PORT}/api/health`);
        console.log(`🧲 Discovery: http://localhost:${PORT}/api/discovery`);
        console.log(`📖 OpenAPI: http://localhost:${PORT}/api/openapi.json (UI: /api/openapi/ui)`);
        console.log(`🪪 Agent card: http://localhost:${PORT}/.well-known/agent-card.json`);
    } catch (err) {
        console.error('❌ Database connection error:', err);
    }
});

module.exports = app;