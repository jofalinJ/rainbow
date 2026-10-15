import {COURIER_NAME,TRACKING_URL,normalizeIndianPhone,dateForMessage,
  formatShipmentMessage,whatsappTrackingUrl,canNotifyShipment,trackingStatus} from "./shipment-utils.mjs";

export function setupShipmentManagement({client,getOrder,role,afterSave}){
  const modal=document.getElementById("shipmentModal");
  if(!modal)return {open:()=>{}};
  const byId=id=>document.getElementById(id);
  const summary=byId("shipmentOrderSummary"),form=byId("shipmentForm");
  const awbInput=byId("shipmentAwb"),dateInput=byId("shipmentDate"),statusInput=byId("shipmentStatus");
  const feedback=byId("shipmentFeedback"),messagePreview=byId("shipmentMessagePreview");
  const history=byId("shipmentNotificationHistory"),stateLabel=byId("shipmentNotifyState");
  const save=byId("shipmentSave"),openWhatsApp=byId("shipmentWhatsapp"),copy=byId("shipmentCopy"),confirm=byId("shipmentConfirm");
  let order=null,shipment=null,notifications=[],actorNames=new Map(),busy=false,openedAwb="",returnFocus=null,requestSerial=0,loadFailed=false;
  const customer=()=>Array.isArray(order?.customers)?order.customers[0]||{}:order?.customers||{};
  function alertMessage(text,error=false){feedback.textContent=text;feedback.className="shipment-feedback "+(error?"is-error":"is-success");}
  const hasConfirmed=()=>!!shipment?.consignment_number&&notifications.some(n=>n.awb_snapshot===shipment.consignment_number);
  function addSummary(label,value){
    const item=document.createElement("div"),small=document.createElement("small"),strong=document.createElement("strong");
    small.textContent=label;strong.textContent=String(value||"—");item.append(small,strong);summary.append(item);
  }
  function render(){
    const name=customer().name||"";
    const phone=customer().whatsapp_number||"";
    const alreadyConfirmed=hasConfirmed();
    const dirty=!!shipment&&(awbInput.value.trim().toUpperCase()!==String(shipment.consignment_number||"")||
      dateInput.value!==String(shipment.dispatch_date||"")||statusInput.value!==shipment.status);
    const canSend=!busy&&!loadFailed&&!dirty&&canNotifyShipment(shipment,phone,alreadyConfirmed);
    let message="";
    if(canSend||alreadyConfirmed){
      try{message=formatShipmentMessage({order_number:order.order_number,customer_name:name},shipment);}
      catch{message="";}
    }
    messagePreview.value=message;
    openWhatsApp.disabled=!canSend||openedAwb===shipment?.consignment_number||!message;
    copy.disabled=!message;
    confirm.disabled=!canSend||openedAwb!==shipment?.consignment_number;
    save.disabled=busy||loadFailed||role()!=="admin"||order?.payment_status!=="paid";
    awbInput.disabled=busy;dateInput.disabled=busy;statusInput.disabled=busy;
    stateLabel.textContent=alreadyConfirmed?"Manually confirmed":shipment?"Not confirmed":"No shipment saved";
    stateLabel.classList.toggle("is-confirmed",alreadyConfirmed);
    const last=notifications.find(n=>n.awb_snapshot===shipment?.consignment_number);
    history.textContent=alreadyConfirmed
      ?"Manually confirmed "+(last?.confirmed_at?new Date(last.confirmed_at).toLocaleString("en-IN"):"")+
        " by "+(actorNames.get(last?.confirmed_by)||"an authorized administrator")+
        ". WhatsApp delivery was not verified."
      :!shipment?"Save the shipment before preparing a WhatsApp message."
       :!normalizeIndianPhone(phone)?"Customer WhatsApp number is missing or invalid."
       :"Open WhatsApp, review and send the message yourself, then return to confirm.";
  }
  async function open(id,invoker){
    if(role()!=="admin"){window.alert("Only an administrator can manage shipments.");return;}
    order=getOrder(id);
    if(!order)return;
    const detail=document.getElementById("modal");
    detail?.classList.remove("open");detail?.setAttribute("aria-hidden","true");
    returnFocus=invoker||document.activeElement;
    const serial=++requestSerial;
    shipment=null;notifications=[];actorNames=new Map();openedAwb="";loadFailed=false;
    summary.replaceChildren();
    addSummary("Order",order.order_number);
    addSummary("Customer",customer().name);
    addSummary("WhatsApp",customer().whatsapp_number);
    addSummary("Delivery address",[order.shipping_address,customer().address,customer().city,
      customer().state,customer().pin_code].filter(Boolean).join(", "));
    addSummary("Payment",order.payment_status);
    awbInput.value="";dateInput.value="";statusInput.value="packed";
    modal.classList.add("open");modal.setAttribute("aria-hidden","false");
    alertMessage("Loading saved shipment…");
    busy=true;render();
    byId("closeShipment").focus();
    try{
      const {data,error}=await client.from("order_shipments")
        .select("id,order_id,courier_provider,consignment_number,dispatch_date,status,updated_at")
        .eq("order_id",order.id).maybeSingle();
      if(error)throw error;
      if(serial!==requestSerial)return;
      shipment=data||null;
      if(shipment){
        const {data:notes,error:noteError}=await client.from("shipment_notifications")
          .select("awb_snapshot,confirmed_at,confirmed_by").eq("shipment_id",shipment.id).order("confirmed_at",{ascending:false});
        if(noteError)throw noteError;
        if(serial!==requestSerial)return;
        notifications=notes||[];
        const ids=[...new Set(notifications.map(item=>item.confirmed_by).filter(Boolean))];
        if(ids.length){
          const {data:profiles,error:profileError}=await client.from("staff_profiles")
            .select("user_id,full_name,username").in("user_id",ids);
          if(serial!==requestSerial)return;
          if(!profileError)actorNames=new Map((profiles||[]).map(p=>[p.user_id,p.full_name||p.username||"Administrator"]));
        }
        awbInput.value=shipment.consignment_number||"";
        dateInput.value=shipment.dispatch_date||"";
        statusInput.value=shipment.status||"packed";
      }
      alertMessage(shipment?"Shipment loaded.":"No shipment saved for this order.");
    }catch(error){
      if(serial!==requestSerial)return;
      loadFailed=true;
      console.error("Shipment fetch failed",error?.code||"");
      alertMessage("Couldn't load shipment details. Please close and try again.",true);
    }finally{if(serial===requestSerial){busy=false;render();}}
  }
  function close(){
    requestSerial++;
    modal.classList.remove("open");modal.setAttribute("aria-hidden","true");
    order=null;shipment=null;notifications=[];actorNames=new Map();openedAwb="";
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    returnFocus=null;
  }
  byId("closeShipment").addEventListener("click",close);
  modal.addEventListener("click",event=>{if(event.target===modal)close();});
  modal.addEventListener("keydown",event=>{
    if(event.key==="Escape"){event.preventDefault();close();return;}
    if(event.key!=="Tab")return;
    const visible=[...modal.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)")]
      .filter(el=>el.getClientRects().length>0);
    if(!visible.length)return;
    if(event.shiftKey&&document.activeElement===visible[0]){event.preventDefault();visible[visible.length-1].focus();}
    else if(!event.shiftKey&&document.activeElement===visible[visible.length-1]){event.preventDefault();visible[0].focus();}
  });
  for(const input of [awbInput,dateInput,statusInput]){
    input.addEventListener("change",()=>{
      if(shipment&&(awbInput.value.trim()!==String(shipment.consignment_number||"")||
        dateInput.value!==String(shipment.dispatch_date||"")||statusInput.value!==shipment.status)){
        openedAwb="";alertMessage("Unsaved changes. Save again before preparing the tracking message.");
      }
    });
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(!order||busy||loadFailed)return;
    busy=true;openedAwb="";render();alertMessage("Saving shipment…");
    try{
      if(!form.reportValidity())return;
      const {data,error}=await client.rpc("save_order_shipment",{
        p_order_id:order.id,p_awb:awbInput.value.trim()||null,
        p_dispatch_date:dateInput.value||null,p_status:statusInput.value
      });
      if(error)throw error;
      shipment=data;
      // Re-read after saving, so a change to the AWB cannot reuse a previous notification.
      const {data:notes,error:noteError}=await client.from("shipment_notifications")
        .select("awb_snapshot,confirmed_at,confirmed_by").eq("shipment_id",shipment.id);
      if(noteError)throw noteError;
      notifications=notes||[];
      alertMessage("Shipment saved. Tracking details are ready when the parcel is dispatched.");
      await afterSave();
    }catch(error){
      console.error("Shipment save failed",error?.code||"");
      alertMessage(error?.message||"Could not save shipment.",true);
    }finally{busy=false;render();}
  });
  openWhatsApp.addEventListener("click",()=>{
    if(openWhatsApp.disabled||!order||!shipment||!canNotifyShipment(shipment,customer().whatsapp_number,hasConfirmed()))return;
    const message=formatShipmentMessage({order_number:order.order_number,customer_name:customer().name},shipment);
    const url=whatsappTrackingUrl(customer().whatsapp_number,message);
    if(!url)return;
    window.open(url,"_blank","noopener,noreferrer");
    openedAwb=shipment.consignment_number;
    render();
    alertMessage("WhatsApp requested. After you actually send the message, return and confirm. If blocked, use Copy message.");
  });
  copy.addEventListener("click",async()=>{
    if(!messagePreview.value)return;
    try{
      await navigator.clipboard.writeText(messagePreview.value);
      alertMessage("Tracking message copied. You can paste it into WhatsApp manually.");
    }catch{alertMessage("Copy was blocked by the browser. Select the message to copy.",true);}
  });
  confirm.addEventListener("click",async()=>{
    if(confirm.disabled||!order||!shipment||openedAwb!==shipment.consignment_number||
      !canNotifyShipment(shipment,customer().whatsapp_number,hasConfirmed()))return;
    if(!window.confirm("Did you personally send the tracking message in WhatsApp? Opening WhatsApp alone is NOT a confirmation."))return;
    busy=true;render();
    try{
      const {data,error}=await client.rpc("confirm_shipment_whatsapp",{
        p_order_id:order.id,p_awb:shipment.consignment_number
      });
      if(error)throw error;
      const currentUser=await client.auth.getUser();
      const actorId=currentUser.data?.user?.id;
      if(actorId)actorNames.set(actorId,currentUser.data?.user?.user_metadata?.full_name||"Current administrator");
      notifications.push({awb_snapshot:shipment.consignment_number,
        confirmed_at:new Date().toISOString(),confirmed_by:actorId});
      openedAwb="";
      alertMessage(data?.already_confirmed?"Message was already confirmed.":"Manual confirmation recorded with your staff account and timestamp.");
    }catch(error){alertMessage(error?.message||"Could not record confirmation.",true);}
    finally{busy=false;render();}
  });
  return {open,close};
}
