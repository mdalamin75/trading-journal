// File: /api/create-razorpay-order.js

// --- FIX: Use ES Module syntax (import/export) to match "type": "module" in package.json ---
import Razorpay from 'razorpay';

export default async (req, res) => {
    try {
        console.log('[API] Received request. Method:', req.method);

        if (req.method !== 'POST') {
            console.error(`[API] Method not allowed: Expected POST, but got ${req.method}`);
            return res.status(405).json({ error: `Method Not Allowed. Expected POST, got ${req.method}.` });
        }

        let amount;
        try {
            if (!req.body) {
                console.error('[API] Request body is empty.');
                return res.status(400).json({ error: 'Request body is empty.' });
            }
            // The body is already parsed by Vercel's helpers
            const body = req.body;
            amount = body.amount;
            console.log('[API] Received amount:', amount);
        } catch (parseError) {
            console.error('[API] Error accessing request body:', parseError);
            return res.status(400).json({ error: 'Invalid request body format.', details: parseError.message });
        }

        if (!amount) {
            console.log('[API] Amount is missing. Returning 400.');
            return res.status(400).json({ error: 'Amount is required' });
        }

        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        console.log('[API] Razorpay Key ID (first 5 chars):', keyId ? keyId.substring(0, 5) : 'Not set');
        
        if (!keyId || !keySecret) {
            console.error('[API] Razorpay API keys are not properly set in environment variables. Check Vercel project settings.');
            return res.status(500).json({ error: 'Razorpay API keys are not configured on the server.' });
        }

        const razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
        });
        console.log('[API] Razorpay instance created.');

        const options = {
            amount: amount,
            currency: 'INR',
            receipt: `receipt_order_${new Date().getTime()}`,
        };
        console.log('[API] Options for order creation:', options);

        const order = await razorpay.orders.create(options);
        console.log('[API] Razorpay order creation response:', order);

        if (!order) {
            console.error('[API] Razorpay order creation returned null or undefined. Returning 500.');
            return res.status(500).json({ error: 'Error creating order: Empty response from Razorpay.' });
        }
        
        console.log('[API] Order created successfully. Sending 200 response.');
        res.status(200).json(order);

    } catch (error) {
        console.error('[API] A critical error occurred during function execution:', error);
        res.status(500).json({ 
            error: 'A critical server error occurred.', 
            details: error.message,
        });
    }
};
