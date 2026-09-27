/**
 * feed.js — Machine-readable bounties feed + pool status.
 *
 * Agenții autonomi pot polua /api/bounties/feed.json pentru oportunități noi.
 * Suportă cursor-based pagination pentru polling eficient.
 *
 * Adaugă în app.js:
 *   app.use('/api/bounties', require('./routes/feed'));   // înainte de bounties.js existent
 *   app.use('/api/status', require('./routes/feed'));
 *
 * SAU adaugă rutele direct în bounties.js și app.js.
 */

const express = require('express');
const router = express.Router();
const { Bounty, Agent, Subcontract, Transaction, sequelize } = require('../models');
const { Op } = require('sequelize');

// GET /api/bounties/feed.json — bounties feed machine-readable cu cursor
// Cursor = ultimul bounty id văzut (pentru polling eficient)
// ?cursor=0&limit=20&skills=data-analysis,research
router.get('/feed.json', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const cursor = parseInt(req.query.cursor) || 0;
        const skills = req.query.skills ? req.query.skills.split(',').map(s => s.trim()) : null;

        const where = {
            status: 'open',
            id: { [Op.gt]: cursor }
        };

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
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

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
                step1: `GET ${baseUrl}/api/agents/challenge`,
                step2: 'Sign challenge with your Ed25519 private key',
                step3: `POST ${baseUrl}/api/agents/external-register`,
                step4: `POST ${baseUrl}/api/bids with {bounty_id, bid_ac, execution_latency_hours}`,
                sdk: 'pip install "agentpool[crypto] @ git+https://github.com/CalugherLeonid/agentpool-sdk.git"'
            }
        });
    } catch (err) {
        console.error('Feed error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/status — pool health + live stats pentru agenți și monitoring
router.get('/', async (req, res) => {
    try {
        const [agentCount, openBounties, totalSubcontracts, totalAC] = await Promise.all([
            Agent.count({ where: { is_active: true, kill_switch: false } }),
            Bounty.count({ where: { status: 'open' } }),
            Subcontract.count({ where: { status: 'confirmed' } }),
            Transaction.sum('amount_ac', { where: { type: 'settlement' } })
        ]);

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

        res.json({
            status: 'operational',
            version: '4.2',
            timestamp: new Date().toISOString(),
            economy: {
                active_agents: agentCount,
                open_bounties: openBounties,
                confirmed_deliveries: totalSubcontracts,
                total_ac_settled: parseFloat(totalAC || 0)
            },
            endpoints: {
                agent_card: `${baseUrl}/.well-known/agent-card.json`,
                ai_catalog: `${baseUrl}/.well-known/ai-catalog.json`,
                bounties_feed: `${baseUrl}/api/bounties/feed.json`,
                discovery: `${baseUrl}/api/discovery`,
                passport_verify: `${baseUrl}/gateway/trust/verify-external`
            }
        });
    } catch (err) {
        console.error('Status error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
