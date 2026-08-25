// Faza restante: Reputație Portabilă
//
// Ed25519 — ales în locul RSA/ECDSA pentru că:
// - Chei mici (32 bytes privat, 32 bytes public) — ușor de stocat în .env
// - Semnături mici (64 bytes) — JSON compact, portabil în orice header/body
// - Nativ în Node.js crypto (fără librării externe)
// - Verificare rapidă — relevant când un agent extern verifică mii de
//   pașapoarte pe secundă în decizii automate
//
// Cheia privată rămâne STRICT în memorie / .env, NICIODATĂ în DB sau logs.
// Cheia publică e servită public la /api/discovery/public-key — oricine
// poate verifica independent un pașaport, fără să contacteze serverul tău.

const crypto = require('crypto');

let privateKey;
let publicKey;
let publicKeyPem; // formatul PEM, servit public

function initKeys() {
    const envPrivKey = process.env.AGENT_POOL_PRIVATE_KEY;

    if (envPrivKey) {
        try {
            // Refolosim cheia din .env (producție) — pașapoartele rămân
            // valide după restart, pentru că cheia nu se schimbă.
            privateKey = crypto.createPrivateKey({
                key: Buffer.from(envPrivKey, 'base64'),
                format: 'der',
                type: 'pkcs8'
            });
            publicKey = crypto.createPublicKey(privateKey);
            publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
            console.log('🔑 Agent Pool signing key loaded from .env');
        } catch (err) {
            console.error('❌ Invalid AGENT_POOL_PRIVATE_KEY in .env:', err.message);
            process.exit(1);
        }
    } else {
        // Generăm la runtime (development) — pașapoartele emise devin
        // invalide la restart, dar e acceptabil pentru dev/test.
        const { privateKey: pk, publicKey: pubk } = crypto.generateKeyPairSync('ed25519');
        privateKey = pk;
        publicKey = pubk;
        publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });

        // Afișăm cheia privată DOAR la primul start, ca să o poți copia
        // în .env pentru persistență. Nu o logăm ulterior.
        const privKeyB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
        console.log('🔑 Generated new Ed25519 signing key (development)');
        console.log('⚠️  To persist across restarts, add to .env:');
        console.log(`   AGENT_POOL_PRIVATE_KEY=${privKeyB64}`);
    }
}

function signPassport(payload) {
    const data = JSON.stringify(payload);
    const signature = crypto.sign(null, Buffer.from(data), privateKey);
    return {
        payload,
        signature: signature.toString('base64'),
        public_key_url: '/api/discovery/public-key'
    };
}

function getPublicKeyPem() {
    return publicKeyPem;
}

module.exports = { initKeys, signPassport, getPublicKeyPem };
