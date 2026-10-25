const customersClient=bootSupabase();
let customerRecords=[];
let customerPage=0,customerTotal=0,customerRevision=0,customerSearchTimer=null;
const CUSTOMER_PAGE_SIZE=50;
const customerEsc=value=>String(value??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
function customerDate(value){if(!value)return "—";const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleDateString("en-IN");}
function renderCustomers(){
  const matched=customerRecords;
  const rows=document.querySelector("#customerRows");
  if(!rows)return;
  rows.innerHTML=matched.map(c=>"<tr><td><button type='button' class='customer-open' data-customer-id='"+customerEsc(c.id)+"'>"+customerEsc(c.name||"Unnamed customer")+" <span aria-hidden='true'>↗</span></button></td><td>"+customerEsc(c.whatsapp_number||"—")+"</td><td>"+customerEsc(c.email||"—")+"</td><td>"+customerEsc([c.city,c.state,c.pin_code].filter(Boolean).join(", ")||"—")+"</td><td>"+customerEsc(customerDate(c.created_at))+"</td></tr>").join("")||"<tr><td colspan='5'>No customers match this search.</td></tr>";
  rows.querySelectorAll("[data-customer-id]").forEach(button=>button.addEventListener("click",()=>openCustomerDetails(button.dataset.customerId)));
}
async function loadCustomers({reset=false}={}){
  if(reset)customerPage=0;
  const revision=++customerRevision;
  const button=document.querySelector("#refreshCustomers"),rows=document.querySelector("#customerRows"),message=document.querySelector("#customerMessage");
  if(button){button.disabled=true;button.textContent="Refreshing…";}
  if(rows)rows.innerHTML="<tr><td colspan='5'>Loading customers…</td></tr>";
  if(message)message.textContent="";
  try{
    const q=document.querySelector("#customerSearch").value.trim().slice(0,70)
      .replace(/[%_,().\\]/g," ").trim();
    let query=customersClient.from("customers")
      .select("id,name,whatsapp_number,email,address,city,state,pin_code,created_at",{count:"exact"})
      .order("created_at",{ascending:false})
      .range(customerPage*CUSTOMER_PAGE_SIZE,(customerPage+1)*CUSTOMER_PAGE_SIZE-1);
    if(q)query=query.or(["name","whatsapp_number","email","city","state","pin_code"]
      .map(field=>field+".ilike.%"+q+"%").join(","));
    const {data,error,count}=await query;
    if(error)throw error;
    if(revision!==customerRevision)return;
    customerRecords=Array.isArray(data)?data:[];
    customerTotal=Number(count||0);
    if(!customerRecords.length&&customerPage>0){customerPage--;return loadCustomers();}
    renderCustomers();
    const info=document.querySelector("#customerPageInfo");
    if(info)info.textContent=customerTotal
      ?"Page "+(customerPage+1)+" of "+Math.ceil(customerTotal/CUSTOMER_PAGE_SIZE)
      :"No matching customers";
    const previous=document.querySelector("#customerPrev");
    const next=document.querySelector("#customerNext");
    if(previous)previous.disabled=customerPage===0;
    if(next)next.disabled=(customerPage+1)*CUSTOMER_PAGE_SIZE>=customerTotal;
    if(message)message.textContent=customerTotal+" matching customers.";
  }catch(error){
    if(revision!==customerRevision)return;
    console.error("Customer list failed to load",error);
    if(rows)rows.innerHTML="<tr><td colspan='5'>Could not load customers: "+customerEsc(error?.message||"Check your staff permissions.")+"</td></tr>";
    if(message){message.className="form-msg error";message.textContent="Customer loading failed. Use Refresh to retry.";}
  }finally{
    if(revision===customerRevision&&button){button.disabled=false;button.textContent="Refresh";}
  }
}
let customerDetailsSerial=0;
async function openCustomerDetails(id){
  const customer=customerRecords.find(row=>String(row.id)===String(id));
  const dialog=document.getElementById("customerDetails"),body=document.getElementById("customerDetailsBody");
  if(!customer||!dialog||!body)return;
  const seq=++customerDetailsSerial;
  const location=[customer.address,customer.city,customer.state,customer.pin_code].filter(Boolean).join(", ")||"—";
  document.getElementById("customerDetailsHeading").textContent=customer.name||"Customer";
  body.innerHTML="<div class='customer-detail-summary'>"+
    "<div><small>WhatsApp</small><strong>"+customerEsc(customer.whatsapp_number||"—")+"</strong></div>"+
    "<div><small>Email</small><strong>"+customerEsc(customer.email||"—")+"</strong></div>"+
    "<div><small>Address</small><strong>"+customerEsc(location)+"</strong></div>"+
    "<div><small>Customer since</small><strong>"+customerEsc(customerDate(customer.created_at))+"</strong></div></div>"+
    "<h3>Order and billing history</h3><p class='customer-history-status'>Loading saved orders and invoices…</p>";
  if(!dialog.open)dialog.showModal();
  try{
    const {data,error}=await customersClient.from("orders")
      .select("id,order_number,source,created_at,status,payment_status,total_amount,invoices:invoices!invoices_order_id_fkey(invoice_number,public_token,issued_at)")
      .eq("customer_id",customer.id).order("created_at",{ascending:false}).limit(100);
    if(seq!==customerDetailsSerial||!dialog.open)return;
    if(error)throw error;
    const orders=Array.isArray(data)?data:[];
    const bills=orders.flatMap(order=>(Array.isArray(order.invoices)?order.invoices:order.invoices?[order.invoices]:[])
      .filter(invoice=>invoice.invoice_number)
      .map(invoice=>({...invoice,order_number:order.order_number,total_amount:order.total_amount})));
    const counts=document.createElement("p");
    counts.className="customer-history-status";
    counts.textContent="Latest "+orders.length+" orders · "+bills.length+" invoices (up to 100 orders)";
    const heading=document.createElement("h3");heading.textContent="Order and billing history";
    const list=document.createElement("div");list.className="customer-order-history";
    if(!orders.length){
      const empty=document.createElement("p");empty.className="customer-history-status";
      empty.textContent="No orders or invoices are linked to this customer yet.";
      list.append(empty);
    }
    for(const order of orders){
      const card=document.createElement("article");card.className="customer-order-entry";
      const top=document.createElement("div");top.className="customer-order-top";
      const title=document.createElement("strong");title.textContent=order.order_number||"Order";
      const amount=document.createElement("strong");
      amount.textContent="₹"+Number(order.total_amount||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
      top.append(title,amount);
      const meta=document.createElement("p");meta.className="customer-order-meta";
      meta.textContent=[String(order.source||"").replaceAll("_"," "),customerDate(order.created_at),
        "Order: "+String(order.status||"pending"),"Payment: "+String(order.payment_status||"pending")].join(" · ");
      card.append(top,meta);
      const invoices=Array.isArray(order.invoices)?order.invoices:order.invoices?[order.invoices]:[];
      for(const invoice of invoices){
        const item=document.createElement("div");item.className="customer-bill-link";
        const label=document.createElement("span");label.textContent="Bill "+invoice.invoice_number;
        item.append(label);
        if(invoice.public_token){
          const link=document.createElement("a");
          link.href="../invoice.html?token="+encodeURIComponent(invoice.public_token);
          link.target="_blank";link.rel="noopener noreferrer";
          link.textContent="View invoice ↗";item.append(link);
        }
        card.append(item);
      }
      list.append(card);
    }
    body.replaceChildren(body.querySelector(".customer-detail-summary"),heading,counts,list);
  }catch(error){
    if(seq!==customerDetailsSerial)return;
    console.error("Customer history lookup failed",error?.code||"");
    const node=body.querySelector(".customer-history-status");
    if(node)node.textContent="Unable to load billing history. Try closing and reopening this customer.";
  }
}
document.getElementById("customerDetailsClose")?.addEventListener("click",()=>{
  customerDetailsSerial++;document.getElementById("customerDetails")?.close();
});
document.getElementById("customerDetails")?.addEventListener("close",()=>{customerDetailsSerial++;});

document.querySelector("#customerSearch")?.addEventListener("input",()=>{
  clearTimeout(customerSearchTimer);
  customerSearchTimer=setTimeout(()=>loadCustomers({reset:true}),260);
});
document.querySelector("#refreshCustomers")?.addEventListener("click",()=>loadCustomers());
document.querySelector("#customerPrev")?.addEventListener("click",()=>{
  if(customerPage>0){customerPage--;loadCustomers();}
});
document.querySelector("#customerNext")?.addEventListener("click",()=>{
  if((customerPage+1)*CUSTOMER_PAGE_SIZE<customerTotal){customerPage++;loadCustomers();}
});
requireSession().then(()=>loadCustomers()).catch(error=>{
  const rows=document.querySelector("#customerRows");if(rows)rows.innerHTML="<tr><td colspan='5'>"+customerEsc(error?.message||"Please sign in.")+"</td></tr>";
});