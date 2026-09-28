const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Bounty, Agent, Transaction, Bid, sequelize } = require('../models');
const { authenticateAgent } = require('../middleware/auth');
const { isValidSkill, SKILLS_TAXONOMY } = require('../utils/skillsTaxonomy');
const { computeScore } = require('../utils/bidScore');

// ============================================
// POST /api/bounties – Creează un bounty (DOAR agent, via x-api-key)
// Escrow AUTOMAT la creare: budget_ac se blochează din balance_ac al
// creatorului imediat, într-o singură tranzacție atomică cu row-lock —
// consistent cu modelul kill_switch/daily_budget_ac: omul pune limite
// dinainte, agentul acționează liber în interior, fără aprobare per-pas.
// ============================================
router.post('/', authenticateAgent, async (req, res) => {
    const { title, description, budget_ac, required_skills } = req.body;

    if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'title is required' });
    }
    if (!budget_ac || budget_ac <= 0) {
        return res.status(400).json({ error: 'budget_ac must be a positive number' });
    }

    let skills = [];
    if (required_skills !== undefined) {
        if (!Array.isArray(required_skills)) {
            return res.status(400).json({ error: 'required_skills must be an array of strings' });
        }
        const invalid = required_skills.filter(s => !isValidSkill(s));
        if (invalid.length > 0) {
            return res.status(400).json({
                error: 'One or more required_skills are not part of the taxonomy',
                invalid_skills: invalid,
                allowed_skills: SKILLS_TAXONOMY
            });
        }
        skills = [...new Set(required_skills)];
    }

    const t = await sequelize.transaction();
    try {
        const agent = await Agent.findByPk(req.agent.id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!agent) {
            await t.rollback();
            return res.status(404).json({ error: 'Agent not found' });
        }
        if (agent.kill_switch) {
            await t.rollback();
            return res.status(403).json({ error: 'Kill-switch is active. Agent is paused.' });
        }
        if (!agent.is_active) {
            await t.rollback();
            return res.status(403).json({ error: 'Agent is inactive' });
        }

        const balance = parseFloat(agent.balance_ac);
        if (balance < budget_ac) {
            await t.rollback();
            return res.status(402).json({
                error: 'Insufficient balance to fund this bounty',
                balance: balance,
                requested: budget_ac
            });
        }

        // Blocare escrow — se scade imediat, nu doar se promite
        agent.balance_ac = balance - budget_ac;
        await agent.save({ transaction: t });

        const bounty = await Bounty.create({
            creator_agent_id: agent.id,
            title,
            description: description || null,
            budget_ac,
            required_skills: skills,
            status: 'open'
        }, { transaction: t });

        await Transaction.create({
            agent_id: agent.id,
            type: 'escrow_hold',
            amount_ac: -budget_ac,
            fee_ac: 0,
            description: `Escrow hold for bounty #${bounty.id}: ${title}`,
            metadata: { bounty_id: bounty.id }
        }, { transaction: t });

        await t.commit();

        res.status(201).json({
            id: bounty.id,
            title: bounty.title,
            description: bounty.description,
            budget_ac: bounty.budget_ac,
            required_skills: bounty.required_skills,
            status: bounty.status,
            creator_agent_id: bounty.creator_agent_id,
            new_balance: agent.balance_ac
        });
    } catch (err) {
        await t.rollback();
        console.error('Create bounty error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// GET /api/bounties – Listă publică de bounty-uri deschise (fără auth)
// Parte din efectul de "magnet": un agent extern poate vedea ce muncă
// e disponibilă înainte să decidă dacă se alătură pool-ului.
// ============================================
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = parseInt(req.query.offset) || 0;

        const { count, rows } = await Bounty.findAndCountAll({
            where: { status: 'open' },
            attributes: ['id', 'title', 'description', 'budget_ac', 'required_skills', 'status', 'createdAt'],
            order: [['createdAt', 'DESC']],
            limit,
            offset
        });
        res.json({ total: count, limit, offset, bounties: rows });
    } catch (err) {
        console.error('List bounties error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// GET /api/bounties/matching – Bounty-uri potrivite skill-urilor
// agentului autenticat (matching AUTOMAT, nu doar informativ — esențial
// pentru "agenți descoperă oportunități singuri", din viziunea playbook-ului).
// IMPORTANT: definită înainte de /:id, altfel Express ar trata "matching"
// ca fiind o valoare de id.
// ============================================
router.get('/matching', authenticateAgent, async (req, res) => {
    try {
        const agentSkills = req.agent.skills || [];

        if (agentSkills.length === 0) {
            return res.json({
                message: 'Agent has no skills set. Use PATCH /api/agents/:id/skills to enable matching.',
                bounties: []
            });
        }

        const bounties = await Bounty.findAll({
            where: {
                status: 'open',
                creator_agent_id: { [Op.ne]: req.agent.id }, // nu-ți propune propriile bounty-uri
                required_skills: { [Op.overlap]: agentSkills }
            },
            attributes: ['id', 'title', 'description', 'budget_ac', 'required_skills', 'status', 'createdAt'],
            order: [['createdAt', 'DESC']]
        });

        res.json({ matched_on_skills: agentSkills, bounties });
    } catch (err) {
        console.error('Matching bounties error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/bounties/feed.json — machine-readable bounties feed cu cursor pagination
// IMPORTANT: definită înainte de /:id, altfel Express ar trata "feed.json" ca id.
// Agenții autonomi polează acest endpoint pentru oportunități noi.
// ?cursor=0&limit=20&skills=data-analysis,research
router.get('/feed.json', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const cursor = parseInt(req.query.cursor) || 0;
        const skills = req.query.skills ? req.query.skills.split(',').map(s => s.trim()) : null;

        const where = { status: 'open', id: { [Op.gt]: cursor } };
        if (skills && skills.length > 0) {
            where.required_skills = { [Op.overlap]: skills };
        }

        const bounties = await Bounty.findAll({
            where,
            attributes: ['id', 'title', 'description', 'budget_ac', 'required_skills', 'status', 'createdAt'],
            order: [['id', 'ASC']],
            limit
        });

        const nextCursor = bounties.length > 0 ? bounties[bounties.length - 1].id : cursor;
        const baseUrl = process.env.BASE_URL || 'https://agent-pool-backend-production.up.railway.app';

        res.json({
            schema: 'agent-pool-bounties-feed-v1',
            pool: baseUrl,
            generated_at: new Date().toISOString(),
            cursor: nextCursor,
            has_more: bounties.length === limit,
            next_url: `${baseUrl}/api/bounties/feed.json?cursor=${nextCursor}&limit=${limit}`,
            count: bounties.length,
            bounties: bounties.map(b => ({
                id: b.id,
                title: b.title,
                description: b.description,
                budget_ac: parseFloat(b.budget_ac),
                required_skills: b.required_skills,
                status: b.status,
                created_at: b.createdAt,
                bid_url: `${baseUrl}/api/bids`,
                detail_url: `${baseUrl}/api/bounties/${b.id}`
            })),
            how_to_bid: {
                step1: 'GET /api/agents/challenge',
                step2: 'Sign challenge with your Ed25519 private key',
                step3: 'POST /api/agents/external-register',
                step4: 'POST /api/bids with {bounty_id, bid_ac, execution_latency_hours}',
                sdk: 'pip install "agentpool[crypto] @ git+https://github.com/CalugherLeonid/agentpool-sdk.git"'
            }
        });
    } catch (err) {
        console.error('Feed error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/bounties/:id – Detaliu public
router.get('/:id', async (req, res) => {
    try {
        const bounty = await Bounty.findByPk(req.params.id, {
            attributes: ['id', 'title', 'description', 'budget_ac', 'required_skills', 'status', 'creator_agent_id', 'assigned_agent_id', 'createdAt']
        });
        if (!bounty) {
            return res.status(404).json({ error: 'Bounty not found' });
        }
        res.json(bounty);
    } catch (err) {
        console.error('Get bounty error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/bounties/:id/bids – Bid-urile pentru un bounty, cu scor calculat
// (Pilon 1), vizibile DOAR creatorului — un agent nu vede prețurile
// concurenților, doar propriul bid.
router.get('/:id/bids', authenticateAgent, async (req, res) => {
    try {
        const bounty = await Bounty.findByPk(req.params.id);
        if (!bounty) {
            return res.status(404).json({ error: 'Bounty not found' });
        }
        if (bounty.creator_agent_id !== req.agent.id) {
            return res.status(403).json({ error: 'Only the bounty creator can view all bids' });
        }

        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = parseInt(req.query.offset) || 0;

        const bids = await Bid.findAll({
            where: { bounty_id: bounty.id, status: 'pending' },
            include: [{ model: Agent, attributes: ['id', 'agent_name', 'reputation_score', 'success_rate', 'win_rate'] }],
            limit,
            offset
        });

        const scored = bids.map(bid => ({
            id: bid.id,
            agent_id: bid.agent_id,
            agent_name: bid.Agent.agent_name,
            bid_ac: bid.bid_ac,
            execution_latency_hours: bid.execution_latency_hours,
            reputation_score: bid.Agent.reputation_score,
            success_rate: bid.Agent.success_rate,
            score: computeScore({
                reputation_score: bid.Agent.reputation_score,
                success_rate: bid.Agent.success_rate,
                bid_ac: bid.bid_ac,
                budget_ac: bounty.budget_ac,
                execution_latency_hours: bid.execution_latency_hours
            })
        })).sort((a, b) => b.score - a.score); // scor mare = recomandat primul

        res.json({ bounty_id: bounty.id, budget_ac: bounty.budget_ac, bids: scored });
    } catch (err) {
        console.error('List bids error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// PUT /api/bounties/:id/cancel – Anulează un bounty încă deschis,
// eliberează escrow-ul înapoi în balance_ac al creatorului.
// Doar creatorul (același agent, verificat prin x-api-key) poate anula.
// ============================================
router.put('/:id/cancel', authenticateAgent, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const bounty = await Bounty.findByPk(req.params.id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!bounty) {
            await t.rollback();
            return res.status(404).json({ error: 'Bounty not found' });
        }
        if (bounty.creator_agent_id !== req.agent.id) {
            await t.rollback();
            return res.status(403).json({ error: 'Only the creator agent can cancel this bounty' });
        }
        if (bounty.status !== 'open') {
            await t.rollback();
            return res.status(409).json({ error: `Cannot cancel a bounty with status '${bounty.status}'` });
        }

        const agent = await Agent.findByPk(bounty.creator_agent_id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        agent.balance_ac = parseFloat(agent.balance_ac) + parseFloat(bounty.budget_ac);
        await agent.save({ transaction: t });

        bounty.status = 'cancelled';
        await bounty.save({ transaction: t });

        await Transaction.create({
            agent_id: agent.id,
            type: 'escrow_release',
            amount_ac: bounty.budget_ac,
            fee_ac: 0,
            description: `Escrow release (cancelled) for bounty #${bounty.id}`,
            metadata: { bounty_id: bounty.id }
        }, { transaction: t });

        await t.commit();

        res.json({
            message: 'Bounty cancelled, escrow released',
            bounty_id: bounty.id,
            refunded: bounty.budget_ac,
            new_balance: agent.balance_ac
        });
    } catch (err) {
        await t.rollback();
        console.error('Cancel bounty error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
