// /api/verify-razorpay-payment.js
const crypto = require('crypto');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch {
            res.status(400).json({ error: 'Invalid JSON' });
            return;
        }
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        res.status(400).json({ error: 'Missing payment fields' });
        return;
    }

    const secret = process.env.RAZORPAY_KEY_SECRET || process.env.VITE_RAZORPAY_KEY_SECRET;
    if (!secret) {
        res.status(500).json({ error: 'Server missing RAZORPAY_KEY_SECRET' });
        return;
    }

    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    if (expected !== razorpay_signature) {
        res.status(400).json({ ok: false, error: 'Signature mismatch' });
        return;
    }

    // ✅ Payment is verified at this point.
    // TODO: Mark the user/order as paid in your database here.

    res.status(200).json({ ok: true });
};