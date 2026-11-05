// Opening physical stock uses the audited shop adjustment RPC, never the
// product variant's online-availability quantity.
export function validateOpeningStock({quantity,locationId,locations=[],active}) {
  const text=String(quantity??"").trim();
  const count=Number(text);
  if(!/^\d+$/.test(text)||!Number.isSafeInteger(count)||count>100000) {
    throw new Error("Stock must be a whole number from 0 to 100,000.");
  }
  if(count===0)return {quantity:0,location:null};
  if(active!==true)throw new Error("Make the product active before adding shop stock, or enter 0 for now.");
  const location=locations.find(row=>String(row.id)===String(locationId));
  if(!location||location.kind!=="branch"||location.active===false) {
    throw new Error("Choose an assigned physical shop for this stock.");
  }
  return {quantity:count,location};
}

function required(value,label) {
  const result=typeof value==="string"?value.trim():"";
  if(!result)throw new Error(label+" is missing. Check the saved product before adding stock.");
  return result;
}

export function makeOpeningStockOperation({product,variantId,quantity,location,requestId}) {
  const validated=validateOpeningStock({quantity,locationId:location?.id,
    locations:location?[location]:[],active:product?.active!==false});
  if(validated.quantity===0)return null;
  const productCode=required(product?.product_code,"Product code");
  return Object.freeze({
    productId:required(product?.id,"Product"),productCode,
    variantId:required(variantId,"Variant"),
    locationId:required(location.id,"Shop"),locationName:String(location.name||"Selected shop"),
    quantity:validated.quantity,requestId:required(requestId,"Stock request"),
    reason:("Opening stock for "+productCode).slice(0,240)
  });
}

export function restoreOpeningStockOperation(record) {
  if(!record||typeof record!=="object"||Array.isArray(record)
    ||typeof record.quantity!=="number"||!Number.isSafeInteger(record.quantity)
    ||record.quantity<1||record.quantity>100000) {
    throw new Error("The saved opening stock request is invalid. Check this product in Inventory.");
  }
  const productCode=required(record.productCode,"Product code");
  const reason=("Opening stock for "+productCode).slice(0,240);
  if(record.reason!==reason)throw new Error("The saved opening stock request has changed. Check this product in Inventory.");
  return Object.freeze({
    productId:required(record.productId,"Product"),productCode,
    variantId:required(record.variantId,"Variant"),
    locationId:required(record.locationId,"Shop"),locationName:required(record.locationName,"Shop name"),
    quantity:record.quantity,requestId:required(record.requestId,"Stock request"),reason
  });
}

export async function receiveOpeningStock(client,operation) {
  operation=restoreOpeningStockOperation(operation);
  const {data,error}=await client.rpc("erp_adjust_stock",{
    p_location:operation.locationId,p_variant:operation.variantId,
    p_delta:operation.quantity,p_reason:operation.reason,p_request:operation.requestId
  });
  if(error)throw new Error(error.message||"Shop stock could not be confirmed. Retry this stock request.");
  if(!data||!Number.isSafeInteger(data.stock)||data.stock<0||data.stock>1000000000) {
    throw new Error("Shop stock could not be confirmed. Retry this stock request.");
  }
  return data;
}
