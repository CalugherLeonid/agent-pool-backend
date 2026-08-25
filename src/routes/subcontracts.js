const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Subcontract, Agent, Bounty, Transaction, AgentMemory, sequelize } = require('../models');
const { authenticateAgent, authenticateOwner } = require('../middleware/auth');
const { isTimedOut } = require('../utils/subcontractTimeout');
const { updateSellerReputation } = require('../utils/reputation');

// Verifică timeout-ul de 72h și trece automat 'delivered' -> 'disputed'
// dacă a expirat. Rulează "leneș", la fiecare acces, nu printr-un cron job.
async function checkAndApplyTimeout(subcontract, t) {
    if (subcontract.status === 'delivered' && isTimedOut(subcontract.delivered_at)) {
        subcontract.status = 'disputed';
        await subcontract.save({ transaction: t });
    }
    return subcontract;
}

// ============================================
// GET /api/subcontracts – Subcontractele proprii (ca buyer SAU seller)
// ============================================
router.get('/', authenticateAgent, async (req, res) => {
    try {
        const subcontracts = await Subcontract.findAll({
            where: {
                [Op.or]: [
                    { buyer_agent_id: req.agent.id },
                    { seller_agent_id: req.agent.id }
                ]
            },
            order: [['createdAt', 'DESC']]
        });
        res.json(subcontracts);
    } catch (err) {
        console.error('List subcontracts error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/subcontracts/:id – Detaliu, doar pentru participanți (buyer/seller)
router.get('/:id', authenticateAgent, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        let subcontract = await Subcontract.findByPk(req.params.id, { transaction: t });
        if (!subcontract) {
            await t.rollback();
            return res.status(404).json({ error: 'Subcontract not found' });
        }
        if (subcontract.buyer_agent_id !== req.agent.id && subcontract.seller_agent_id !== req.agent.id) {
            await t.rollback();
            return res.status(403).json({ error: 'Not a participant in this subcontract' });
        }

        subcontract = await checkAndApplyTimeout(subcontract, t);
        await t.commit();
        res.json(subcontract);
    } catch (err) {
        await t.rollback();
        console.error('Get subcontract error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// PUT /api/subcontracts/:id/deliver – Seller marchează livrarea
// funded/in_progress -> delivered, pornește ceasul de 72h
// ============================================
router.put('/:id/deliver', authenticateAgent, async (req, res) => {
    try {
        const subcontract = await Subcontract.findByPk(req.params.id);
        if (!subcontract) {
            return res.status(404).json({ error: 'Subcontract not found' });
        }
        if (subcontract.seller_agent_id !== req.agent.id) {
            return res.status(403).json({ error: 'Only the seller can mark delivery' });
        }
        if (!['funded', 'in_progress'].includes(subcontract.status)) {
            return res.status(409).json({ error: `Cannot deliver from status '${subcontract.status}'` });
        }

        subcontract.status = 'delivered';
        subcontract.delivered_at = new Date();
        await subcontract.save();

        res.json({
            message: 'Delivery marked. 72h confirmation window started.',
            subcontract_id: subcontract.id,
            delivered_at: subcontract.delivered_at
        });
    } catch (err) {
        console.error('Deliver error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// PUT /api/subcontracts/:id/confirm – Buyer confirmă livrarea
// delivered -> confirmed: transfer REAL de bani către seller,
// actualizare reputație (success_rate), bounty -> completed
// ============================================
router.put('/:id/confirm', authenticateAgent, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        let subcontract = await Subcontract.findByPk(req.params.id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!subcontract) {
            await t.rollback();
            return res.status(404).json({ error: 'Subcontract not found' });
        }
        if (subcontract.buyer_agent_id !== req.agent.id) {
            await t.rollback();
            return res.status(403).json({ error: 'Only the buyer can confirm delivery' });
        }

        subcontract = await checkAndApplyTimeout(subcontract, t);
        if (subcontract.status !== 'delivered') {
            await t.rollback();
            return res.status(409).json({ error: `Cannot confirm from status '${subcontract.status}' (timeout may have moved it to disputed)` });
        }

        const seller = await Agent.findByPk(subcontract.seller_agent_id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const amount = parseFloat(subcontract.amount_ac);
        seller.balance_ac = parseFloat(seller.balance_ac) + amount;
        await updateSellerReputation(seller, true, Subcontract, Op, t);
        await seller.save({ transaction: t });

        await Transaction.create({
            agent_id: seller.id,
            type: 'settlement',
            amount_ac: amount,
            fee_ac: 0,
            description: `Settlement for subcontract #${subcontract.id}`,
            metadata: { subcontract_id: subcontract.id, bounty_id: subcontract.bounty_id }
        }, { transaction: t });

        subcontract.status = 'confirmed';
        await subcontract.save({ transaction: t });

        // AgentMemory API: dovadă reală de succes — orice lecție legată
        // de acest subcontract devine validată automat, nu la cerere.
        await AgentMemory.update(
            { validated: true },
            { where: { subcontract_id: subcontract.id }, transaction: t }
        );

        const bounty = await Bounty.findByPk(subcontract.bounty_id, { transaction: t });
        if (bounty) {
            bounty.status = 'completed';
            bounty.completed_at = new Date();
            await bounty.save({ transaction: t });
        }

        await t.commit();

        res.json({
            message: 'Confirmed. Payment settled to seller.',
            subcontract_id: subcontract.id,
            paid_to_agent_id: seller.id,
            amount_ac: amount,
            seller_new_balance: seller.balance_ac,
            seller_new_success_rate: seller.success_rate,
            seller_new_reputation_score: seller.reputation_score
        });
    } catch (err) {
        await t.rollback();
        console.error('Confirm error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// PUT /api/subcontracts/:id/dispute – Buyer disputa manual (înainte de timeout)
// delivered -> disputed
// ============================================
router.put('/:id/dispute', authenticateAgent, async (req, res) => {
    try {
        const subcontract = await Subcontract.findByPk(req.params.id);
        if (!subcontract) {
            return res.status(404).json({ error: 'Subcontract not found' });
        }
        if (subcontract.buyer_agent_id !== req.agent.id) {
            return res.status(403).json({ error: 'Only the buyer can raise a dispute' });
        }
        if (subcontract.status !== 'delivered') {
            return res.status(409).json({ error: `Cannot dispute from status '${subcontract.status}'` });
        }

        subcontract.status = 'disputed';
        await subcontract.save();

        res.json({ message: 'Dispute raised. Awaiting owner resolution.', subcontract_id: subcontract.id });
    } catch (err) {
        console.error('Dispute error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// PUT /api/subcontracts/:id/resolve – Owner rezolvă disputa (singurul punct
// real de intervenție umană — "circuit breaker", nu aprobare per-tranzacție)
// Necesită JWT, și owner-ul trebuie să dețină agentul buyer SAU seller.
// body: { decision: 'pay_seller' | 'refund_buyer' }
// ============================================
router.put('/:id/resolve', authenticateOwner, async (req, res) => {
    const { decision } = req.body;
    if (!['pay_seller', 'refund_buyer'].includes(decision)) {
        return res.status(400).json({ error: "decision must be 'pay_seller' or 'refund_buyer'" });
    }

    const t = await sequelize.transaction();
    try {
        const subcontract = await Subcontract.findByPk(req.params.id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!subcontract) {
            await t.rollback();
            return res.status(404).json({ error: 'Subcontract not found' });
        }
        if (subcontract.status !== 'disputed') {
            await t.rollback();
            return res.status(409).json({ error: `Cannot resolve from status '${subcontract.status}'` });
        }

        const buyer = await Agent.findByPk(subcontract.buyer_agent_id, { transaction: t, lock: t.LOCK.UPDATE });
        const seller = await Agent.findByPk(subcontract.seller_agent_id, { transaction: t, lock: t.LOCK.UPDATE });

        // Doar owner-ul unuia dintre agenții implicați poate rezolva —
        // omul rămâne "circuit breaker" doar pentru propriii agenți.
        if (buyer.owner_id !== req.owner.id && seller.owner_id !== req.owner.id) {
            await t.rollback();
            return res.status(403).json({ error: 'You do not own either party in this subcontract' });
        }

        const amount = parseFloat(subcontract.amount_ac);

        if (decision === 'pay_seller') {
            seller.balance_ac = parseFloat(seller.balance_ac) + amount;
            await updateSellerReputation(seller, true, Subcontract, Op, t);
            await seller.save({ transaction: t });

            await Transaction.create({
                agent_id: seller.id,
                type: 'settlement_disputed',
                amount_ac: amount,
                fee_ac: 0,
                description: `Dispute resolved in favor of seller — subcontract #${subcontract.id}`,
                metadata: { subcontract_id: subcontract.id, resolved_by_owner: req.owner.id }
            }, { transaction: t });
        } else {
            buyer.balance_ac = parseFloat(buyer.balance_ac) + amount;
            await updateSellerReputation(seller, false, Subcontract, Op, t);
            await buyer.save({ transaction: t });
            await seller.save({ transaction: t });

            await Transaction.create({
                agent_id: buyer.id,
                type: 'refund_disputed',
                amount_ac: amount,
                fee_ac: 0,
                description: `Dispute resolved in favor of buyer (refund) — subcontract #${subcontract.id}`,
                metadata: { subcontract_id: subcontract.id, resolved_by_owner: req.owner.id }
            }, { transaction: t });
        }

        subcontract.status = 'resolved';
        await subcontract.save({ transaction: t });

        // AgentMemory API: dacă disputa s-a rezolvat în favoarea seller-ului
        // (livrarea a fost, până la urmă, reală și bună), lecțiile legate
        // de acest subcontract se validează la fel ca la o confirmare directă.
        if (decision === 'pay_seller') {
            await AgentMemory.update(
                { validated: true },
                { where: { subcontract_id: subcontract.id }, transaction: t }
            );
        }

        const bounty = await Bounty.findByPk(subcontract.bounty_id, { transaction: t });
        if (bounty) {
            bounty.status = decision === 'pay_seller' ? 'completed' : 'cancelled';
            if (decision === 'pay_seller') bounty.completed_at = new Date();
            await bounty.save({ transaction: t });
        }

        await t.commit();

        res.json({
            message: `Dispute resolved: ${decision}`,
            subcontract_id: subcontract.id,
            amount_ac: amount
        });
    } catch (err) {
        await t.rollback();
        console.error('Resolve dispute error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
