import {describe,it,expect} from "vitest";
import {requiresPaymentReview,canVerifyManualUpi} from "../../admin/payment-review.mjs";
const pending={status:"pending",payment_status:"pending",total_amount:100,payments:[{method:"upi",status:"pending",amount:100,transaction_reference:"UTR12345678"}]};

describe("staff payment review",()=>{
  it("shows late capture, partial refunds and legacy unpaid fulfillment in review",()=>{
    for(const order of [
      {status:"cancelled",payment_status:"paid"},
      {status:"cancelled",payment_status:"partially_paid"},
      {status:"delivered",payment_status:"pending"},
      {status:"refunded",payment_status:"refunded"},
      {...pending,payment_review:{checkout_status:"refund_required"}}
    ])expect(requiresPaymentReview(order)).toBe(true);
    expect(requiresPaymentReview(pending)).toBe(false);
    expect(requiresPaymentReview({status:"cancelled",payment_status:"failed"})).toBe(false);
  });
  it("offers verification only for an exact pending manual UPI receipt to an admin",()=>{
    expect(canVerifyManualUpi(pending,"admin")).toBe(true);
    expect(canVerifyManualUpi(pending,"cashier")).toBe(false);
    expect(canVerifyManualUpi({...pending,status:"cancelled"},"admin")).toBe(false);
    expect(canVerifyManualUpi({...pending,payments:[{...pending.payments[0],method:"razorpay"}]},"admin")).toBe(false);
    expect(canVerifyManualUpi({...pending,payments:[{...pending.payments[0],amount:99}]},"admin")).toBe(false);
    expect(canVerifyManualUpi({...pending,payment_review:{checkout_status:"refund_required"}},"admin")).toBe(false);
  });
});
