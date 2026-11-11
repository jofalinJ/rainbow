/* The existing transactional ERP POS RPC remains the only authority for final invoices and stock. */
import {SHARED_SHOP_ACCESS_MODE} from "./offline-pos-core.mjs";
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
export function isTransientSyncError(error){
 const s=String(error?.message||error||"");
 return /fetch|network|offline|timeout|failed to connect|503|502|504|abort|DNS|CORS|Sign in online before|Session expired|authentication required|Sign in with that account|sign in with the original/i.test(s);
}
export async function syncOfflineSale(vault,sale,client){
 if(sale.status!=="pending")return {status:"skipped"};
 const {data:auth,error:authError}=await client.auth.getUser();
 if(authError||!auth?.user)throw new Error("Sign in online before synchronizing cash sales.");
 // Old records predate shop passcode sharing. Their first RPC attempt may
 // already be bound to the original creator; do not change that actor.
 const shared=sale.accessMode===SHARED_SHOP_ACCESS_MODE;
 if(!shared&&auth.user.id!==sale.userId)
  throw new Error("Legacy cash record: sign in with the original staff account to sync.");
 if(shared&&sale.syncActorId&&sale.syncActorId!==auth.user.id)
  throw new Error("This cash record was first submitted by another staff account. Sign in with that account to retry.");
 const {data:profile,error:profileError}=await client.from("staff_profiles")
  .select("role,active").eq("user_id",auth.user.id).maybeSingle();
 if(profileError||!profile?.active||!["admin","cashier"].includes(profile.role))
  throw new Error("Staff billing permission is no longer active.");
 const {data:location,error:locationError}=await client.from("erp_locations")
  .select("id,kind,active").eq("id",sale.locationId).maybeSingle();
 if(locationError||!location?.active||location.kind!=="branch")
  throw new Error("The offline billing shop is no longer active.");
 if(profile.role!=="admin"){
  const {data:assigned,error:assignmentError}=await client.from("erp_staff_locations")
   .select("location_id").eq("user_id",auth.user.id).eq("location_id",sale.locationId).maybeSingle();
  if(assignmentError||!assigned)throw new Error("You are no longer assigned to this billing shop.");
 }
 const productIds=[...new Set(sale.rows.map(row=>row.product_id))];
 const {data:prices,error:priceError}=await client.from("products")
  .select("id,selling_price,active").in("id",productIds);
 if(priceError)throw priceError;
 for(const row of sale.rows){
  const current=prices?.find(p=>p.id===row.product_id);
  if(!current?.active)throw new Error("Product "+row.product_code+" is no longer active. Owner review required.");
  if(round(current.selling_price)!==round(row.unitPrice))
   throw new Error("Price changed for "+row.product_code+" since offline cash was recorded. Owner review required.");
 }
 // Save the first authorized online staff identity before sending the RPC.
 // Its server-side idempotency record binds request ID + payload + actor, so
 // retries after a lost response must use that same staff account.
 if(shared)await vault.claimSyncActor(sale.id,auth.user.id);
 // The server rechecks stock under row locks and either issues one final bill
 // for p_request or rejects the transaction; never rewrite any invoice locally.
 const {data,error}=await client.rpc("erp_create_local_sale",{
  p_items:sale.items,p_customer:sale.customer,p_payment_method:"cash",
  p_location:sale.locationId,p_request:sale.id
 });
 if(error)throw error;
 if(!data?.invoice_number||!data?.public_token||!data?.order_id)
  throw new Error("POS did not return a verified invoice. Retry the same request ID.");
 // The RPC uses numeric PostgreSQL rounding. Do not silently accept cash mismatch.
 // If this ever differs, retain the idempotent sale and flag the mismatch for staff.
 const saved=await vault.markSynced(sale.id,data);
 return {status:"synced",sale:saved,receipt:data,difference:Math.abs(Number(data.total_amount)-Number(sale.totals.total))};
}
export async function syncQueuedSales(vault,client,onProgress=()=>{}){
 const snapshot=await vault.read();
 const remaining=snapshot.pending.filter(s=>s.status==="pending");
 const stats={confirmed:0,needsReview:0,delayed:0};
 for(const sale of remaining){
  onProgress("Synchronizing offline record "+sale.id.slice(0,8)+"…");
  try{
   const result=await syncOfflineSale(vault,sale,client);
   if(result.status==="synced"){
    stats.confirmed++;
    if(result.difference>0.01){onProgress("Invoice "+result.receipt.invoice_number+" needs amount review.");}
   }
  }catch(error){
   if(isTransientSyncError(error)){
    stats.delayed++;
    onProgress("Sync paused: "+String(error?.message||error)+". Offline records remain encrypted and pending.");
    break;
   }
   const explanation=String(error?.message||error||"Synchronization blocked").slice(0,250);
   // Do not auto-resubmit stock/price/authorization conflicts. No final invoice
   // is issued locally. Staff should contact the owner to reconcile.
   await vault.markReview(sale.id,explanation);
   stats.needsReview++;
   onProgress("Offline record needs review: "+explanation);
  }
 }
 return stats;
}
