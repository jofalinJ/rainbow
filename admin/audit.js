/* Owner-only read-only operational audit. RLS is the authoritative permission gate. */
const auditStatus=document.getElementById("auditStatus");
const auditRows=document.getElementById("auditRows");
const auditReload=document.getElementById("reloadAudit");
const auditFilter=document.getElementById("auditType");
function auditCell(row,value,code=false){
 const td=document.createElement("td");
 if(code){
  const tag=document.createElement("code");
  tag.textContent=String(value??"—");
  td.append(tag);
 }else td.textContent=String(value??"—");
 row.append(td);
}
function renderAuditEvents(events){
 const rows=[];
 for(const event of events){
  const tr=document.createElement("tr");
  const when=new Date(event.occurred_at);
  auditCell(tr,Number.isNaN(when.getTime())?"Unknown":when.toLocaleString("en-IN"));
  auditCell(tr,String(event.entity_type||"")+" · "+String(event.event_type||""));
  auditCell(tr,event.entity_id,true);
  auditCell(tr,event.actor_id?String(event.actor_id).slice(0,8)+"…":"System / unspecified");
  // Deliberately bounded and text-only; never put untrusted JSON into innerHTML.
  const safeDetails=Object.fromEntries(
   Object.entries(event.detail&&typeof event.detail==="object"?event.detail:{})
    .filter(([k])=>["price","old_price","new_price","active","was_active",
      "archived","was_archived","published","was_published","online_price",
      "old_online_price","role","old_role","location_id","variant_id","delta"].includes(k))
  );
  auditCell(tr,JSON.stringify(safeDetails).slice(0,350),true);
  rows.push(tr);
 }
 if(!rows.length){
  const tr=document.createElement("tr"),td=document.createElement("td");
  td.colSpan=5;td.textContent="No matching audit events yet.";
  tr.append(td);rows.push(tr);
 }
 auditRows.replaceChildren(...rows);
}
async function loadAuditEvents(){
 if(!auditRows||!auditStatus)return;
 if(auditReload)auditReload.disabled=true;
 auditStatus.textContent="Loading owner audit history…";
 try{
  const profile=await getMyProfile();
  if(profile.role!=="admin")throw new Error("Only an active owner can view operational audit history.");
  let query=bootSupabase().from("admin_audit_events")
   .select("id,occurred_at,actor_id,entity_type,entity_id,event_type,detail")
   .order("occurred_at",{ascending:false}).order("id",{ascending:false}).limit(200);
  const type=auditFilter?.value||"";
  if(type)query=query.eq("entity_type",type);
  const {data,error}=await query;
  if(error)throw error;
  renderAuditEvents(Array.isArray(data)?data:[]);
  auditStatus.textContent="Read-only history · "+(data||[]).length+" recent matching event(s).";
 }catch(error){
  auditRows.replaceChildren();
  const tr=document.createElement("tr"),td=document.createElement("td");
  td.colSpan=5;
  td.textContent="Audit history unavailable. It may not have been installed yet.";
  tr.append(td);auditRows.append(tr);
  auditStatus.textContent=String(error?.message||"Audit history could not be loaded.");
 }finally{if(auditReload)auditReload.disabled=false;}
}
auditReload?.addEventListener("click",()=>{void loadAuditEvents();});
auditFilter?.addEventListener("change",()=>{void loadAuditEvents();});
document.addEventListener("DOMContentLoaded",async()=>{
 try{
  const profile=await window.rainbowSidebarReady;
  if(profile?.role==="admin")await loadAuditEvents();
 }catch{
  if(auditStatus)auditStatus.textContent="Sign in as the owner to view history.";
 }
});
