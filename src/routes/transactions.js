const express = require('express');
const router = express.Router();
const { Transaction } = require('../models');
const { authenticateAgent } = require('../middleware/auth');

// ============================================
// GET /api/transactions – Istoricul propriu al agentului autenticat
// Filtre opționale: ?type=metabolism, paginare: ?limit=50&offset=0
// ============================================
router.get('/', authenticateAgent, async (req, res) => {
    try {
        const { type } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100); // plafon 100
        const offset = parseInt(req.query.offset) || 0;

        const where = { agent_id: req.agent.id };
        if (type) where.type = type;

        const { count, rows } = await Transaction.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            limit,
            offset
        });

        res.json({
            total: count,
            limit,
            offset,
            transactions: rows
        });
    } catch (err) {
        console.error('List transactions error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/transactions/:id – Detaliu, doar dacă aparține agentului autenticat
router.get('/:id', authenticateAgent, async (req, res) => {
    try {
        const transaction = await Transaction.findOne({
            where: { id: req.params.id, agent_id: req.agent.id }
        });
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        res.json(transaction);
    } catch (err) {
        console.error('Get transaction error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
