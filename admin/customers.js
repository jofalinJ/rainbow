const customersClient=bootSupabase();
let customerRecords=[];
const customerEsc=value=>String(value??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
function customerDate(value){if(!value)return "—";const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleDateString("en-IN");}
function renderCustomers(){
  const q=String(document.querySelector("#customerSearch")?.value||"").toLowerCase().trim();
  const matched=customerRecords.filter(c=>[c.name,c.whatsapp_number,c.email,c.city,c.state,c.pin_code].some(v=>String(v??"").toLowerCase().includes(q)));
  const rows=document.querySelector("#customerRows");
  if(!rows)return;
  rows.innerHTML=matched.map(c=>"<tr><td><b>"+customerEsc(c.name||"Unnamed customer")+"</b></td><td>"+customerEsc(c.whatsapp_number||"—")+"</td><td>"+customerEsc(c.email||"—")+"</td><td>"+customerEsc([c.city,c.state,c.pin_code].filter(Boolean).join(", ")||"—")+"</td><td>"+customerEsc(customerDate(c.created_at))+"</td></tr>").join("")||"<tr><td colspan='5'>No customers match this search.</td></tr>";
}
async function loadCustomers(){
  const button=document.querySelector("#refreshCustomers"),rows=document.querySelector("#customerRows"),message=document.querySelector("#customerMessage");
  if(button){button.disabled=true;button.textContent="Refreshing…";}
  if(rows)rows.innerHTML="<tr><td colspan='5'>Loading customers…</td></tr>";
  if(message)message.textContent="";
  const controller=new AbortController();let timer;
  try{
    const request=customersClient.from("customers").select("id,name,whatsapp_number,email,city,state,pin_code,created_at").order("created_at",{ascending:false}).abortSignal(controller.signal);
    const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Customer request timed out. Check your connection and refresh."));},15000);});
    const {data,error}=await Promise.race([request,timeout]);if(error)throw error;
    customerRecords=Array.isArray(data)?data:[];
    renderCustomers();
    if(message)message.textContent=customerRecords.length+" customer"+(customerRecords.length===1?"":"s")+" loaded.";
  }catch(error){
    console.error("Customer list failed to load",error);
    if(rows)rows.innerHTML="<tr><td colspan='5'>Could not load customers: "+customerEsc(error?.message||"Check your staff permissions.")+"</td></tr>";
    if(message){message.className="form-msg error";message.textContent="Customer loading failed. Use Refresh to retry.";}
  }finally{if(timer)clearTimeout(timer);if(button){button.disabled=false;button.textContent="Refresh";}}
}
document.querySelector("#customerSearch")?.addEventListener("input",renderCustomers);
document.querySelector("#refreshCustomers")?.addEventListener("click",loadCustomers);
requireSession().then(loadCustomers).catch(error=>{
  const rows=document.querySelector("#customerRows");if(rows)rows.innerHTML="<tr><td colspan='5'>"+customerEsc(error?.message||"Please sign in.")+"</td></tr>";
});