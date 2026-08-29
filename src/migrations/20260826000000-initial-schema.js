'use strict';

/**
 * Migrare inițială — starea zero a schemei Agent Pool.
 *
 * Aceasta capturează schema COMPLETĂ la momentul comiterii.
 * Toate migrările viitoare pornesc de la această bază.
 *
 * Tabele create: Owners, Agents, Bounties, Bids, Transactions,
 *                Subcontracts, AgentMemories, SharedKnowledges, AgentChallenges
 *
 * IMPORTANT pentru producție:
 *   1. Rulează `npx sequelize-cli db:migrate` în loc de sequelize.sync({ alter: true })
 *   2. Scoate sync() din models/index.js (sau pune NODE_ENV === 'production' guard)
 *   3. Fiecare modificare de schemă viitoare → migrare nouă separată
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ── Owners ────────────────────────────────────────────────────────
    await queryInterface.createTable('Owners', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      email: { type: Sequelize.STRING(255), unique: true, allowNull: false },
      password_hash: { type: Sequelize.TEXT, allowNull: false },
      is_human: { type: Sequelize.BOOLEAN, defaultValue: true },
      stripe_customer_id: { type: Sequelize.STRING(255) },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── Agents ────────────────────────────────────────────────────────
    await queryInterface.createTable('Agents', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      owner_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Owners', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      agent_name: { type: Sequelize.STRING(100), allowNull: false },
      api_key: { type: Sequelize.STRING(255), unique: true, allowNull: true },
      api_key_hash: { type: Sequelize.STRING(64), unique: true, allowNull: true },
      balance_ac: { type: Sequelize.DECIMAL(15, 2), defaultValue: 0 },
      daily_budget_ac: { type: Sequelize.DECIMAL(10, 2), defaultValue: 50 },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      kill_switch: { type: Sequelize.BOOLEAN, defaultValue: false },
      reputation_score: { type: Sequelize.DECIMAL(5, 2), defaultValue: 0 },
      win_rate: { type: Sequelize.DECIMAL(5, 2), defaultValue: 0 },
      success_rate: { type: Sequelize.DECIMAL(5, 2), defaultValue: 0 },
      skills: { type: Sequelize.ARRAY(Sequelize.STRING(50)), defaultValue: [] },
      external_public_key: { type: Sequelize.STRING(64), unique: true, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── Bounties ──────────────────────────────────────────────────────
    await queryInterface.createTable('Bounties', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      creator_agent_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Agents', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL'
      },
      client_email: { type: Sequelize.STRING(255), allowNull: true },
      title: { type: Sequelize.TEXT, allowNull: false },
      description: { type: Sequelize.TEXT },
      budget_eur: { type: Sequelize.DECIMAL(10, 2) },
      budget_ac: { type: Sequelize.DECIMAL(15, 2), allowNull: false },
      required_skills: { type: Sequelize.ARRAY(Sequelize.STRING(50)), defaultValue: [] },
      status: { type: Sequelize.STRING(20), defaultValue: 'open' },
      assigned_agent_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Agents', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL'
      },
      draft_url: { type: Sequelize.TEXT },
      human_review_status: { type: Sequelize.STRING(20), defaultValue: 'pending' },
      revision_feedback: { type: Sequelize.TEXT },
      completed_at: { type: Sequelize.DATE },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── Bids ──────────────────────────────────────────────────────────
    await queryInterface.createTable('Bids', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      bounty_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Bounties', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE'
      },
      agent_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agents', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      bid_ac: { type: Sequelize.DECIMAL(15, 2), allowNull: false },
      execution_latency_hours: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.STRING(20), defaultValue: 'pending' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── Transactions ──────────────────────────────────────────────────
    await queryInterface.createTable('Transactions', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      agent_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agents', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      type: { type: Sequelize.STRING(30), allowNull: false },
      amount_ac: { type: Sequelize.DECIMAL(15, 2), allowNull: false },
      fee_ac: { type: Sequelize.DECIMAL(15, 2), defaultValue: 0 },
      description: { type: Sequelize.TEXT },
      metadata: { type: Sequelize.JSONB },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── Subcontracts ──────────────────────────────────────────────────
    await queryInterface.createTable('Subcontracts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      buyer_agent_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agents', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      seller_agent_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agents', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      bounty_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Bounties', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      amount_ac: { type: Sequelize.DECIMAL(15, 2), allowNull: false },
      delivered_at: { type: Sequelize.DATE, allowNull: true },
      status: { type: Sequelize.STRING(20), defaultValue: 'pending' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── AgentMemories ─────────────────────────────────────────────────
    await queryInterface.createTable('AgentMemories', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      agent_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agents', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE'
      },
      subcontract_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Subcontracts', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL'
      },
      experience: { type: Sequelize.TEXT, allowNull: false },
      lesson: { type: Sequelize.TEXT },
      validated: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── SharedKnowledges ──────────────────────────────────────────────
    await queryInterface.createTable('SharedKnowledges', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      lesson: { type: Sequelize.TEXT, allowNull: false },
      validation_count: { type: Sequelize.INTEGER, defaultValue: 1 },
      contributor_agent_ids: { type: Sequelize.ARRAY(Sequelize.INTEGER), defaultValue: [] },
      confirmed: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── AgentChallenges ───────────────────────────────────────────────
    await queryInterface.createTable('AgentChallenges', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      nonce: { type: Sequelize.STRING(64), unique: true, allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      used_at: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // ── Indecși pentru performanță ────────────────────────────────────
    await queryInterface.addIndex('Agents', ['api_key_hash']);
    await queryInterface.addIndex('Agents', ['external_public_key']);
    await queryInterface.addIndex('Agents', ['owner_id']);
    await queryInterface.addIndex('Bounties', ['status']);
    await queryInterface.addIndex('Bounties', ['creator_agent_id']);
    await queryInterface.addIndex('Bids', ['bounty_id', 'status']);
    await queryInterface.addIndex('Subcontracts', ['buyer_agent_id', 'seller_agent_id']);
    await queryInterface.addIndex('Subcontracts', ['status']);
    await queryInterface.addIndex('Transactions', ['agent_id', 'type']);
    await queryInterface.addIndex('AgentChallenges', ['nonce']);
  },

  async down(queryInterface, Sequelize) {
    // Rollback în ordine inversă (FK constraints)
    await queryInterface.dropTable('AgentChallenges');
    await queryInterface.dropTable('SharedKnowledges');
    await queryInterface.dropTable('AgentMemories');
    await queryInterface.dropTable('Subcontracts');
    await queryInterface.dropTable('Transactions');
    await queryInterface.dropTable('Bids');
    await queryInterface.dropTable('Bounties');
    await queryInterface.dropTable('Agents');
    await queryInterface.dropTable('Owners');
  }
};
