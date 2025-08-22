import Razorpay from "razorpay";

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID, // Your Razorpay Key ID
    key_secret: process.env.RAZORPAY_KEY_SECRET, // Your Razorpay Secret
});

export default async function handler(req, res) {
    if (req.method === "POST") {
        try {
            const { amount } = req.body;

            if (!amount) {
                return res.status(400).json({ error: "Amount is required" });
            }

            const options = {
                amount: amount * 100, // Razorpay wants paise, not rupees
                currency: "INR",
                receipt: "receipt#1",
            };

            const order = await razorpay.orders.create(options);

            res.status(200).json(order); // return order info to frontend

        } catch (error) {
            console.error("Razorpay Error:", error);
            res.status(500).json({ error: "Razorpay order creation failed", details: error.message });
        }
    } else {
        res.status(405).json({ error: "Method not allowed" });
    }
}