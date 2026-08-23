const express = require('express');
const router = express.Router();
const { Bid, Bounty, Agent, Transaction, Subcontract, sequelize } = require('../models');
const { authenticateAgent } = require('../middleware/auth');
const { computeScore, EPSILON } = require('../utils/bidScore');

// ============================================
// POST /api/bids – Licitează pe un bounty deschis
// ============================================
router.post('/', authenticateAgent, async (req, res) => {
    try {
        const { bounty_id, bid_ac, execution_latency_hours } = req.body;

        if (!bounty_id) {
            return res.status(400).json({ error: 'bounty_id is required' });
        }
        if (!bid_ac || bid_ac <= 0) {
            return res.status(400).json({ error: 'bid_ac must be a positive number' });
        }
        if (!execution_latency_hours || execution_latency_hours <= 0) {
            return res.status(400).json({ error: 'execution_latency_hours must be a positive number' });
        }

        const bounty = await Bounty.findByPk(bounty_id);
        if (!bounty) {
            return res.status(404).json({ error: 'Bounty not found' });
        }
        if (bounty.status !== 'open') {
            return res.status(409).json({ error: `Bounty is not open for bids (status: ${bounty.status})` });
        }
        if (bounty.creator_agent_id === req.agent.id) {
            return res.status(403).json({ error: 'Cannot bid on your own bounty' });
        }

        const budget = parseFloat(bounty.budget_ac);
        if (bid_ac > budget) {
            return res.status(400).json({ error: 'bid_ac cannot exceed the bounty budget_ac', budget_ac: budget });
        }
        // Prag minim de preț — previne licitații aproape-zero care ar
        // sparge motorul de scor (vezi utils/bidScore.js)
        if (bid_ac / budget < EPSILON) {
            return res.status(400).json({
                error: `bid_ac too low — minimum allowed is ${(EPSILON * 100)}% of budget_ac`,
                minimum_bid_ac: Math.ceil(budget * EPSILON * 100) / 100
            });
        }

        const existing = await Bid.findOne({
            where: { bounty_id, agent_id: req.agent.id, status: 'pending' }
        });
        if (existing) {
            return res.status(409).json({ error: 'You already have a pending bid on this bounty' });
        }

        const bid = await Bid.create({
            bounty_id,
            agent_id: req.agent.id,
            bid_ac,
            execution_latency_hours,
            status: 'pending'
        });

        res.status(201).json({
            id: bid.id,
            bounty_id: bid.bounty_id,
            bid_ac: bid.bid_ac,
            execution_latency_hours: bid.execution_latency_hours,
            status: bid.status
        });
    } catch (err) {
        console.error('Create bid error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// PUT /api/bids/:id/accept – Acceptă un bid câștigător (doar creatorul bounty-ului)
//
// La acceptare:
// 1. Bid-ul acceptat -> status 'accepted', restul bid-urilor -> 'rejected'
// 2. Bounty -> status 'assigned', assigned_agent_id = agentul câștigător
// 3. Se creează Subcontract cu status 'funded' (escrow deja există din
//    momentul creării bounty-ului — aici doar se alocă formal perechii
//    buyer/seller)
// 4. Diferența dintre budget_ac (blocat inițial) și bid_ac (prețul real
//    câștigător) se eliberează înapoi în balance_ac al creatorului —
//    corect pentru creator, nu rămâne blocat inutil peste prețul real.
// ============================================
router.put('/:id/accept', authenticateAgent, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const bid = await Bid.findByPk(req.params.id, { transaction: t });
        if (!bid) {
            await t.rollback();
            return res.status(404).json({ error: 'Bid not found' });
        }

        const bounty = await Bounty.findByPk(bid.bounty_id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!bounty) {
            await t.rollback();
            return res.status(404).json({ error: 'Bounty not found' });
        }
        if (bounty.creator_agent_id !== req.agent.id) {
            await t.rollback();
            return res.status(403).json({ error: 'Only the bounty creator can accept a bid' });
        }
        if (bounty.status !== 'open') {
            await t.rollback();
            return res.status(409).json({ error: `Bounty is not open (status: ${bounty.status})` });
        }
        if (bid.status !== 'pending') {
            await t.rollback();
            return res.status(409).json({ error: `Bid is not pending (status: ${bid.status})` });
        }

        // Eliberează diferența budget_ac - bid_ac înapoi la creator
        const budget = parseFloat(bounty.budget_ac);
        const winningBid = parseFloat(bid.bid_ac);
        const leftover = budget - winningBid;

        if (leftover > 0) {
            const creator = await Agent.findByPk(bounty.creator_agent_id, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            creator.balance_ac = parseFloat(creator.balance_ac) + leftover;
            await creator.save({ transaction: t });

            await Transaction.create({
                agent_id: creator.id,
                type: 'escrow_partial_release',
                amount_ac: leftover,
                fee_ac: 0,
                description: `Partial escrow release for bounty #${bounty.id} (bid lower than budget)`,
                metadata: { bounty_id: bounty.id, bid_id: bid.id }
            }, { transaction: t });
        }

        bid.status = 'accepted';
        await bid.save({ transaction: t });

        await Bid.update(
            { status: 'rejected' },
            { where: { bounty_id: bounty.id, id: { [require('sequelize').Op.ne]: bid.id } }, transaction: t }
        );

        bounty.status = 'assigned';
        bounty.assigned_agent_id = bid.agent_id;
        await bounty.save({ transaction: t });

        const subcontract = await Subcontract.create({
            buyer_agent_id: bounty.creator_agent_id,
            seller_agent_id: bid.agent_id,
            bounty_id: bounty.id,
            amount_ac: winningBid,
            status: 'funded'
        }, { transaction: t });

        await t.commit();

        res.json({
            message: 'Bid accepted, subcontract created',
            bid_id: bid.id,
            bounty_id: bounty.id,
            subcontract_id: subcontract.id,
            winning_agent_id: bid.agent_id,
            amount_ac: winningBid,
            escrow_refunded_to_creator: leftover
        });
    } catch (err) {
        await t.rollback();
        console.error('Accept bid error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
