const $bl=id=>document.getElementById(id);
let bills=[];
let currentBill=null;
let billPage=0,billTotalMatches=0,billMatchingAmount=0,billRevision=0,billSearchTimer=null;
const BILL_PAGE_SIZE=50;

function escBl(x){return String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));}
function moneyBl(v){return "₹"+Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
function billLink(token,print=false){return "../invoice.html?token="+encodeURIComponent(token)+(print?"&print=1":"");}

function setBillMsg(message,tone=""){
  const el=$bl("billMsg");el.textContent=message;el.className="form-msg "+tone;
}
function setToast(message,tone=""){
  const el=$bl("billToast");el.textContent=message;el.className="bill-toast "+tone;
}

function renderBills(){
  const filtered=bills;
  $bl("billCount").textContent=billTotalMatches+" matching bills";
  $bl("billTotal").textContent=moneyBl(billMatchingAmount)+" billed across matching results";
  $bl("billRows").innerHTML=filtered.map(b=>{
    const date=b.created_at?new Date(b.created_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}):"—";
    return "<tr><td><b>"+escBl(b.invoice_number)+"</b><small class='muted'>"+escBl(b.order_number)+"</small></td>"+
      "<td>"+escBl(date)+"</td><td>"+escBl(b.customer_name||"Walk-in Customer")+"</td><td>"+escBl(b.phone||"—")+"</td>"+
      "<td><b>"+moneyBl(b.total_amount)+"</b></td><td><span class='bill-status'>"+escBl(b.status)+"</span></td>"+
      "<td><div class='bill-actions'><button type='button' data-view='"+escBl(b.public_token)+"'>View</button>"+
      "<button type='button' data-print='"+escBl(b.public_token)+"'>Print</button>"+
      "<button type='button' class='pdf-btn' data-pdf='"+escBl(b.public_token)+"'>Create PDF</button>"+
      "<button type='button' class='wa-btn' data-wa='"+escBl(b.public_token)+"'>WhatsApp PDF</button></div></td></tr>";
  }).join("")||"<tr><td colspan='7' class='empty'>No bills found.</td></tr>";

  document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>openBillPreview(btn.dataset.view)));
  document.querySelectorAll("[data-print]").forEach(btn=>btn.addEventListener("click",()=>printBill(btn.dataset.print)));
  document.querySelectorAll("[data-pdf]").forEach(btn=>btn.addEventListener("click",()=>createAndDownloadPdf(btn.dataset.pdf)));
  document.querySelectorAll("[data-wa]").forEach(btn=>btn.addEventListener("click",()=>sendWhatsAppPdf(btn.dataset.wa)));
}

async function fetchBill(token){
  const {data,error}=await bootSupabase().rpc("get_public_invoice",{p_token:token});
  if(error)throw error;
  if(!data)throw new Error("Bill not found or no longer available.");
  return data;
}

async function openBillPreview(token){
  try{
    setBillMsg("Loading bill…");
    const data=await fetchBill(token);
    currentBill={token,data};
    RainbowInvoice.render(data,$bl("billPreview"));
    $bl("billModalMeta").textContent=data.invoice_number+" • "+data.order_number;
    $bl("billModal").classList.add("open");
    $bl("billModal").setAttribute("aria-hidden","false");
    setToast("");
    setBillMsg("");
  }catch(e){
    console.error(e);
    setBillMsg("Could not open bill: "+(e.message||"Unknown error"),"error");
  }
}

function closeBillModal(){
  currentBill=null;
  $bl("billModal").classList.remove("open");
  $bl("billModal").setAttribute("aria-hidden","true");
  $bl("billPreview").innerHTML="";
  setToast("");
}
async function printBill(token){
  await openBillPreview(token);
  if(currentBill)setTimeout(()=>window.print(),150);
}

async function createAndDownloadPdf(token){
  try{
    setBillMsg("Creating PDF…");
    const data=await fetchBill(token);
    const pdf=await RainbowBillPdf.fromData(data,$bl("pdfStage"));
    pdf.save("RAINBOW-GOLD-COVERING-"+data.invoice_number+".pdf");
    setBillMsg("PDF created.","success");
  }catch(e){
    console.error(e);
    setBillMsg("Could not create PDF: "+(e.message||"Unknown error"),"error");
  }
}
async function sendWhatsAppPdf(token){
  const button=[...document.querySelectorAll("[data-wa]")].find(x=>x.dataset.wa===token);
  if(button)button.disabled=true;
  try{
    setBillMsg("Generating bill PDF…");
    const data=await fetchBill(token);
    const pdf=await RainbowBillPdf.fromData(data,$bl("pdfStage"));
    const pdfBase64=RainbowBillPdf.bufferToBase64(pdf.output("arraybuffer"));
    const session=await requireSession();
    const response=await fetch(SUPABASE_URL+"/functions/v1/send-whatsapp-bill",{
      method:"POST",
      headers:{apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
      body:JSON.stringify({invoice_token:token,pdf_base64:pdfBase64,filename:"JJ-GOLD-COVERING-"+data.invoice_number+".pdf"})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"WhatsApp bill could not be sent.");
    setBillMsg("WhatsApp PDF sent for "+data.invoice_number,"success");
    if(currentBill)setToast("WhatsApp PDF sent successfully.","success");
  }catch(e){
    console.error(e);
    setBillMsg(e.message||"Could not send WhatsApp PDF.","error");
    if(currentBill)setToast(e.message||"Could not send WhatsApp PDF.","error");
  }finally{
    if(button)button.disabled=false;
  }
}

$bl("closeBillModal").addEventListener("click",closeBillModal);
$bl("billModal").addEventListener("click",e=>{if(e.target===e.currentTarget)closeBillModal();});
$bl("modalPrint").addEventListener("click",()=>currentBill&&window.print());
$bl("modalPdf").addEventListener("click",()=>currentBill&&createAndDownloadPdf(currentBill.token));
$bl("modalWhatsApp").addEventListener("click",()=>currentBill&&sendWhatsAppPdf(currentBill.token));
$bl("refreshBills").addEventListener("click",()=>loadBills());
$bl("billSearch").addEventListener("input",()=>{
  clearTimeout(billSearchTimer);
  billSearchTimer=setTimeout(()=>loadBills({reset:true}),250);
});
$bl("billStatus").addEventListener("change",()=>loadBills({reset:true}));
$bl("billPrev")?.addEventListener("click",()=>{if(billPage>0){billPage--;loadBills();}});
$bl("billNext")?.addEventListener("click",()=>{if((billPage+1)*BILL_PAGE_SIZE<billTotalMatches){billPage++;loadBills();}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$bl("billModal").classList.contains("open"))closeBillModal();});

async function loadBills({reset=false}={}){
  if(reset)billPage=0;
  const revision=++billRevision;
  setBillMsg("Loading bills…");
  try{
    const {data,error}=await bootSupabase().rpc("search_shop_bills",{
      p_search:$bl("billSearch").value.trim().slice(0,100),
      p_status:$bl("billStatus").value,
      p_offset:billPage*BILL_PAGE_SIZE,
      p_limit:BILL_PAGE_SIZE
    });
    if(error)throw error;
    if(revision!==billRevision)return;
    billTotalMatches=Number(data?.total||0);
    billMatchingAmount=Number(data?.total_amount||0);
    bills=Array.isArray(data?.rows)?data.rows:[];
    if(!bills.length&&billPage>0){billPage=Math.max(0,billPage-1);return loadBills();}
    renderBills();
    const info=$bl("billPageInfo");
    if(info)info.textContent=billTotalMatches
      ?"Page "+(billPage+1)+" of "+Math.ceil(billTotalMatches/BILL_PAGE_SIZE)
      :"No matching bills";
    if($bl("billPrev"))$bl("billPrev").disabled=billPage===0;
    if($bl("billNext"))$bl("billNext").disabled=(billPage+1)*BILL_PAGE_SIZE>=billTotalMatches;
    setBillMsg("");
  }catch(e){
    if(revision!==billRevision)return;
    console.error(e);
    setBillMsg("Could not load bills: "+(e.message||"Unknown error"),"error");
    $bl("billRows").innerHTML="<tr><td colspan='7' class='empty'>Unable to load bills.</td></tr>";
  }
}
requireSession().then(()=>loadBills()).catch(e=>setBillMsg(e.message||"Please sign in.","error"));
