/* Integrated shop assignments for the existing admin/staff.html page. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
const client=()=>window.bootSupabase();
const selectOptions=(el,rows,placeholder)=>{
 const previous=el.value;
 el.replaceChildren(new Option(placeholder,""));
 for(const row of rows)el.add(new Option(row.label,row.value));
 if(rows.some(x=>x.value===previous))el.value=previous;
};
let users=[],locations=[],rows=[],busy=false;
function feedback(message,error=false){
 const node=$("staffBranchStatus");if(!node)return;
 node.textContent=message;node.className="form-msg"+(error?" error":"");
}
async function request(builder){
 const {data,error}=await builder;if(error)throw Error(error.message||"Request rejected");
 return data;
}
function render(){
 const target=$("staffBranchRows");target.replaceChildren();
 if(!rows.length){const tr=document.createElement("tr");const td=document.createElement("td");td.colSpan=3;td.textContent="No shop assignments yet.";tr.append(td);target.append(tr);return;}
 for(const row of rows){
 const tr=document.createElement("tr");
 const user=users.find(s=>s.user_id===row.user_id);
 const loc=locations.find(l=>l.id===row.location_id);
 const name=document.createElement("td");name.textContent=user?.full_name||row.user_id.slice(0,8);
 const place=document.createElement("td");place.textContent=loc?.name||"Unknown shop";
 const action=document.createElement("td");
 const button=document.createElement("button");button.type="button";button.textContent="Unassign";
 button.addEventListener("click",async()=>{
  if(busy)return;
  busy=true;button.disabled=true;
  try{
   await request(client().from("erp_staff_locations").delete()
   .eq("user_id",row.user_id).eq("location_id",row.location_id));
   feedback("Staff removed from the selected shop.");await load();
  }catch(e){feedback(e.message,true);}finally{busy=false;button.disabled=false;}
 });
 action.append(button);tr.append(name,place,action);target.append(tr);
 }
}
async function load(){
 [users,locations,rows]=await Promise.all([
  request(client().from("staff_profiles").select("user_id,full_name,role,active,archived_at")
   .eq("active",true).is("archived_at",null).order("full_name").limit(300)),
  request(client().from("erp_locations").select("id,name,kind")
   .eq("kind","branch").eq("active",true).order("name").limit(100)),
  request(client().from("erp_staff_locations").select("user_id,location_id").limit(800))
 ]);
 selectOptions($("staffBranchUser"),users.filter(u=>u.role!=="admin")
 .map(u=>({value:u.user_id,label:u.full_name||u.user_id.slice(0,8)})),"Choose staff");
 selectOptions($("staffBranchLocation"),locations.map(l=>({value:l.id,label:l.name})),"Choose shop");
 render();
 feedback("Current authorized shop assignments are shown above.");
}
async function assign(){
 if(busy)return;
 const user_id=$("staffBranchUser").value,location_id=$("staffBranchLocation").value;
 if(!user_id||!location_id){feedback("Choose a staff member and shop.",true);return;}
 if(rows.some(row=>row.user_id===user_id&&row.location_id===location_id)){
  feedback("This staff member already has access to that shop.");return;
 }
 busy=true;$("staffBranchAssign").disabled=true;
 try{
  await request(client().from("erp_staff_locations").insert({user_id,location_id}));
  feedback("Shop assignment saved.");await load();
 }catch(e){feedback("Could not assign shop: "+e.message,true);}
 finally{busy=false;$("staffBranchAssign").disabled=false;}
}
async function boot(){
 if(!$("staffBranchPanel")||window.RAINBOW_MULTI_SHOP_ENABLED!==true)return;
 $("staffBranchPanel").hidden=false;
 try{
  await window.requireSession();
  const role=await window.getMyProfile();
  if(!role.active||role.role!=="admin"){feedback("Admin permission required.",true);return;}
  $("staffBranchAssign").addEventListener("click",assign);
  await load();
 }catch(e){feedback("Shop assignments are not enabled in this database: "+e.message,true);}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();