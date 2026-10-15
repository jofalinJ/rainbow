// Explicit, independently testable client validation. The database repeats all checks.
export function validateStockAdjustment(direction,rawQuantity,rawReason,currentStock){
  if(!["add","remove"].includes(direction))throw new Error("Choose Add or Remove.");
  const quantityText=String(rawQuantity??"").trim();
  if(!/^\d+$/.test(quantityText))throw new Error("Enter a whole-number quantity.");
  const quantity=Number(quantityText);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100000)throw new Error("Enter 1 to 100,000 units.");
  const change=direction==="remove"?-quantity:quantity;
  const stock=Number(currentStock);
  if(!Number.isSafeInteger(stock)||stock<0)throw new Error("Current stock is unavailable.");
  if(stock+change<0)throw new Error("Cannot remove more than "+stock+" available units.");
  if(stock+change>1000000000)throw new Error("Resulting stock exceeds the supported range.");
  const reason=String(rawReason??"").trim();
  if(reason.length<8||reason.length>240)throw new Error("Write a reason of 8 to 240 characters.");
  return {change,reason,after:stock+change};
}
export function movementDelta(tx){
  if(Number.isInteger(tx.quantity_delta)&&tx.quantity_delta!==0)return tx.quantity_delta;
  const quantity=Number(tx.quantity);
  if(!Number.isFinite(quantity))return null;
  if(["sale_local","sale_online","damage","loss"].includes(tx.transaction_type))return -quantity;
  if(["stock_in","return"].includes(tx.transaction_type))return quantity;
  return null;
}
