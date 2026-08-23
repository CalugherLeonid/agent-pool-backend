const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Transaction, Agent, sequelize } = require('../models');
const { authenticateAgent } = require('../middleware/auth');
const { metabolismLimiter } = require('../utils/rateLimiters');

// POST /api/metabolism/consume – Consumă costuri (LLM, compute)
// Faza 1.5 / 2.5.2: întreaga operație rulează într-o singură tranzacție DB,
// cu row-level lock (SELECT ... FOR UPDATE) pe agent, ca să elimine race
// condition-urile când vin două cereri simultane pentru același agent.
router.post('/consume', authenticateAgent, metabolismLimiter, async (req, res) => {
    const { cost_ac, description, metadata } = req.body;

    if (!cost_ac || cost_ac <= 0) {
        return res.status(400).json({ error: 'cost_ac must be a positive number' });
    }

    const t = await sequelize.transaction();

    try {
        // Blocăm rândul agentului pentru durata tranzacției — orice altă cerere
        // concurentă pentru același agent așteaptă până la commit/rollback.
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

        // Verifică bugetul zilnic — calculat ÎN ACEEAȘI tranzacție cu lock-ul,
        // altfel rămâne o fereastră de race condition între citire și scădere.
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // NOTĂ: coloana e `createdAt` (camelCase), generată automat de Sequelize
        // pentru { timestamps: true } fără `underscored: true` — nu `created_at`.
        const dailySpentRaw = await Transaction.sum('amount_ac', {
            where: {
                agent_id: agent.id,
                type: 'metabolism',
                createdAt: { [Op.gte]: today }
            },
            transaction: t
        }) || 0;

        const dailyLimit = parseFloat(agent.daily_budget_ac);
        const spent = Math.abs(dailySpentRaw);

        if (spent + cost_ac > dailyLimit) {
            await t.rollback();
            return res.status(402).json({
                error: 'Daily metabolism budget exceeded',
                daily_spent: spent,
                daily_limit: dailyLimit,
                requested: cost_ac
            });
        }

        const balance = parseFloat(agent.balance_ac);
        if (balance < cost_ac) {
            await t.rollback();
            return res.status(402).json({
                error: 'Insufficient balance',
                balance: balance,
                requested: cost_ac
            });
        }

        agent.balance_ac = balance - cost_ac;
        await agent.save({ transaction: t });

        await Transaction.create({
            agent_id: agent.id,
            type: 'metabolism',
            amount_ac: -cost_ac,
            fee_ac: 0,
            description: description || 'Metabolism consumption',
            metadata: metadata || {}
        }, { transaction: t });

        await t.commit();

        res.json({
            success: true,
            consumed: cost_ac,
            new_balance: agent.balance_ac,
            daily_spent: spent + cost_ac,
            daily_limit: dailyLimit
        });
    } catch (err) {
        await t.rollback();
        console.error('Metabolism consume error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/metabolism/daily-spent – Cheltuiala zilnică a agentului
router.get('/daily-spent', authenticateAgent, async (req, res) => {
    try {
        const agent = req.agent;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailySpent = await Transaction.sum('amount_ac', {
            where: {
                agent_id: agent.id,
                type: 'metabolism',
                createdAt: { [Op.gte]: today }
            }
        }) || 0;

        res.json({
            agent_id: agent.id,
            daily_spent: Math.abs(dailySpent),
            daily_limit: agent.daily_budget_ac,
            remaining: parseFloat(agent.daily_budget_ac) - Math.abs(dailySpent)
        });
    } catch (err) {
        console.error('Daily spent error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;