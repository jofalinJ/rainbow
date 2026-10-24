# Rainbow checkout operations

The existing `rainbow-api` Worker supports **Razorpay TEST keys only**. Never put live Razorpay keys into this Worker. The storefront uses Standard Checkout; card or UPI credentials are never collected by Rainbow's pages.

The current architecture and release checks are described in [the checkout runbook](RAZORPAY_TEST_INTEGRATION_RUNBOOK.md). [Paid invoices and notifications](PAID_ORDER_INVOICE_WHATSAPP.md) describes invoice access and the default-off Meta sender.

A checkout reserves stock but is not a placed order. Only the backend's independent captured-payment check, or an active administrator's bank-receipt verification of manual UPI, can confirm an online order. A customer-entered UTR is not proof of payment.

Manual UPI uses the rate-limited Worker proxy. Anonymous clients cannot execute the underlying creation or guest tracking RPCs directly. Pending manual UPI reservations expire after 24 hours and require reconciliation if money arrives later.

All prices and delivery charges are calculated by PostgreSQL: delivery is ₹50 for Tamil Nadu and ₹100 for other supported Indian states/UTs. The existing tax model uses CGST/SGST; interstate tax treatment needs the merchant's accountant review before accepting real interstate payments.
