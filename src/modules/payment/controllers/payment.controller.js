const stripe = require("stripe")(
  process.env.STRIPE_SECRET_KEY || "sk_test_mock",
);
const logger = require("../../../shared/utils/logger");

exports.createPaymentIntent = async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount === undefined || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid amount" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), 
      currency: "cad",
      payment_method_types: ["card"],
    });

    res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    logger.error(`Payment Controller Error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};
