const $bl=id=>document.getElementById(id);
let bills=[];

function escBl(x){return String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));}
function moneyBl(v){return "₹"+Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
function digitsOnly(x){return String(x??"").replace(/\D/g,"");}
function whatsappNumber(phone){
  const raw=digitsOnly(phone);
  if(!raw)return "";
  if(raw.length===10)return "91"+raw;
  if(raw.length===12&&raw.startsWith("91"))return raw;
  return raw;
}
function billLink(token,print=false){return "invoice.html?token="+encodeURIComponent(token)+(print?"&print=1":"");}
function whatsappBill(bill){
  const phone=whatsappNumber(bill.phone);
  if(!phone){setBillMsg("This bill has no customer WhatsApp number.","error");return;}
  const url=new URL(billLink(bill.public_token),location.href).href;
  const text=[
    "Hello "+(bill.customer_name||"Customer")+",",
    "Thank you for shopping with JJ GOLD COVERING.",
    "Invoice: "+bill.invoice_number,
    "Order: "+bill.order_number,
    "Amount: "+moneyBl(bill.total_amount),
    "Bill: "+url
  ].join("\n");
  window.open("https://wa.me/"+phone+"?text="+encodeURIComponent(text),"_blank","noopener,noreferrer");
}
function renderBills(){
  const q=($bl("billSearch").value||"").trim().toLowerCase();
  const status=$bl("billStatus").value;
  const filtered=bills.filter(b=>{
    const hay=[b.invoice_number,b.order_number,b.customer_name,b.phone].map(x=>String(x??"").toLowerCase());
    return (!q||hay.some(x=>x.includes(q)))&&(status==="all"||b.status===status);
  });
  $bl("billCount").textContent=filtered.length+" bill"+(filtered.length===1?"":"s");
  $bl("billTotal").textContent=moneyBl(filtered.reduce((s,b)=>s+Number(b.total_amount||0),0))+" billed";
  $bl("billRows").innerHTML=filtered.map(b=>{
    const date=b.created_at?new Date(b.created_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}):"—";
    const phone=b.phone||"—";
    return "<tr>"+
      "<td><b>"+escBl(b.invoice_number)+"</b><small class='muted'>"+escBl(b.order_number)+"</small></td>"+
      "<td>"+escBl(date)+"</td>"+
      "<td>"+escBl(b.customer_name||"Walk-in Customer")+"</td>"+
      "<td>"+escBl(phone)+"</td>"+
      "<td><b>"+moneyBl(b.total_amount)+"</b></td>"+
      "<td><span class='bill-status'>"+escBl(b.status)+"</span></td>"+
      "<td><div class='bill-actions'>"+
      "<button type='button' data-view='"+escBl(b.public_token)+"'>View</button>"+
      "<button type='button' data-print='"+escBl(b.public_token)+"'>Print</button>"+
      "<button type='button' class='wa-btn' data-wa='"+escBl(b.public_token)+"'>WhatsApp</button>"+
      "</div></td>"+
      "</tr>";
  }).join("")||"<tr><td colspan='7' class='empty'>No bills found.</td></tr>";
  document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>window.open(billLink(btn.dataset.view),"_"+btn.dataset.view)));
  document.querySelectorAll("[data-print]").forEach(btn=>btn.addEventListener("click",()=>window.open(billLink(btn.dataset.print,true),"_print_"+btn.dataset.print)));
  document.querySelectorAll("[data-wa]").forEach(btn=>btn.addEventListener("click",()=>{
    const bill=bills.find(x=>x.public_token===btn.dataset.wa);
    if(bill)whatsappBill(bill);
  }));
}
function setBillMsg(message,tone=""){
  const el=$bl("billMsg");el.textContent=message;el.className="form-msg "+tone;
}
async function loadBills(){
  setBillMsg("Loading bills…");
  try{
    const rows=await sb("invoices?select=invoice_number,public_token,issued_at,orders(order_number,created_at,total_amount,status,customers(name,whatsapp_number))&order=issued_at.desc&limit=500");
    bills=(rows||[]).map(x=>({
      invoice_number:x.invoice_number,
      public_token:x.public_token,
      issued_at:x.issued_at,
      order_number:x.orders?.order_number||"",
      created_at:x.orders?.created_at||x.issued_at,
      total_amount:Number(x.orders?.total_amount||0),
      status:x.orders?.status||"confirmed",
      customer_name:x.orders?.customers?.name||"Walk-in Customer",
      phone:x.orders?.customers?.whatsapp_number||""
    }));
    renderBills();
    setBillMsg("");
  }catch(e){
    console.error(e);
    setBillMsg("Could not load bills: "+(e.message||"Unknown error"),"error");
    $bl("billRows").innerHTML="<tr><td colspan='7' class='empty'>Unable to load bills.</td></tr>";
  }
}
$bl("billSearch").addEventListener("input",renderBills);
$bl("billStatus").addEventListener("change",renderBills);
$bl("refreshBills").addEventListener("click",loadBills);
requireSession().then(loadBills).catch(e=>setBillMsg(e.message||"Please sign in.","error"));
