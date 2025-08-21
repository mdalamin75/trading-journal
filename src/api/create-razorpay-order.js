// File: /api/create-razorpay-order.js

// You need to install razorpay: npm install razorpay
const Razorpay = require('razorpay');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { amount } = req.body;

    if (!amount) {
        return res.status(400).json({ error: 'Amount is required' });
    }

    // IMPORTANT: Store your key_id and key_secret in environment variables
    // on Vercel for security. Don't hardcode them.
    const razorpay = new Razorpay({
        key_id: process.env.VITE_RAZORPAY_KEY_ID,
        key_secret: process.env.VITE_RAZORPAY_KEY_SECRET,
    });

    const options = {
        amount: amount, // amount in the smallest currency unit (paise)
        currency: 'INR',
        receipt: `receipt_order_${new Date().getTime()}`,
    };

    try {
        const order = await razorpay.orders.create(options);
        if (!order) {
            return res.status(500).json({ error: 'Error creating order' });
        }
        res.status(200).json(order);
    } catch (error) {
        console.error('Razorpay API Error:', error);
        res.status(500).json({ error: 'Could not create Razorpay order', details: error.message });
    }
}