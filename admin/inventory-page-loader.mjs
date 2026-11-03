/**
 * Bounded, stable inventory pagination. Supabase/PostgREST commonly caps one
 * response at 1,000 rows; never silently present a truncated stock ledger.
 * Read-only: neither function modifies inventory.
 */
export const INVENTORY_PAGE_SIZE=500;
export const INVENTORY_MAX_PAGES=100;
const VARIANT_FIELDS="id,color,size,length_cm,stock_quantity,low_stock_limit,barcode,products(id,product_code,product_name,type,category_id,length_cm,thickness,gold_amount_g)";
const BALANCE_FIELDS="variant_id,on_hand,reserved";

async function collectPages(buildPage,{pageSize=INVENTORY_PAGE_SIZE,maxPages=INVENTORY_MAX_PAGES}={}){
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000||
     !Number.isInteger(maxPages)||maxPages<1||maxPages>100)
    throw new Error("Invalid inventory page limits.");
  const rows=[];
  for(let page=0;page<maxPages;page++){
    const start=page*pageSize;
    const {data,error}=await buildPage(start,start+pageSize-1);
    if(error)throw new Error("Inventory page "+(page+1)+" failed: "+(error.message||"Request failed"));
    if(!Array.isArray(data)||data.length>pageSize)
      throw new Error("Inventory server returned an invalid page.");
    rows.push(...data);
    if(data.length<pageSize)return rows;
  }
  // An exact multiple of maxPages may contain extra rows. Fail closed.
  throw new Error("Inventory exceeds safe loading limit. Narrow the catalogue or contact an administrator.");
}

export async function fetchInventoryVariants(client,limits){
  if(!client?.from)throw new Error("Inventory database unavailable.");
  return collectPages((start,end)=>client.from("product_variants")
    .select(VARIANT_FIELDS).eq("active",true)
    .order("created_at",{ascending:false}).order("id",{ascending:true})
    .range(start,end),limits);
}

export async function fetchBranchAvailableBalances(client,branchId,limits){
  const balances=new Map();
  if(!branchId)return balances;
  if(!client?.from)throw new Error("Inventory database unavailable.");
  const rows=await collectPages((start,end)=>client.from("erp_stock_balances")
    .select(BALANCE_FIELDS).eq("location_id",branchId)
    .order("variant_id",{ascending:true}).range(start,end),limits);
  for(const row of rows){
    const onHand=Number(row.on_hand),reserved=Number(row.reserved);
    if(!row.variant_id||!Number.isSafeInteger(onHand)||!Number.isSafeInteger(reserved)||
       onHand<0||reserved<0||reserved>onHand)
      throw new Error("Invalid branch stock balance encountered. Refresh and contact an administrator.");
    balances.set(row.variant_id,onHand-reserved);
  }
  return balances;
}
