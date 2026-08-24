const express = require('express');
const router = express.Router();
const { SharedKnowledge, AgentMemory, sequelize } = require('../models');
const { authenticateAgent } = require('../middleware/auth');

// Numărul minim de agenți DISTINCȚI care trebuie să valideze independent
// aceeași lecție ca ea să devină cunoaștere confirmată a pool-ului
// (Level 3) — nu doar experiența unui singur agent.
const CONFIRMED_THRESHOLD = 3;

// ============================================
// POST /api/shared-knowledge – Contribuie cu o lecție la cunoașterea comună
// Lecția trebuie să vină dintr-o AgentMemory PROPRIE și DEJA validată —
// cunoașterea colectivă se construiește doar din experiențe dovedite real
// (subcontract confirmat), nu din afirmații arbitrare.
// ============================================
router.post('/', authenticateAgent, async (req, res) => {
    const { agent_memory_id } = req.body;

    if (!agent_memory_id) {
        return res.status(400).json({ error: 'agent_memory_id is required' });
    }

    const t = await sequelize.transaction();
    try {
        const memory = await AgentMemory.findOne({
            where: { id: agent_memory_id, agent_id: req.agent.id },
            transaction: t
        });

        if (!memory) {
            await t.rollback();
            return res.status(404).json({ error: 'agent_memory_id not found or not yours' });
        }
        if (!memory.validated) {
            await t.rollback();
            return res.status(403).json({ error: 'Only validated memories (real confirmed outcomes) can be contributed' });
        }
        if (!memory.lesson) {
            await t.rollback();
            return res.status(400).json({ error: 'This memory has no lesson text to contribute' });
        }

        const lessonNormalized = memory.lesson.trim();

        // Potrivire exactă (case-insensitive) — fără NLP/similaritate semantică,
        // păstrăm simplu pentru MVP. Lecții formulate diferit dar echivalente
        // ca sens rămân entități separate deocamdată.
        let entry = await SharedKnowledge.findOne({
            where: sequelize.where(
                sequelize.fn('LOWER', sequelize.col('lesson')),
                lessonNormalized.toLowerCase()
            ),
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!entry) {
            entry = await SharedKnowledge.create({
                lesson: lessonNormalized,
                validation_count: 1,
                contributor_agent_ids: [req.agent.id],
                confirmed: false
            }, { transaction: t });
        } else {
            if (entry.contributor_agent_ids.includes(req.agent.id)) {
                await t.rollback();
                return res.status(409).json({ error: 'You already contributed to this lesson', shared_knowledge_id: entry.id });
            }
            entry.contributor_agent_ids = [...entry.contributor_agent_ids, req.agent.id];
            entry.validation_count = entry.contributor_agent_ids.length;
            entry.confirmed = entry.validation_count >= CONFIRMED_THRESHOLD;
            await entry.save({ transaction: t });
        }

        await t.commit();

        res.status(201).json({
            id: entry.id,
            lesson: entry.lesson,
            validation_count: entry.validation_count,
            confirmed: entry.confirmed,
            distinct_contributors: entry.contributor_agent_ids.length
        });
    } catch (err) {
        await t.rollback();
        console.error('Contribute shared knowledge error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// GET /api/shared-knowledge – Cunoașterea colectivă a pool-ului (PUBLIC)
// "Creierul colectiv" — un agent extern poate vedea, înainte să se alăture,
// ce lecții empirice au fost deja validate de comunitate. Optional:
// ?confirmed=true pentru doar cele cu prag atins.
// ============================================
router.get('/', async (req, res) => {
    try {
        const where = {};
        if (req.query.confirmed === 'true') where.confirmed = true;

        const knowledge = await SharedKnowledge.findAll({
            where,
            attributes: ['id', 'lesson', 'validation_count', 'confirmed', 'createdAt'],
            order: [['validation_count', 'DESC']]
        });
        res.json(knowledge);
    } catch (err) {
        console.error('List shared knowledge error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/shared-knowledge/:id – Detaliu (PUBLIC)
router.get('/:id', async (req, res) => {
    try {
        const entry = await SharedKnowledge.findByPk(req.params.id, {
            attributes: ['id', 'lesson', 'validation_count', 'confirmed', 'createdAt']
        });
        if (!entry) {
            return res.status(404).json({ error: 'Not found' });
        }
        res.json(entry);
    } catch (err) {
        console.error('Get shared knowledge error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
