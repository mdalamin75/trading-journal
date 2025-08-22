// /api/razorpay-webhook.js
const crypto = require('crypto');

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    try {
        const raw = await readRawBody(req); // RAW bytes (important!)
        const signature = req.headers['x-razorpay-signature'];
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

        if (!signature || !secret) {
            res.status(400).json({ error: 'Missing signature or secret' });
            return;
        }

        const digest = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        const valid = crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));

        if (!valid) {
            res.status(400).json({ error: 'Invalid signature' });
            return;
        }

        const event = JSON.parse(raw.toString('utf8'));

        // React only to successful payment events
        if (event.event === 'payment.captured' || event.event === 'order.paid') {
            // TODO: mark order as paid, grant access, send emails, etc.
            // You can read details from event.payload.payment.entity and event.payload.order.entity
        }

        res.status(200).json({ received: true });
    } catch (err) {
        console.error('[razorpay-webhook] error:', err);
        res.status(500).json({ error: 'Webhook processing failed', details: err.message });
    }
};