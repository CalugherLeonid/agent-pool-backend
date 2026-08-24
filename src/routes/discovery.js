const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Agent, Bounty, SharedKnowledge } = require('../models');
const { SKILLS_TAXONOMY } = require('../utils/skillsTaxonomy');

// GET /api/discovery – Vitrina publică a pool-ului (Faza 1.5 / 2.5.4)
// FĂRĂ autentificare. Returnează DOAR statistici agregate, niciodată
// date individuale (nume de agenți, solduri, owneri, chei API etc.).
router.get('/', async (req, res) => {
    try {
        const [activeAgents, openBounties, agentsWithSkills, bountiesWithSkills, confirmedKnowledgeCount] = await Promise.all([
            Agent.count({ where: { is_active: true } }),
            Bounty.count({ where: { status: 'open' } }),
            Agent.findAll({
                where: { is_active: true },
                attributes: ['skills']
            }),
            Bounty.findAll({
                where: { status: 'open' },
                attributes: ['required_skills']
            }),
            SharedKnowledge.count({ where: { confirmed: true } })
        ]);

        // Skill-uri disponibile ACUM în pool (oferite de cel puțin un agent activ),
        // nu doar taxonomia completă — util pentru un agent extern care caută
        // "cine poate face X chiar acum".
        const availableSkillsSet = new Set();
        agentsWithSkills.forEach(a => (a.skills || []).forEach(s => availableSkillsSet.add(s)));

        // Skill-uri CERUTE de bounty-urile deschise — arată cererea reală,
        // util pentru un agent extern care decide dacă merită să se alăture.
        const demandedSkillsSet = new Set();
        bountiesWithSkills.forEach(b => (b.required_skills || []).forEach(s => demandedSkillsSet.add(s)));

        res.json({
            pool_name: 'Agent Pool',
            description: 'Autonomous machine-to-machine agent economy',
            active_agents: activeAgents,
            open_bounties: openBounties,
            available_skills: Array.from(availableSkillsSet),
            demanded_skills: Array.from(demandedSkillsSet),
            confirmed_knowledge_count: confirmedKnowledgeCount,
            currency: 'AC',
            join_url: '/api/owners/register',
            agent_card_url: '/.well-known/agent-card.json',
            openapi_url: '/api/openapi.json'
        });
    } catch (err) {
        console.error('Discovery error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/discovery/skills – Taxonomia completă de skill-uri suportate
// (nu doar cele folosite acum) — referențiată din agent-card.json.
router.get('/skills', (req, res) => {
    res.json({ skills_taxonomy: SKILLS_TAXONOMY });
});

module.exports = router;
