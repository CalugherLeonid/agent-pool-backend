const express = require('express');
const router = express.Router();
const { Agent, Owner, Subcontract, AgentChallenge, sequelize } = require('../models');
const { Op } = require('sequelize');
const { authenticateOwner, authenticateAgent } = require('../middleware/auth');
const { generateApiKey, hashApiKey } = require('../utils/apiKey');
const { SKILLS_TAXONOMY, isValidSkill } = require('../utils/skillsTaxonomy');
const { signPassport } = require('../utils/passport');
const crypto = require('crypto');

// ============================================
// BRING YOUR AGENT — Handshake Ed25519
// ============================================

// GET /api/agents/challenge — emite un nonce one-time, expiră în 5 minute.
router.get('/challenge', async (req, res) => {
    try {
        const nonce = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await AgentChallenge.create({ nonce, expires_at: expiresAt });
        res.json({ challenge: nonce, expires_in: 300 });
    } catch (err) {
        console.error('Challenge error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/agents/external-register — verifică semnătura Ed25519, creează/re-autentifică agentul extern.
router.post('/external-register', async (req, res) => {
    const { public_key, signed_challenge, agent_name } = req.body;

    if (!public_key || !signed_challenge) {
        return res.status(400).json({ error: 'public_key and signed_challenge are required' });
    }
    if (!/^[0-9a-f]{64}$/.test(public_key)) {
        return res.status(400).json({ error: 'public_key must be a 64-char hex Ed25519 public key' });
    }

    const t = await sequelize.transaction();
    try {
        const challenge = await AgentChallenge.findOne({
            where: { used_at: null, expires_at: { [Op.gt]: new Date() } },
            order: [['createdAt', 'DESC']],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!challenge) {
            await t.rollback();
            return res.status(401).json({ error: 'No valid challenge found. Request a new one via GET /api/agents/challenge' });
        }

        // Verifică semnătura Ed25519 — public key raw (32 bytes) în format hex
        let signatureValid = false;
        try {
            const pubKeyDer = Buffer.concat([
                Buffer.from('302a300506032b6570032100', 'hex'), // ASN.1 prefix Ed25519 SPKI
                Buffer.from(public_key, 'hex')
            ]);
            const pubKeyObj = crypto.createPublicKey({ key: pubKeyDer, format: 'der', type: 'spki' });
            signatureValid = crypto.verify(
                null,
                Buffer.from(challenge.nonce),
                pubKeyObj,
                Buffer.from(signed_challenge, 'base64')
            );
        } catch (e) {
            signatureValid = false;
        }

        if (!signatureValid) {
            await t.rollback();
            return res.status(401).json({ error: 'Invalid signature' });
        }

        // Marchează challenge-ul ca folosit — previne replay attacks
        challenge.used_at = new Date();
        await challenge.save({ transaction: t });

        // Agent existent? → re-autentificare cu cheie nouă
        let agent = await Agent.findOne({ where: { external_public_key: public_key }, transaction: t });

        if (!agent) {
            const plainApiKey = generateApiKey();
            agent = await Agent.create({
                owner_id: 1, // owner sistem — de rafinat în producție
                agent_name: agent_name || `external_${public_key.slice(0, 8)}`,
                api_key_hash: hashApiKey(plainApiKey),
                external_public_key: public_key,
                balance_ac: 0,
                daily_budget_ac: 50,
                is_active: true,
                kill_switch: false,
                reputation_score: 0,
                win_rate: 0,
                success_rate: 0,
                skills: []
            }, { transaction: t });

            await t.commit();

            return res.status(201).json({
                pool_id: agent.id,
                agent_name: agent.agent_name,
                api_key: plainApiKey, // ⚠️ singura dată în clar
                is_new: true,
                message: 'External agent registered. Save api_key — it will not be shown again.'
            });
        }

        // Re-autentificare — rotește cheia
        const plainApiKey = generateApiKey();
        agent.api_key_hash = hashApiKey(plainApiKey);
        await agent.save({ transaction: t });
        await t.commit();

        res.json({
            pool_id: agent.id,
            agent_name: agent.agent_name,
            api_key: plainApiKey,
            is_new: false,
            message: 'External agent re-authenticated. New api_key issued.'
        });
    } catch (err) {
        await t.rollback();
        console.error('External register error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// RUTE PROTEJATE PENTRU AGENT (API KEY)
// ============================================

// IMPORTANT: rutele cu nume fix (/balance, /challenge) trebuie definite
// ÎNAINTE de rutele cu parametri (/:id) — altfel Express le prinde ca /:id.

// GET /api/agents/balance – Soldul agentului
router.get('/balance', authenticateAgent, async (req, res) => {
    try {
        const agent = req.agent;
        res.json({
            agent_id: agent.id,
            agent_name: agent.agent_name,
            balance_ac: agent.balance_ac,
            daily_budget_ac: agent.daily_budget_ac,
            daily_spent: 0,
            is_active: agent.is_active,
            kill_switch: agent.kill_switch,
            reputation_score: agent.reputation_score
        });
    } catch (err) {
        console.error('Balance error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// RUTE PROTEJATE PENTRU OWNER (JWT) — cu /:id
// ============================================

// POST /api/agents – Creează un agent nou
router.post('/', authenticateOwner, async (req, res) => {
    try {
        const { agent_name, daily_budget_ac } = req.body;
        const ownerId = req.owner.id;

        if (!agent_name) {
            return res.status(400).json({ error: 'agent_name is required' });
        }

        // Faza 1.5 / 2.5.1: generăm cheia în clar doar pentru acest răspuns.
        // În DB se scrie DOAR hash-ul (api_key_hash). Coloana veche api_key
        // rămâne null pentru agenți noi (deprecată, ștearsă într-o migrare ulterioară).
        const plainApiKey = generateApiKey();
        const apiKeyHash = hashApiKey(plainApiKey);

        const agent = await Agent.create({
            owner_id: ownerId,
            agent_name,
            api_key_hash: apiKeyHash,
            daily_budget_ac: daily_budget_ac || 50,
            balance_ac: 0,
            is_active: true,
            kill_switch: false,
            reputation_score: 50,
            win_rate: 0,
            success_rate: 0
        });

        res.status(201).json({
            id: agent.id,
            agent_name: agent.agent_name,
            api_key: plainApiKey, // ⚠️ singura dată când cheia e vizibilă în clar — salvează-o acum
            balance_ac: agent.balance_ac,
            daily_budget_ac: agent.daily_budget_ac,
            is_active: agent.is_active,
            kill_switch: agent.kill_switch,
            reputation_score: agent.reputation_score
        });
    } catch (err) {
        console.error('Create agent error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/agents – Lista agenților ownerului
router.get('/', authenticateOwner, async (req, res) => {
    try {
        // Faza 1.5 / 2.5.1: api_key/api_key_hash NU se expun niciodată în GET normal.
        const agents = await Agent.findAll({
            where: { owner_id: req.owner.id },
            attributes: ['id', 'agent_name', 'balance_ac', 'daily_budget_ac', 'is_active', 'kill_switch', 'reputation_score', 'win_rate', 'success_rate', 'skills']
        });
        res.json(agents);
    } catch (err) {
        console.error('List agents error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/agents/:id – Detaliu agent specific (Prioritate 2 — menționat în playbook v4.0)
router.get('/:id', authenticateOwner, async (req, res) => {
    try {
        const agent = await Agent.findOne({
            where: { id: req.params.id, owner_id: req.owner.id },
            attributes: ['id', 'agent_name', 'balance_ac', 'daily_budget_ac', 'is_active', 'kill_switch', 'reputation_score', 'win_rate', 'success_rate', 'skills', 'createdAt']
        });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found or not owned by you' });
        }
        res.json(agent);
    } catch (err) {
        console.error('Get agent error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/agents/:id – Actualizare agent_name și/sau daily_budget_ac (Prioritate 2)
// NU permite modificarea reputation_score, win_rate, success_rate, balance_ac.
router.patch('/:id', authenticateOwner, async (req, res) => {
    try {
        const { agent_name, daily_budget_ac } = req.body;

        if (!agent_name && daily_budget_ac === undefined) {
            return res.status(400).json({ error: 'Provide at least one of: agent_name, daily_budget_ac' });
        }
        if (daily_budget_ac !== undefined && daily_budget_ac <= 0) {
            return res.status(400).json({ error: 'daily_budget_ac must be a positive number' });
        }

        const agent = await Agent.findOne({
            where: { id: req.params.id, owner_id: req.owner.id }
        });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found or not owned by you' });
        }

        if (agent_name) agent.agent_name = agent_name;
        if (daily_budget_ac !== undefined) agent.daily_budget_ac = daily_budget_ac;
        await agent.save();

        res.json({
            id: agent.id,
            agent_name: agent.agent_name,
            daily_budget_ac: agent.daily_budget_ac
        });
    } catch (err) {
        console.error('Update agent error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/agents/:id/kill – Activează kill-switch
router.put('/:id/kill', authenticateOwner, async (req, res) => {
    try {
        const agent = await Agent.findOne({
            where: { id: req.params.id, owner_id: req.owner.id }
        });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found or not owned by you' });
        }
        agent.kill_switch = true;
        agent.is_active = false;
        await agent.save();
        res.json({ message: 'Kill-switch activated', agent_id: agent.id });
    } catch (err) {
        console.error('Kill-switch error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/agents/:id/activate – Reactivează agentul
router.put('/:id/activate', authenticateOwner, async (req, res) => {
    try {
        const agent = await Agent.findOne({
            where: { id: req.params.id, owner_id: req.owner.id }
        });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found or not owned by you' });
        }
        agent.kill_switch = false;
        agent.is_active = true;
        await agent.save();
        res.json({ message: 'Agent activated', agent_id: agent.id });
    } catch (err) {
        console.error('Activate agent error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/agents/:id/skills – Setează skill-urile agentului (2.5.3)
// Doar valori din taxonomia controlată (utils/skillsTaxonomy.js) sunt acceptate.
router.patch('/:id/skills', authenticateOwner, async (req, res) => {
    try {
        const { skills } = req.body;

        if (!Array.isArray(skills)) {
            return res.status(400).json({ error: 'skills must be an array of strings' });
        }

        const invalid = skills.filter(s => !isValidSkill(s));
        if (invalid.length > 0) {
            return res.status(400).json({
                error: 'One or more skills are not part of the taxonomy',
                invalid_skills: invalid,
                allowed_skills: SKILLS_TAXONOMY
            });
        }

        const agent = await Agent.findOne({
            where: { id: req.params.id, owner_id: req.owner.id }
        });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found or not owned by you' });
        }

        // elimină duplicate, păstrează ordinea din taxonomie
        agent.skills = [...new Set(skills)];
        await agent.save();

        res.json({ agent_id: agent.id, skills: agent.skills });
    } catch (err) {
        console.error('Update skills error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/agents/:id/rotate-key – Regenerează cheia API (2.5.1)
// Cheia veche devine invalidă imediat. Noua cheie e vizibilă o singură dată, în acest răspuns.
router.post('/:id/rotate-key', authenticateOwner, async (req, res) => {
    try {
        const agent = await Agent.findOne({
            where: { id: req.params.id, owner_id: req.owner.id }
        });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found or not owned by you' });
        }

        const plainApiKey = generateApiKey();
        agent.api_key_hash = hashApiKey(plainApiKey);
        agent.api_key = null; // curăță și eventuala cheie veche în clar, dacă exista
        await agent.save();

        res.json({
            message: 'API key rotated. The old key is now invalid.',
            agent_id: agent.id,
            api_key: plainApiKey // ⚠️ singura dată când cheia e vizibilă în clar
        });
    } catch (err) {
        console.error('Rotate key error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/agents/:id/passport – Pașaport digital semnat (reputație portabilă)
// Doar agentul însuși poate cere propriul pașaport (x-api-key).
// Verificarea de către terți: oricine cu cheia publică de la
// /api/discovery/public-key poate verifica independent, fără acces la DB.
// PATCH: Înlocuiește blocul GET /:id/passport existent cu acesta.
// Adaugă verified_tasks cu hash-uri SHA-256 pentru fiecare task confirmat.
// Hash-ul e verificabil independent: SHA-256(subcontract_id:bounty_id:amount_ac:confirmed_at)

router.get('/:id/passport', authenticateAgent, async (req, res) => {
    try {
        if (parseInt(req.params.id) !== req.agent.id) {
            return res.status(403).json({ error: 'You can only request your own passport' });
        }

        const agent = req.agent;

        // Obține subcontractele confirmate pentru verified_tasks
        const confirmedSubs = await Subcontract.findAll({
            where: {
                seller_agent_id: agent.id,
                status: 'confirmed'
            },
            attributes: ['id', 'bounty_id', 'amount_ac', 'updatedAt'],
            order: [['updatedAt', 'DESC']],
            limit: 20
        });

        // Hash pentru fiecare task confirmat — dovadă criptografică tamper-evident
        // Format: SHA-256(subcontract_id:bounty_id:amount_ac:confirmed_at_ISO)
        // Oricine poate recalcula hash-ul cu datele publice ale subcontractului
        const verified_tasks = confirmedSubs.map(sub => {
            const taskData = `${sub.id}:${sub.bounty_id}:${sub.amount_ac}:${sub.updatedAt.toISOString()}`;
            const hash = crypto.createHash('sha256').update(taskData).digest('hex');
            return {
                subcontract_id: sub.id,
                bounty_id: sub.bounty_id,
                amount_ac: parseFloat(sub.amount_ac),
                confirmed_at: sub.updatedAt.toISOString(),
                hash: hash
            };
        });

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const issuedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

        const payload = {
            agent_pool: baseUrl,
            agent_id: agent.id,
            agent_name: agent.agent_name,
            skills: agent.skills || [],
            metrics: {
                reputation_score: parseFloat(agent.reputation_score),
                success_rate: parseFloat(agent.success_rate),
                win_rate: parseFloat(agent.win_rate),
                confirmed_deliveries: confirmedSubs.length
            },
            verified_tasks: verified_tasks,
            issued_at: issuedAt,
            expires_at: expiresAt
        };

        const passport = signPassport(payload);
        res.json(passport);

    } catch (err) {
        console.error('Passport error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ============================================
// RUTE PROTEJATE PENTRU AGENT (API KEY)
// ============================================

// GET /api/agents/balance – Soldul agentului
module.exports = router;