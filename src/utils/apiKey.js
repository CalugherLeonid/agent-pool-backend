const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * Generează o cheie API nouă în format sk_live_<uuid fără cratime>.
 * Aceasta este valoarea în clar, returnată clientului O SINGURĂ DATĂ.
 */
function generateApiKey() {
    return 'sk_live_' + uuidv4().replace(/-/g, '');
}

/**
 * Hash determinist (SHA-256) al cheii API, folosit pentru stocare și lookup.
 *
 * De ce SHA-256 și nu bcrypt aici:
 * - bcrypt introduce salt aleator -> hash diferit la fiecare apel -> imposibil
 *   de căutat direct în DB cu WHERE api_key_hash = ? (ar necesita scanarea
 *   tuturor rândurilor și bcrypt.compare pe fiecare, ceea ce nu scalează).
 * - api_key are deja entropie mare (uuid v4 aleator, 122 biți), spre deosebire
 *   de o parolă aleasă de om -> nu are nevoie de salt/cost factor ca bcrypt.
 * - Un pepper (secret din .env, NU în DB) adaugă un strat suplimentar: chiar
 *   dacă baza de date e compromisă fără server, hash-urile nu pot fi
 *   brute-forțate offline pornind doar de la ele.
 *
 * Acesta este exact modelul folosit de GitHub/Stripe pentru personal access tokens.
 */
function hashApiKey(plainKey) {
    const pepper = process.env.API_KEY_PEPPER || '';
    if (!pepper) {
        console.warn('⚠️  API_KEY_PEPPER nu este setat în .env — hashing-ul folosește doar SHA-256 fără pepper. Setează API_KEY_PEPPER pentru securitate suplimentară.');
    }
    return crypto.createHash('sha256').update(plainKey + pepper).digest('hex');
}

module.exports = { generateApiKey, hashApiKey };
