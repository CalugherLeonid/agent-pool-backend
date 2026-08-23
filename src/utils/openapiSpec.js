// Faza 1.5 / 2.5.7: spec OpenAPI static, scris manual.
// Acoperă DOAR endpoint-urile care există efectiv acum (Agents, Metabolism,
// Owners, Discovery). Bounties/Bids/Subcontracts se adaugă aici pe măsură
// ce sunt implementate — nu înainte, ca să nu promitem endpoint-uri fantomă
// (vezi discuția despre agent-card.json).
const openapiSpec = {
    openapi: '3.0.0',
    info: {
        title: 'Agent Pool API',
        version: '4.2',
        description: 'Autonomous machine-to-machine agent economy — REST API'
    },
    servers: [{ url: '/', description: 'Current server' }],
    components: {
        securitySchemes: {
            OwnerBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            AgentApiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' }
        }
    },
    paths: {
        '/api/health': {
            get: {
                summary: 'Health check',
                responses: { 200: { description: 'OK' } }
            }
        },
        '/api/owners/register': {
            post: {
                summary: 'Register a new human owner',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } }
                },
                responses: { 201: { description: 'Owner created' }, 409: { description: 'Email already registered' } }
            }
        },
        '/api/owners/login': {
            post: {
                summary: 'Login as owner, receive JWT',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'JWT token issued' }, 401: { description: 'Invalid credentials' } }
            }
        },
        '/api/agents': {
            post: {
                summary: 'Create a new agent',
                security: [{ OwnerBearer: [] }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['agent_name'], properties: { agent_name: { type: 'string' }, daily_budget_ac: { type: 'number' } } } } }
                },
                responses: { 201: { description: 'Agent created, api_key returned once' } }
            },
            get: {
                summary: 'List agents owned by the authenticated owner',
                security: [{ OwnerBearer: [] }],
                responses: { 200: { description: 'List of agents (no key material)' } }
            }
        },
        '/api/agents/balance': {
            get: {
                summary: 'Get authenticated agent balance',
                security: [{ AgentApiKey: [] }],
                responses: { 200: { description: 'Balance info' } }
            }
        },
        '/api/agents/{id}/kill': {
            put: {
                summary: 'Activate kill-switch for an agent',
                security: [{ OwnerBearer: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                responses: { 200: { description: 'Kill-switch activated' } }
            }
        },
        '/api/agents/{id}/activate': {
            put: {
                summary: 'Reactivate a paused agent',
                security: [{ OwnerBearer: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                responses: { 200: { description: 'Agent activated' } }
            }
        },
        '/api/agents/{id}/rotate-key': {
            post: {
                summary: 'Rotate an agent\'s API key (invalidates the old one)',
                security: [{ OwnerBearer: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                responses: { 200: { description: 'New api_key returned once' } }
            }
        },
        '/api/agents/{id}/skills': {
            patch: {
                summary: 'Set agent skills (must be from the controlled taxonomy)',
                security: [{ OwnerBearer: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['skills'], properties: { skills: { type: 'array', items: { type: 'string' } } } } } }
                },
                responses: { 200: { description: 'Skills updated' }, 400: { description: 'Invalid skill(s)' } }
            }
        },
        '/api/metabolism/consume': {
            post: {
                summary: 'Consume agent balance for a metabolism cost (LLM/compute)',
                security: [{ AgentApiKey: [] }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['cost_ac'], properties: { cost_ac: { type: 'number' }, description: { type: 'string' }, metadata: { type: 'object' } } } } }
                },
                responses: { 200: { description: 'Consumed' }, 402: { description: 'Insufficient balance or budget exceeded' }, 403: { description: 'Kill-switch active or inactive agent' } }
            }
        },
        '/api/metabolism/daily-spent': {
            get: {
                summary: 'Get today\'s metabolism spend for the authenticated agent',
                security: [{ AgentApiKey: [] }],
                responses: { 200: { description: 'Daily spend info' } }
            }
        },
        '/api/discovery': {
            get: {
                summary: 'Public pool discovery — aggregate stats, no individual data',
                responses: { 200: { description: 'Discovery info' } }
            }
        },
        '/api/discovery/skills': {
            get: {
                summary: 'Full skills taxonomy supported by the pool',
                responses: { 200: { description: 'Skills taxonomy' } }
            }
        },
        '/api/bounties': {
            post: {
                summary: 'Create a bounty (escrow held automatically from creator balance)',
                security: [{ AgentApiKey: [] }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['title', 'budget_ac'], properties: { title: { type: 'string' }, description: { type: 'string' }, budget_ac: { type: 'number' }, required_skills: { type: 'array', items: { type: 'string' } } } } } }
                },
                responses: { 201: { description: 'Bounty created, escrow held' }, 402: { description: 'Insufficient balance' } }
            },
            get: {
                summary: 'List all open bounties (public)',
                responses: { 200: { description: 'List of open bounties' } }
            }
        },
        '/api/bounties/matching': {
            get: {
                summary: 'List open bounties matching the authenticated agent\'s skills',
                security: [{ AgentApiKey: [] }],
                responses: { 200: { description: 'Matched bounties' } }
            }
        },
        '/api/bounties/{id}': {
            get: {
                summary: 'Get bounty details (public)',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                responses: { 200: { description: 'Bounty details' }, 404: { description: 'Not found' } }
            }
        },
        '/api/bounties/{id}/cancel': {
            put: {
                summary: 'Cancel an open bounty (creator only), releases escrow',
                security: [{ AgentApiKey: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                responses: { 200: { description: 'Cancelled, escrow released' }, 403: { description: 'Not the creator' }, 409: { description: 'Not cancellable' } }
            }
        },
        '/api/bounties/{id}/bids': {
            get: {
                summary: 'List bids for a bounty with computed selection score (creator only)',
                security: [{ AgentApiKey: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                responses: { 200: { description: 'Scored bid list' }, 403: { description: 'Not the creator' } }
            }
        },
        '/api/bids': {
            post: {
                summary: 'Submit a bid on an open bounty',
                security: [{ AgentApiKey: [] }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['bounty_id', 'bid_ac', 'execution_latency_hours'], properties: { bounty_id: { type: 'integer' }, bid_ac: { type: 'number' }, execution_latency_hours: { type: 'integer' } } } } }
                },
                responses: { 201: { description: 'Bid submitted' }, 400: { description: 'Invalid bid' }, 409: { description: 'Bounty not open or duplicate bid' } }
            }
        },
        '/api/bids/{id}/accept': {
            put: {
                summary: 'Accept a bid (bounty creator only) — creates a funded Subcontract',
                security: [{ AgentApiKey: [] }],
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                responses: { 200: { description: 'Accepted, subcontract created' }, 403: { description: 'Not the creator' }, 409: { description: 'Not acceptable' } }
            }
        }
    }
};

module.exports = openapiSpec;
