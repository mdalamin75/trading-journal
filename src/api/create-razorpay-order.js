const Razorpay = require('razorpay');

export default async function handler(req, res) {
    console.log('[API] Function invoked. Method:', req.method);

    if (req.method !== 'POST') {
        console.log('[API] Method Not Allowed. Returning 405.');
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // Attempt to parse body
    let amount;
    try {
        if (!req.body) {
            console.error('[API] Request body is empty.');
            return res.status(400).json({ error: 'Request body is empty.' });
        }
        amount = req.body.amount;
        console.log('[API] Received amount:', amount);
    } catch (parseError) {
        console.error('[API] Error parsing request body:', parseError);
        return res.status(400).json({ error: 'Invalid request body format.', details: parseError.message });
    }

    if (!amount) {
        console.log('[API] Amount is missing. Returning 400.');
        return res.status(400).json({ error: 'Amount is required' });
    }

    const keyId = process.env.VITE_RAZORPAY_KEY_ID;
    const keySecret = process.env.VITE_RAZORPAY_KEY_SECRET;

    console.log('[API] Razorpay Key ID (first 5 chars):', keyId ? keyId.substring(0, 5) : 'Not set');
    console.log('[API] Razorpay Key Secret (first 5 chars):', keySecret ? keySecret.substring(0, 5) : 'Not set');

    if (!keyId || !keySecret) {
        console.error('[API] Razorpay API keys are not properly set in environment variables. Check Vercel project settings.');
        return res.status(500).json({ error: 'Razorpay API keys are not configured on the server.' });
    }

    try {
        const razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
        });
        console.log('[API] Razorpay instance created.');

        const options = {
            amount: amount, // amount in the smallest currency unit (paise)
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
        console.error('[API] Caught unhandled error during Razorpay order creation:', error);
        // Ensure error response is always JSON
        res.status(500).json({ 
            error: 'Could not create Razorpay order', 
            details: error.message,
            stack: error.stack // Include stack trace for more details in Vercel logs
        });
    }
}
