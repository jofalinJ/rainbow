const STAFF_URL = SUPABASE_URL + "/functions/v1/create-staff-user";

async function adminGuard(){
  const session = await requireSession();
  const rows = await sb("staff_profiles?select=user_id,full_name,role,active&user_id=eq."+encodeURIComponent(session.user.id));
  const me = Array.isArray(rows) ? rows[0] : null;
  if(!me || me.role !== "admin" || !me.active){
    document.body.innerHTML = "<main style='margin:0;padding:60px'><h1>Access denied</h1><p>Only an active admin can manage staff.</p><button onclick=\"location.href='index.html'\">Back to dashboard</button></main>";
    throw new Error("Admin access required.");
  }
  return session;
}

async function loadStaff(){
  try{
    const rows = await sb("staff_profiles?select=user_id,full_name,role,active,created_at&order=created_at.asc");
    const emails = {};
    // Auth email addresses are not exposed through the public staff table.
    // The Edge Function returns email on creation; existing staff rows show name/role/status.
    const body = document.querySelector("#staffRows");
    body.innerHTML = (rows||[]).map(s=>`
      <tr>
        <td><b>${escapeHtml(s.full_name||"—")}</b></td>
        <td class="muted">Staff account</td>
        <td><select onchange="changeRole('${s.user_id}',this.value)" ${s.role==="admin"?"disabled":""}>
          <option value="cashier" ${s.role==="cashier"?"selected":""}>Cashier</option>
          <option value="inventory_staff" ${s.role==="inventory_staff"?"selected":""}>Inventory Staff</option>
          <option value="admin" ${s.role==="admin"?"selected":""}>Admin</option>
        </select></td>
        <td><span class="status ${s.active?"status-on":"status-off"}">${s.active?"Active":"Inactive"}</span></td>
        <td>${s.role==="admin"?"<span class='muted'>Protected</span>":"<button onclick=\"toggleStaff('"+s.user_id+"',"+(!s.active)+")\">"+(s.active?"Deactivate":"Activate")+"</button>"}</td>
      </tr>`).join("") || "<tr><td colspan='5'>No staff yet.</td></tr>";
  }catch(e){
    document.querySelector("#staffRows").innerHTML="<tr><td colspan='5'>Could not load staff.</td></tr>";
    console.error(e);
  }
}

function escapeHtml(v){
  return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

async function createStaff(e){
  e.preventDefault();
  const msg=document.querySelector("#formMsg");
  msg.textContent="Creating staff…";
  msg.className="form-msg";
  const session=await requireSession();
  try{
    const r=await fetch(STAFF_URL,{
      method:"POST",
      headers:{Authorization:"Bearer "+session.access_token,apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({
        name:document.querySelector("#name").value.trim(),
        email:document.querySelector("#email").value.trim(),
        password:document.querySelector("#password").value,
        role:document.querySelector("#role").value
      })
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Could not create staff.");
    msg.textContent="Staff created successfully.";
    msg.className="form-msg success";
    document.querySelector("#staffForm").reset();
    await loadStaff();
  }catch(e){
    msg.textContent=e.message;
    msg.className="form-msg error";
  }
}

async function changeRole(userId,role){
  try{
    await sb("staff_profiles?user_id=eq."+encodeURIComponent(userId),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({role})});
    await loadStaff();
  }catch(e){ alert(e.message); await loadStaff(); }
}

async function toggleStaff(userId,active){
  try{
    await sb("staff_profiles?user_id=eq."+encodeURIComponent(userId),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({active})});
    await loadStaff();
  }catch(e){ alert(e.message); }
}

document.addEventListener("DOMContentLoaded",async()=>{
  try{await adminGuard();document.querySelector("#staffForm").addEventListener("submit",createStaff);await loadStaff();}
  catch(e){console.error(e);}
});