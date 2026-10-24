export function requiresPaymentReview(order){
  return ["refund_required","refunded"].includes(order.payment_review?.checkout_status)||
    ["partially_paid","refunded"].includes(order.payment_status)||
    (["cancelled","refunded"].includes(order.status)&&order.payment_status==="paid")||
    (["confirmed","processing","shipped","delivered"].includes(order.status)&&order.payment_status!=="paid");
}

export function canVerifyManualUpi(order,role){
  if(role!=="admin"||requiresPaymentReview(order)||order.payment_status!=="pending"||order.status!=="pending")return false;
  const payments=Array.isArray(order.payments)?order.payments:order.payments?[order.payments]:[];
  if(payments.some(payment=>payment.method==="razorpay"))return false;
  return payments.some(payment=>payment.method==="upi"&&payment.status==="pending"&&
    /^[A-Za-z0-9-]{8,64}$/.test(payment.transaction_reference||"")&&Number(payment.amount)===Number(order.total_amount));
}
