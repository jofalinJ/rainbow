// A branch receipt must never be written into the storefront's online quantity.
export function buildOpeningStockPlan({quantity,multiShop,locations=[],locationId="",active=true}){
  const text=String(quantity??"").trim();
  if(!/^\d+$/.test(text))throw new Error("Initial stock must be a whole number of zero or more.");
  const value=Number(text),enabled=multiShop===true,maximum=enabled?100_000:2_147_483_647;
  if(!Number.isSafeInteger(value)||value>maximum)throw new Error("Initial stock must be "+maximum.toLocaleString("en-IN")+" or less.");
  const location=locations.find(row=>String(row.id)===String(locationId)&&row.kind==="branch"&&row.active!==false);
  if(enabled&&value>0){
    if(active===false)throw new Error("Publish the product before adding initial shop stock, or start with zero stock.");
    if(!location)throw new Error("Choose an assigned shop for the initial stock. Ask the admin for shop access if none are available.");
  }
  return {quantity:value,multiShop:enabled,locationId:location?.id||"",locationName:location?.name||""};
}

export function createVariantStockOperation({productId,draft,opening,requestId}){
  if(!productId)throw new Error("The product must be saved before its variant.");
  if(opening.multiShop&&opening.quantity>0&&!requestId)throw new Error("A stock receipt request is required.");
  return {
    payload:{...draft,product_id:productId,stock_quantity:opening.multiShop?0:opening.quantity},
    variant:null,opening:Object.freeze({...opening}),requestId,stockSaved:false,inFlight:null
  };
}

// Retain the variant and request UUID after an uncertain receipt response, so a
// retry uses the server's idempotency check instead of inserting another variant.
export async function saveVariantStockOperation(operation,{insertVariant,receiveStock}){
  if(operation.inFlight)return operation.inFlight;
  operation.inFlight=(async()=>{
    if(!operation.variant){
      const rows=await insertVariant(operation.payload);
      if(!Array.isArray(rows)||rows.length!==1||!rows[0]?.id)
        throw new Error("The new variant could not be verified. Refresh and check the variant list.");
      operation.variant=rows[0];
    }
    if(!operation.stockSaved){
      const opening=operation.opening;
      if(opening.multiShop&&opening.quantity>0){
        await receiveStock({
          p_location:opening.locationId,p_variant:operation.variant.id,p_delta:opening.quantity,
          p_reason:"Opening stock from product entry",p_request:operation.requestId
        });
      }
      operation.stockSaved=true;
    }
    return operation.variant;
  })();
  try{return await operation.inFlight;}
  finally{operation.inFlight=null;}
}
