/* Encrypted, device-local offline POS data. Never store credentials, payment tokens or raw customer records. */
const DATABASE="rainbow-staff-pos-offline-v1",STORE="vault",KEY="staff-v1";
export const OFFLINE_MAX_AGE_MS=24*60*60*1000;
export const OFFLINE_MAX_PENDING=150;
export const SHARED_SHOP_ACCESS_MODE="admin-shared-passcode-v2";
const encoder=new TextEncoder(),decoder=new TextDecoder();
const toBase64=bytes=>btoa(String.fromCharCode(...bytes));
const fromBase64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const roundMoney=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const clone=value=>JSON.parse(JSON.stringify(value));

function openDatabase(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
  request.onerror=()=>reject(request.error||new Error("Offline storage cannot open."));
  request.onsuccess=()=>resolve(request.result);
 });
}
async function recordRead(){
 const db=await openDatabase();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,"readonly"),request=tx.objectStore(STORE).get(KEY);
  request.onsuccess=()=>resolve(request.result||null);
  request.onerror=()=>reject(request.error);
  tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(tx.error);};
 });
}
async function recordSave(value){
 const db=await openDatabase();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,"readwrite");
  tx.objectStore(STORE).put(value,KEY);
  tx.oncomplete=()=>{db.close();resolve();};
  tx.onabort=()=>{db.close();reject(tx.error||new Error("Offline storage could not save."));};
  tx.onerror=()=>{db.close();reject(tx.error||new Error("Offline storage failed."));};
 });
}
async function derive(passphrase,salt){
 const base=await crypto.subtle.importKey("raw",encoder.encode(passphrase),"PBKDF2",false,["deriveKey"]);
 return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:310000,hash:"SHA-256"},base,
  {name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encrypt(payload,key,salt){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(JSON.stringify(payload)));
 return {version:1,salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(ciphertext))};
}
async function decrypt(record,key){
 if(record?.version!==1)throw new Error("Offline record format is unsupported.");
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64(record.iv)},key,fromBase64(record.ciphertext));
 const data=JSON.parse(decoder.decode(plain));
 if(!data?.userId||!data?.locationId||!Array.isArray(data.pending)||!Array.isArray(data.catalog))
  throw new Error("Offline data is incomplete.");
 return data;
}
async function lockedUpdate(work){
 if(navigator?.locks?.request)return navigator.locks.request("rainbow-staff-offline-pos",work);
 return work(); // Older browsers may not support Web Locks; use a single staff POS tab.
}
export function offlineTotals(rows){
 const subtotal=roundMoney(rows.reduce((sum,item)=>sum+Number(item.unitPrice||0)*Number(item.quantity||0),0));
 const discount=roundMoney(subtotal*0.03);
 const taxable=roundMoney(subtotal-discount);
 const cgst=roundMoney(taxable*0.015),sgst=roundMoney(taxable*0.015);
 return {subtotal,discount,cgst,sgst,total:roundMoney(taxable+cgst+sgst)};
}
export function sanitizeOfflineCatalog(products){
 return (products||[]).filter(p=>p.active!==false&&Number(p.selling_price)>0).slice(0,1500).map(p=>({
  id:String(p.id),product_code:String(p.product_code||"").slice(0,100),
  product_name:String(p.product_name||"").slice(0,200),
  type:String(p.type||"").slice(0,100),selling_price:Number(p.selling_price),
  product_variants:(p.product_variants||[]).filter(v=>v.active!==false&&Number(v.stock_quantity)>0).map(v=>({
   id:String(v.id),barcode:String(v.barcode||"").slice(0,120),active:true,
   color:String(v.color||"0").slice(0,40),size:String(v.size||"0").slice(0,40),
   stock_quantity:Math.max(0,Math.floor(Number(v.stock_quantity)||0))
  }))
 })).filter(p=>p.product_variants.length>0);
}
export function makePendingSale(state,lines,customer,now=Date.now(),id=crypto.randomUUID(),operator=""){
 if(now>Number(state.expiresAt))throw new Error("Offline access expired. Reconnect and refresh this device.");
 if(state.pending.filter(s=>s.status!=="synced").length>=OFFLINE_MAX_PENDING)
  throw new Error("Offline queue is full. Reconnect and synchronize before continuing.");
 const qtyUsed=new Map();
 for(const sale of state.pending.filter(s=>s.status!=="synced")){
  for(const item of sale.items||[])qtyUsed.set(item.variant_id,(qtyUsed.get(item.variant_id)||0)+item.quantity);
 }
 const items=[],rows=[],seen=new Set();
 for(const line of lines){
  const variantId=String(line.variant_id||"");
  if(seen.has(variantId))throw new Error("Duplicate product option in bill.");
  seen.add(variantId);
  const qty=Number(line.quantity);
  if(!Number.isSafeInteger(qty)||qty<1||qty>1000)throw new Error("Invalid sale quantity.");
  const product=state.catalog.find(p=>p.product_variants.some(v=>v.id===variantId));
  const variant=product?.product_variants.find(v=>v.id===variantId);
  if(!variant)throw new Error("Product is unavailable in the saved offline catalogue.");
  if(qty+(qtyUsed.get(variantId)||0)>variant.stock_quantity)
   throw new Error("Not enough unsold offline stock for "+product.product_code+".");
  items.push({variant_id:variantId,quantity:qty});
  rows.push({variant_id:variantId,product_id:product.id,product_code:product.product_code,
   product_name:product.product_name,variant_color:variant.color,variant_size:variant.size,
   unitPrice:product.selling_price,quantity:qty});
 }
 if(!items.length)throw new Error("Add products before saving an offline sale.");
 const cleanCustomer={
  name:String(customer?.name||"").trim().slice(0,120),
  whatsapp_number:String(customer?.whatsapp_number||"").trim().slice(0,20),
  email:String(customer?.email||"").trim().slice(0,254),
  pin_code:String(customer?.pin_code||"").trim().slice(0,6),
  city:String(customer?.city||"").trim().slice(0,120),
  state:String(customer?.state||"").trim().slice(0,100),
  address:String(customer?.address||"").trim().slice(0,600)
 };
 return {id,createdAt:new Date(now).toISOString(),locationId:state.locationId,userId:state.userId,
  // The admin provisions the device, but authorized shop staff can record sales
  // while disconnected. An online staff account is checked when each sale syncs.
  accessMode:SHARED_SHOP_ACCESS_MODE,syncActorId:null,
  operator:String(operator||"").trim().slice(0,80),
  items,rows,customer:cleanCustomer,payment_method:"cash",
  totals:offlineTotals(rows),status:"pending",lastError:""};
}
export class OfflineVault{
 constructor(key,salt){this.key=key;this.salt=salt;}
 static async exists(){return !!(await recordRead());}
 static async create(passphrase,info){
  if(typeof passphrase!=="string"||passphrase.length<10)throw new Error("Use an offline passphrase of at least 10 characters.");
  if(await recordRead())throw new Error("Offline billing was already prepared on this device. Open it and unlock instead.");
  if(!info.userId||!info.locationId||!Array.isArray(info.catalog))throw new Error("Shop access and products are required.");
  const salt=crypto.getRandomValues(new Uint8Array(16)),key=await derive(passphrase,salt);
  const vault=new OfflineVault(key,salt);
  const data={version:1,userId:info.userId,locationId:info.locationId,
   locationName:String(info.locationName||"Branch"),createdAt:Date.now(),
   expiresAt:Date.now()+OFFLINE_MAX_AGE_MS,lastSnapshotAt:Date.now(),
   catalog:sanitizeOfflineCatalog(info.catalog),pending:[],synced:[]};
  if(!data.catalog.length)throw new Error("There are no stocked products to save for offline billing.");
  await recordSave(await encrypt(data,key,salt));
  return vault;
 }
 static async unlock(passphrase){
  const record=await recordRead();if(!record)throw new Error("Offline billing has not been prepared on this device.");
  try{const salt=fromBase64(record.salt),key=await derive(passphrase,salt);
   await decrypt(record,key);return new OfflineVault(key,salt);
  }catch{throw new Error("Incorrect offline passphrase or damaged offline data.");}
 }
 async read(){return decrypt(await recordRead(),this.key);}
 async mutate(callback){
  return lockedUpdate(async()=>{
   const data=await this.read();
   const next=clone(data),result=await callback(next);
   await recordSave(await encrypt(next,this.key,this.salt));
   return result;
  });
 }
 async queue(items,customer,operator=""){
  return this.mutate(data=>{
   const sale=makePendingSale(data,items,customer,Date.now(),crypto.randomUUID(),operator);
   data.pending.push(sale);
   return sale;
  });
 }
 async retryPhoneRejectedSales(){
  return this.mutate(data=>{
   for(const sale of data.pending){
    // Recover only the former database rejection of an optional blank phone.
    // Keep the original payload, request ID and authenticated sync actor.
    if(sale.status==="needs_review"&&!String(sale.customer?.whatsapp_number||"").trim()&&
      sale.lastError==='null value in column "whatsapp_number" of relation "customers" violates not-null constraint'){
     sale.status="pending";
     sale.lastError="";
    }
   }
  });
 }
 async claimSyncActor(id,actorId){
  // The PostgreSQL POS RPC stores actor_id alongside the idempotency UUID.
  // Pin the first authenticated sync actor BEFORE sending the RPC, so a retry
  // after a network outage can only use that same account and request ID.
  return this.mutate(data=>{
   const sale=data.pending.find(item=>item.id===id);
   if(!sale||sale.status!=="pending")throw new Error("Offline record is no longer pending.");
   if(sale.accessMode!==SHARED_SHOP_ACCESS_MODE)
    throw new Error("Legacy offline record must be submitted by its original staff account.");
   if(sale.syncActorId&&sale.syncActorId!==actorId)
    throw new Error("This cash record was first submitted by another staff account. Sign in with that account to retry.");
   sale.syncActorId=actorId;
   return sale.syncActorId;
  });
 }
 async markSynced(id,receipt){
  return this.mutate(data=>{
   const sale=data.pending.find(s=>s.id===id);
   if(!sale)throw new Error("Offline sale disappeared before confirmation.");
   if(sale.status==="synced")return sale;
   sale.status="synced";sale.receipt=receipt;sale.lastError="";
   // Keep the local availability conservative if the server succeeded but
   // the next online stock-refresh could not complete.
   for(const item of sale.items){
    const product=data.catalog.find(p=>p.product_variants.some(v=>v.id===item.variant_id));
    const variant=product?.product_variants.find(v=>v.id===item.variant_id);
    if(variant)variant.stock_quantity=Math.max(0,variant.stock_quantity-item.quantity);
   }
   data.synced.push({id,invoice_number:receipt.invoice_number,order_number:receipt.order_number});
   return sale;
  });
 }
 async markReview(id,reason){
  return this.mutate(data=>{
   const sale=data.pending.find(s=>s.id===id);
   if(sale?.status==="pending"){sale.status="needs_review";sale.lastError=String(reason||"Requires review").slice(0,250);}
  });
 }
 async updateCatalog(products){
  return this.mutate(data=>{
   data.catalog=sanitizeOfflineCatalog(products);
   data.lastSnapshotAt=Date.now();
   data.expiresAt=Date.now()+OFFLINE_MAX_AGE_MS;
  });
 }
}
