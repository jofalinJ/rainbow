const $inv=id=>document.getElementById(id);
function getToken(){return new URLSearchParams(location.search).get("token");}
async function loadInvoice(){
  const token=getToken();
  if(!token){$inv("invoice").innerHTML="<div class='error'>Missing bill link.</div>";return;}
  try{
    const cfg=window.RAINBOW_CONFIG||{};
    if(!window.RainbowInvoice||!window.supabase?.createClient)throw new Error("Invoice dependencies did not load.");
    const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
    const {data,error}=await client.rpc("get_public_invoice",{p_token:token});
    if(error)throw error;
    if(!data){$inv("invoice").innerHTML="<div class='error'>Bill not found or no longer available.</div>";return;}
    RainbowInvoice.render(data,$inv("invoice"));
    $inv("printBtn").onclick=()=>window.print();
    const phone=String(data.customer_phone||"").replace(/\D/g,"");
    const wa=$inv("waBtn");
    if(phone){
      const number=phone.length===10?"91"+phone:phone;
      wa.style.display="inline-block";
      wa.onclick=()=>window.open(
        "https://wa.me/"+number+"?text="+encodeURIComponent("JJ GOLD COVERING bill "+data.invoice_number+" — "+RainbowInvoice.money(data.total_amount)),
        "_blank",
        "noopener,noreferrer"
      );
    }
    if(new URLSearchParams(location.search).get("print")==="1")setTimeout(()=>window.print(),350);
  }catch(e){
    console.error(e);
    $inv("invoice").innerHTML="<div class='error'>Could not load this bill. Please return to Bills and try again.</div>";
  }
}
loadInvoice();
