const STAFF_URL=SUPABASE_URL+"/functions/v1/create-staff-user";
const DELETE_STAFF_URL=SUPABASE_URL+"/functions/v1/delete-staff-user";
let deletingUserId=null;

function escapeHtml(v){
  return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

function showStaffError(message){
  const rows=document.querySelector("#staffRows");
  if(rows) rows.innerHTML="<tr><td colspan='5' style='color:#b42318'>"+escapeHtml(message)+"</td></tr>";
  const msg=document.querySelector("#formMsg");
  if(msg){msg.textContent=message;msg.className="form-msg error";}
}

function setFormBusy(busy){
  const form=document.querySelector("#staffForm");
  const button=form?.querySelector("button[type='submit']");
  if(button){
    button.disabled=busy;
    button.textContent=busy?"Creating…":"＋ Create Staff";
  }
}

async function adminGuard(){
  const p=await getMyProfile();
  if(!p.active||p.role!=="admin"){
    document.body.innerHTML="<main style='margin:0;padding:60px'><h1>Access denied</h1><p>Only an active admin can manage staff.</p><button type='button' id='backDashboard'>Back to dashboard</button></main>";
    document.querySelector("#backDashboard")?.addEventListener("click",()=>location.href="index.html");
    throw new Error("Admin access required.");
  }
  return p;
}

function renderStaff(staff){
  const rows=document.querySelector("#staffRows");
  if(!rows)return;

  rows.innerHTML=(staff||[]).map(s=>{
    const isAdmin=s.role==="admin";
    const statusClass=s.active?"status-on":"status-off";
    const statusLabel=s.active?"Active":"Inactive";

    return "<tr>"+
      "<td><b>"+escapeHtml(s.full_name||"—")+"</b></td>"+
      "<td class='muted'>"+escapeHtml(s.username||"—")+"</td>"+
      "<td><select data-role-user='"+escapeHtml(s.user_id)+"' "+(isAdmin?"disabled":"")+">"+
        "<option value='cashier' "+(s.role==="cashier"?"selected":"")+">Cashier</option>"+
        "<option value='inventory_staff' "+(s.role==="inventory_staff"?"selected":"")+">Inventory Staff</option>"+
      "</select></td>"+
      "<td><span class='status "+statusClass+"'>"+statusLabel+"</span></td>"+
      "<td class='staff-actions'>"+
        (isAdmin
          ? "<span class='muted'>Protected</span>"
          : "<div class='staff-action-group'>"+
              "<button type='button' data-action='toggle' data-user-id='"+escapeHtml(s.user_id)+"' data-active='"+(!s.active)+"'>"+(s.active?"Deactivate":"Activate")+"</button>"+
              "<button type='button' class='danger-button' data-action='delete' data-user-id='"+escapeHtml(s.user_id)+"' data-username='"+escapeHtml(s.username||s.full_name||"staff")+"'>Delete</button>"+
            "</div>"
        )+
      "</td>"+
    "</tr>";
  }).join("")||"<tr><td colspan='5'>No staff yet.</td></tr>";
}

async function loadStaff(){
  try{
    const {data,error}=await bootSupabase()
      .from("staff_profiles")
      .select("user_id,full_name,username,role,active,created_at")
      .order("created_at",{ascending:true});

    if(error)throw new Error(error.message);
    renderStaff(data);
  }catch(e){
    showStaffError("Could not load staff: "+e.message);
    console.error(e);
  }
}

async function createStaff(e){
  e.preventDefault();
  const form=document.querySelector("#staffForm");
  const msg=document.querySelector("#formMsg");
  if(!form||!msg)return;

  msg.textContent="Creating staff…";
  msg.className="form-msg";
  setFormBusy(true);

  try{
    const session=await requireSession();
    const username=document.querySelector("#username").value.trim().toLowerCase();

    const r=await fetch(STAFF_URL,{
      method:"POST",
      headers:{
        Authorization:"Bearer "+session.access_token,
        apikey:SUPABASE_ANON_KEY,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        name:document.querySelector("#name").value.trim(),
        username,
        password:document.querySelector("#password").value,
        role:document.querySelector("#role").value
      })
    });

    const text=await r.text();
    let data={};
    try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw new Error(data.error||text||("Could not create staff ("+r.status+")."));

    msg.textContent="Staff created. They can log in with the username and password.";
    msg.className="form-msg success";
    form.reset();
    await loadStaff();
  }catch(e){
    msg.textContent=e.message;
    msg.className="form-msg error";
    console.error(e);
  }finally{
    setFormBusy(false);
  }
}

async function changeRole(userId,role){
  try{
    const {error}=await bootSupabase().from("staff_profiles").update({role}).eq("user_id",userId);
    if(error)throw new Error(error.message);
    await loadStaff();
  }catch(e){
    alert("Could not change role: "+e.message);
    await loadStaff();
  }
}

async function toggleStaff(userId,active){
  if(!confirm(active?"Activate this staff account?":"Deactivate this staff account?"))return;

  try{
    const {error}=await bootSupabase().from("staff_profiles").update({active}).eq("user_id",userId);
    if(error)throw new Error(error.message);
    await loadStaff();
  }catch(e){
    alert("Could not update staff status: "+e.message);
    await loadStaff();
  }
}

async function deleteStaff(userId,username){
  if(deletingUserId)return;

  const label=username||"this staff account";
  if(!confirm("Delete "+label+" permanently? This removes the staff login and staff profile. This cannot be undone."))return;

  deletingUserId=userId;

  try{
    const session=await requireSession();
    const r=await fetch(DELETE_STAFF_URL,{
      method:"POST",
      headers:{
        Authorization:"Bearer "+session.access_token,
        apikey:SUPABASE_ANON_KEY,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({user_id:userId})
    });

    const text=await r.text();
    let data={};
    try{data=JSON.parse(text)}catch{}
    if(!r.ok)throw new Error(data.error||text||("Could not delete staff ("+r.status+")."));

    const msg=document.querySelector("#formMsg");
    if(msg){
      msg.textContent="Staff account deleted.";
      msg.className="form-msg success";
    }

    await loadStaff();
  }catch(e){
    alert("Could not delete staff: "+e.message);
    console.error(e);
  }finally{
    deletingUserId=null;
  }
}

function bindStaffTable(){
  const rows=document.querySelector("#staffRows");
  if(!rows||rows.dataset.bound==="true")return;

  rows.dataset.bound="true";

  rows.addEventListener("change",e=>{
    const select=e.target.closest("select[data-role-user]");
    if(select)changeRole(select.dataset.roleUser,select.value);
  });

  rows.addEventListener("click",e=>{
    const button=e.target.closest("button[data-action]");
    if(!button)return;

    const action=button.dataset.action;
    const userId=button.dataset.userId;

    if(action==="toggle"){
      toggleStaff(userId,button.dataset.active==="true");
    }else if(action==="delete"){
      deleteStaff(userId,button.dataset.username);
    }
  });
}

async function bootStaff(){
  try{
    const form=document.querySelector("#staffForm");
    if(!form)throw new Error("Staff form is unavailable.");

    bindStaffTable();
    form.addEventListener("submit",createStaff);
    await adminGuard();
    await loadStaff();
  }catch(e){
    showStaffError(e.message);
    console.error(e);
  }
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",bootStaff,{once:true});
}else{
  bootStaff();
}