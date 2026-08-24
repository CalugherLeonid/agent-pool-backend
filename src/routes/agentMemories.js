const express = require('express');
const router = express.Router();
const { AgentMemory, Subcontract } = require('../models');
const { authenticateAgent } = require('../middleware/auth');

// ============================================
// POST /api/agent-memories – Agentul își înregistrează o experiență/lecție
// validated pornește ÎNTOTDEAUNA false — nu se auto-validează nimic la
// creare. Devine true automat, doar dacă subcontract_id ajunge la 'confirmed'
// (vezi routes/subcontracts.js, handler-ul de /confirm și /resolve).
// ============================================
router.post('/', authenticateAgent, async (req, res) => {
    try {
        const { experience, subcontract_id, lesson } = req.body;

        if (!experience || typeof experience !== 'string') {
            return res.status(400).json({ error: 'experience is required' });
        }

        let subcontract = null;
        if (subcontract_id !== undefined && subcontract_id !== null) {
            subcontract = await Subcontract.findByPk(subcontract_id);
            if (!subcontract) {
                return res.status(404).json({ error: 'subcontract_id does not exist' });
            }
            // Agentul trebuie să fi fost parte reală a acelui subcontract —
            // altfel oricine ar putea atașa lecții false la tranzacții străine.
            if (subcontract.buyer_agent_id !== req.agent.id && subcontract.seller_agent_id !== req.agent.id) {
                return res.status(403).json({ error: 'You were not a participant in this subcontract' });
            }
        }

        // Dacă subcontractul e DEJA confirmat la momentul creării memoriei
        // (agentul scrie lecția după ce a primit plata, nu înainte), se
        // validează direct — altfel ar rămâne fals blocată la 'false' pentru
        // totdeauna, pentru că validarea automată rulează doar în handler-ul
        // de /confirm, la momentul tranziției, nu retroactiv.
        const alreadyConfirmed = subcontract && subcontract.status === 'confirmed';

        const memory = await AgentMemory.create({
            agent_id: req.agent.id,
            subcontract_id: subcontract_id || null,
            experience,
            lesson: lesson || null,
            validated: alreadyConfirmed
        });

        res.status(201).json(memory);
    } catch (err) {
        console.error('Create agent memory error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/agent-memories – Memoriile proprii, filtrabile ?validated=true/false
router.get('/', authenticateAgent, async (req, res) => {
    try {
        const where = { agent_id: req.agent.id };
        if (req.query.validated === 'true') where.validated = true;
        if (req.query.validated === 'false') where.validated = false;

        const memories = await AgentMemory.findAll({
            where,
            order: [['createdAt', 'DESC']]
        });
        res.json(memories);
    } catch (err) {
        console.error('List agent memories error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/agent-memories/:id – Detaliu, doar propriile memorii
router.get('/:id', authenticateAgent, async (req, res) => {
    try {
        const memory = await AgentMemory.findOne({
            where: { id: req.params.id, agent_id: req.agent.id }
        });
        if (!memory) {
            return res.status(404).json({ error: 'Memory not found' });
        }
        res.json(memory);
    } catch (err) {
        console.error('Get agent memory error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
