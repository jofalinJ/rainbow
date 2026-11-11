import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {makePendingSale,offlineTotals,sanitizeOfflineCatalog,OFFLINE_MAX_AGE_MS} from "../../admin/offline-pos-core.mjs";
import {syncOfflineSale,syncQueuedSales,isTransientSyncError} from "../../admin/offline-pos-sync.mjs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const locationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actorId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const productId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const variantId="ffffffff-ffff-4fff-8fff-ffffffffffff";
const requestId="11111111-1111-4111-8111-111111111111";
const catalog=[{id:productId,product_code:"RGC/CH001",product_name:"Sample chain",type:"Chain",active:true,
 selling_price:1000,product_images:[{public_url:"https://untrusted.example/private.jpg"}],
 product_variants:[{id:variantId,barcode:"CODE-0001",color:"0",size:"0",active:true,stock_quantity:4}]}];
const fixture=()=>({userId:actorId,locationId,locationName:"Fixture shop",
 expiresAt:Date.now()+OFFLINE_MAX_AGE_MS,catalog:sanitizeOfflineCatalog(catalog),pending:[]});
const sale=(data=fixture())=>makePendingSale(data,[{variant_id:variantId,quantity:2}],
 {name:"Fixture",whatsapp_number:"9876543210"},Date.now(),requestId);
function fakeClient(opts={}){
 const rpc=vi.fn().mockResolvedValue({data:{invoice_number:"INV-TEST",order_number:"LS-TEST",
  public_token:"22222222-2222-4222-8222-222222222222",order_id:"33333333-3333-4333-8333-333333333333",
  total_amount:999},error:null});
 const table={
  staff_profiles:{role:"cashier",active:true},
  erp_locations:{id:locationId,active:true,kind:"branch"},
  erp_staff_locations:{location_id:locationId},
  products:[{id:productId,selling_price:1000,active:true}]
 };
 return {
  auth:{getUser:vi.fn(async()=>({data:{user:{id:opts.userId||actorId}},error:null}))},
  from:vi.fn(name=>({
   select(){return this;},eq(){return this;},in(){return Promise.resolve({data:table[name],error:null});},
   maybeSingle(){return Promise.resolve({data:table[name],error:null});}
  })),
  rpc
 };
}
describe("encrypted offline billing contract",()=>{
 it("stores no image URLs or staff secrets in the catalogue snapshot",()=>{
  const x=sanitizeOfflineCatalog(catalog);
  expect(x[0].product_images).toBeUndefined();
  expect(x[0].product_variants[0].stock_quantity).toBe(4);
  expect(read("admin/offline-pos-core.mjs")).toContain('name:"AES-GCM"');
  expect(read("admin/offline-pos-core.mjs")).toContain('iterations:310000');
  expect(read("admin/offline-pos-core.mjs")).not.toContain("localStorage.");
 });
 it("calculates provisional cash totals matching the existing POS discounts",()=>{
  expect(offlineTotals([{unitPrice:1000,quantity:2}])).toEqual({
   subtotal:2000,discount:60,cgst:29.1,sgst:29.1,total:1998.2
  });
 });
 it("rejects duplicate variants, stock overselling, invalid quantities and expired access",()=>{
  const data=fixture();
  expect(sale(data).items).toEqual([{variant_id:variantId,quantity:2}]);
  data.pending.push(sale(data));
  expect(()=>makePendingSale(data,[{variant_id:variantId,quantity:3}],{},Date.now())).toThrow(/stock/);
  expect(()=>makePendingSale(data,[{variant_id:variantId,quantity:1},{variant_id:variantId,quantity:1}],{},Date.now())).toThrow(/Duplicate/);
  expect(()=>makePendingSale(data,[{variant_id:variantId,quantity:-3}],{},Date.now())).toThrow(/quantity/);
  data.expiresAt=Date.now()-1;
  expect(()=>makePendingSale(data,[{variant_id:variantId,quantity:1}],{},Date.now())).toThrow(/expired/);
 });
 it("keeps the unique request ID through the server-side idempotent ERP billing RPC",async()=>{
  const record=sale(),vault={markSynced:vi.fn(async(id,receipt)=>({...record,id,status:"synced",receipt}))};
  const client=fakeClient();
  const response=await syncOfflineSale(vault,record,client);
  expect(response.status).toBe("synced");
  expect(client.rpc).toHaveBeenCalledOnce();
  expect(client.rpc).toHaveBeenCalledWith("erp_create_local_sale",{
   p_items:record.items,p_customer:record.customer,p_payment_method:"cash",
   p_location:locationId,p_request:requestId
  });
  expect(vault.markSynced).toHaveBeenCalledWith(requestId,expect.objectContaining({invoice_number:"INV-TEST"}));
 });
 it("never syncs a sale from another user or after a price change",async()=>{
  const record=sale(),vault={markSynced:vi.fn()};
  const other=fakeClient({userId:"other-user"});
  await expect(syncOfflineSale(vault,record,other)).rejects.toThrow(/different staff/);
  expect(other.rpc).not.toHaveBeenCalled();
  const client=fakeClient();
  const originalFrom=client.from;
  client.from=vi.fn(name=>{
   if(name==="products")return {
    select(){return this;},in(){return Promise.resolve({data:[{id:productId,selling_price:999,active:true}],error:null});}
   };
   return originalFrom(name);
  });
  await expect(syncOfflineSale(vault,record,client)).rejects.toThrow(/Price changed/);
  expect(client.rpc).not.toHaveBeenCalled();
 });
 it("keeps network-failed sales pending and marks hard stock failures for review",async()=>{
  expect(isTransientSyncError(new Error("Failed to fetch"))).toBe(true);
  const record=sale();
  const vault={read:vi.fn(async()=>({pending:[record]})),markReview:vi.fn(async()=>{})};
  const client=fakeClient();
  client.rpc.mockResolvedValueOnce({data:null,error:{message:"Insufficient stock"}});
  const result=await syncQueuedSales(vault,client);
  expect(result.needsReview).toBe(1);
  expect(vault.markReview).toHaveBeenCalledWith(requestId,"Insufficient stock");
  client.rpc.mockRejectedValueOnce(new Error("Failed to fetch"));
  vault.markReview.mockClear();
  const result2=await syncQueuedSales(vault,client);
  expect(result2.delayed).toBe(1);
  expect(vault.markReview).not.toHaveBeenCalled();
 });
 it("uses an inline, keyboard-accessible passphrase form instead of unsupported prompt dialogs",()=>{
  const markup=read("admin/billing.html");
  const bridge=read("admin/offline-pos-bridge.mjs");
  for(const id of ["offlineSetupForm","offlineDevicePassphrase","offlineConfirmPassphrase",
   "offlineSetupSubmit","offlineSetupCancel","offlineSetupStatus"]){
    expect(markup).toContain('id="'+id+'"');
  }
  expect(markup).toContain('type="password" minlength="10" required');
  expect(markup).toContain('autocomplete="new-password"');
  expect(markup).toContain('aria-controls="offlineSetupForm"');
  expect(markup).toContain('offline-pos-bridge.mjs?v=20261111-inline-setup');
  expect(bridge).not.toMatch(/\\b(?:window\\.)?prompt\\s*\\(/);
  expect(bridge).toContain('form.addEventListener("submit"');
  expect(bridge).toContain('confirmation.value!==passphrase');
  expect(bridge).toContain('const vault=await OfflineVault.unlock(passphrase)');
  expect(bridge).toContain('password.value=""');
  expect(bridge).toContain('confirmation.value=""');
  expect(bridge).toContain('await offlineAssetsReady()');
  expect(bridge).toContain('await vault.updateCatalog(catalog)');
 });
 it("pre-caches only the standalone offline POS shell, never business API data",()=>{
  const events={};
  const requests=[];
  const context={
   self:{registration:{scope:"https://rainbowgoldcovering.com/admin/"},
    location:{origin:"https://rainbowgoldcovering.com"},
    addEventListener:(name,fn)=>events[name]=fn,skipWaiting(){},clients:{claim(){}}},
   caches:{open:async()=>({addAll:async urls=>{requests.push(...urls);},match:async()=>({text:"cached"})}),
    keys:async()=>[]},
   fetch:async()=>{throw Error("network down");},
   URL,Response:{error:()=>({error:true})}
  };
  runInNewContext(read("admin/service-worker.js"),context);
  let reply;
  events.install({waitUntil:p=>{reply=p;}});
  return reply.then(()=>{
   expect(requests.some(x=>x.endsWith("/offline-pos.html"))).toBe(true);
   expect(requests.some(x=>x.includes("orders"))).toBe(false);
   expect(requests.some(x=>x.includes("invoices"))).toBe(false);
   const req={method:"GET",url:"https://rainbowgoldcovering.com/admin/billing.html",mode:"navigate"};
   events.fetch({request:req,respondWith:p=>{reply=p;}});
   return reply.then(x=>expect(x.text).toBe("cached"));
  });
 });
 it("never issues a final invoice number or pretends to charge a card offline",()=>{
  const html=read("admin/offline-pos.html");
  const app=read("admin/offline-pos.mjs");
  expect(html).toContain("Cash only.");
  expect(html).toContain('id="cashCollected"');
  expect(app).toContain('!$("cashCollected").checked');
  expect(app).toContain("PENDING SYNC");
  expect(html).toContain("Cash only.");
  expect(app).toContain("NOT A TAX INVOICE");
  expect(app).toContain("vault.queue");
  expect(app).toContain('window.addEventListener("online"');
  expect(app).not.toContain("payment_method:\"card\"");
 });
});
