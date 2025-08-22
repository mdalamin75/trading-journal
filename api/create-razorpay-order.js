// /api/create-razorpay-order.js
const Razorpay = require('razorpay');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    // Body may arrive as a string or object
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch {
            res.status(400).json({ error: 'Invalid JSON' });
            return;
        }
    }

    const { amount, currency = 'INR', receipt } = body || {};
    // amount must be integer paise, e.g., ₹1.00 => 100
    if (!Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({ error: 'amount must be an integer in paise (>0)' });
        return;
    }

    const key_id = process.env.VITE_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET || process.env.VITE_RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) {
        res.status(500).json({ error: 'Razorpay keys not configured on server' });
        return;
    }

    try {
        const rp = new Razorpay({ key_id, key_secret });
        const order = await rp.orders.create({
            amount, // integer in paise (e.g., 49900 for ₹499)
            currency, // 'INR'
            receipt: receipt || `rcpt_${Date.now()}`
        });
        res.status(200).json(order);
    } catch (err) {
        console.error('[create-razorpay-order] error:', err);
        res.status(500).json({ error: 'Could not create order', details: err.message });
    }
};