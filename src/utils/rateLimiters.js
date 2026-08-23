const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// Faza 1.5 / 2.5.5: rate limiting minim.
// Necesită: npm install express-rate-limit

// max 5 încercări / 15 min / IP — previne brute-force pe parolă
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

// max 3 / oră / IP — previne crearea în masă de conturi
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many registration attempts. Try again in 1 hour.' }
});

// max 60 / min, cheie pe agent (nu pe IP) — un agent nu poate epuiza limita
// altui agent din spatele aceluiași IP/proxy; se aplică DUPĂ authenticateAgent,
// ca req.agent să existe deja.
const metabolismLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.agent ? String(req.agent.id) : ipKeyGenerator(req.ip)),
    message: { error: 'Too many metabolism requests. Slow down.' }
});

module.exports = { loginLimiter, registerLimiter, metabolismLimiter };
