class PaymentRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaymentRequiredError";
    this.status = 402;
  }
}

module.exports = { PaymentRequiredError };

