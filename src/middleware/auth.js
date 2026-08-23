// backend/src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { Agent, Owner } = require('../models');
const { hashApiKey } = require('../utils/apiKey');

/**
 * Middleware pentru autentificarea agenților prin API Key.
 * Header: x-api-key
 *
 * (Faza 1.5 / 2.5.1): cheia primită NU se mai compară în clar cu DB.
 * Se hash-uiește (SHA-256 + pepper, determinist) și se caută după api_key_hash,
 * care e singura valoare stocată pentru agenți noi/rotiți.
 */
async function authenticateAgent(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required (x-api-key header)' });
    }

    const apiKeyHash = hashApiKey(apiKey);

    const agent = await Agent.findOne({
        where: { api_key_hash: apiKeyHash, is_active: true }
    });

    if (!agent) {
        return res.status(401).json({ error: 'Invalid or inactive API key' });
    }

    // Verifică kill-switch
    if (agent.kill_switch) {
        return res.status(403).json({ error: 'Agent is paused by owner (kill switch active)' });
    }

    req.agent = agent;
    next();
}

/**
 * Middleware pentru autentificarea ownerilor umani prin JWT.
 * Header: Authorization: Bearer <token>
 */
async function authenticateOwner(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Bearer token required' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const owner = await Owner.findByPk(decoded.id);
        if (!owner) {
            return res.status(401).json({ error: 'Invalid token - owner not found' });
        }
        req.owner = owner;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

/**
 * Middleware opțional pentru autentificare mixtă:
 * - Dacă există x-api-key, autentifică agent
 * - Dacă există Bearer token, autentifică owner
 * - Dacă niciunul, returnează eroare
 */
async function authenticateEither(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const authHeader = req.headers.authorization;

    if (apiKey) {
        return authenticateAgent(req, res, next);
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authenticateOwner(req, res, next);
    }

    return res.status(401).json({ error: 'Authentication required (x-api-key or Bearer token)' });
}

module.exports = {
    authenticateAgent,
    authenticateOwner,
    authenticateEither
};