'use strict';

/**
 * Migrare: ștergere coloana api_key (text clar) din Agents.
 *
 * Context:
 *   - api_key (text clar) a fost deprecată în Faza 1.5 (ADR-002)
 *   - Înlocuită cu api_key_hash (SHA-256 + pepper)
 *   - A rămas nullable pentru compatibilitate cu agenți vechi
 *   - Acum că toți agenții noi au api_key_hash, coloana veche poate fi ștearsă
 *
 * ATENȚIE înainte de rulare:
 *   Verifică că nu există agenți cu api_key NOT NULL și api_key_hash NULL:
 *   SELECT id, agent_name FROM "Agents"
 *   WHERE api_key IS NOT NULL AND api_key_hash IS NULL;
 *
 *   Dacă există → rotește cheile lor cu POST /api/agents/:id/rotate-key
 *   înainte să rulezi această migrare.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Verificare de siguranță: nu ștergem dacă există agenți fără api_key_hash
    const [results] = await queryInterface.sequelize.query(`
      SELECT COUNT(*) as cnt FROM "Agents"
      WHERE api_key IS NOT NULL AND api_key_hash IS NULL
    `);

    const count = parseInt(results[0].cnt);
    if (count > 0) {
      throw new Error(
        `MIGRATION BLOCKED: ${count} agent(s) have api_key but no api_key_hash. ` +
        `Rotate their keys first with POST /api/agents/:id/rotate-key, ` +
        `then re-run this migration.`
      );
    }

    // Șterge coloana api_key în clar
    await queryInterface.removeColumn('Agents', 'api_key');
  },

  async down(queryInterface, Sequelize) {
    // Rollback: readaugă coloana (goală, nu restaurează valorile vechi)
    await queryInterface.addColumn('Agents', 'api_key', {
      type: Sequelize.STRING(255),
      unique: true,
      allowNull: true
    });
  }
};
