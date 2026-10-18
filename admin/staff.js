let staffRules=null;
async function getStaffRules(){if(!staffRules)staffRules=await import("../src/domain/staffRules.mjs");return staffRules;}

const STAFF_URL=SUPABASE_URL+"/functions/v1/create-staff-user";
const DELETE_STAFF_URL=SUPABASE_URL+"/functions/v1/delete-staff-user";
let deletingUserId=null;

function escapeHtml(v){
  return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

function showStaffError(message){
  const rows=document.querySelector("#staffRows");
  if(rows) rows.innerHTML="<tr><td colspan='6' style='color:#b42318'>"+escapeHtml(message)+"</td></tr>";
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

    const photo=s.photo_url
      ?"<img src='"+escapeHtml(s.photo_url)+"' alt='' width='40' height='40' style='width:40px;height:40px;object-fit:cover;border-radius:50%;border:1px solid #eee'>"
      :"<span class='staff-photo-placeholder'>"+escapeHtml((s.full_name||s.username||"S").split(/\s+/).slice(0,2).map(part=>part.charAt(0).toUpperCase()).join(""))+"</span>";
    return "<tr data-testid='staff-row' data-username='"+escapeHtml(s.username||"")+"'>"+
      "<td><b>"+escapeHtml(s.full_name||"—")+"</b></td>"+
      "<td class='muted'>"+escapeHtml(s.username||"—")+"</td>"+
      "<td><div class='staff-photo-cell'>"+photo+"<label class='staff-photo-upload'>Change photo<input type='file' data-profile-photo='"+escapeHtml(s.user_id)+"' accept='image/jpeg,image/png,image/webp' capture='user'></label></div></td>"+
      "<td><span class='muted'>"+(isAdmin?"Admin":"Staff")+"</span></td>"+
      "<td><span class='status "+statusClass+"'>"+statusLabel+"</span></td>"+
      "<td class='staff-actions'>"+
        (isAdmin
          ? "<span class='muted'>Protected</span>"
          : "<div class='staff-action-group'>"+
              "<button type='button' data-action='toggle' data-user-id='"+escapeHtml(s.user_id)+"' data-active='"+(!s.active)+"'>"+(s.active?"Deactivate":"Activate")+"</button>"+
              "<button type='button' data-testid='delete-staff' class='danger-button' data-action='delete' data-user-id='"+escapeHtml(s.user_id)+"' data-username='"+escapeHtml(s.username||s.full_name||"staff")+"'>Delete</button>"+
            "</div>"
        )+
      "</td>"+
    "</tr>";
  }).join("")||"<tr><td colspan='6'>No staff yet.</td></tr>";
}

async function loadStaff(){
  try{
    const {data,error}=await bootSupabase()
      .from("staff_profiles")
      .select("user_id,full_name,username,role,active,created_at,photo_path")
      .order("created_at",{ascending:true});

    if(error)throw new Error(error.message);
    const client=bootSupabase();
    const profiles=Array.isArray(data)?data:[];
    const withPhotos=await Promise.all(profiles.map(async profile=>{
      if(!profile.photo_path)return {...profile,photo_url:""};
      const {data:photo,error:photoError}=await client.storage.from("staff-private").createSignedUrl(profile.photo_path,600);
      if(photoError)console.warn("Could not create staff profile image link:",photoError);
      return {...profile,photo_url:photo?.signedUrl||""};
    }));
    renderStaff(withPhotos);
  }catch(e){
    showStaffError("Could not load staff: "+e.message);
    console.error(e);
  }
}

async function uploadStaffPhoto(userId,file){
  if(!file)throw new Error("Choose a photo first.");
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Use a JPEG, PNG or WebP image.");
  if(file.size>5*1024*1024)throw new Error("Choose an image smaller than 5 MB.");
  const client=bootSupabase();
  const path="profiles/"+String(userId)+"/reference";
  const {error:uploadError}=await client.storage.from("staff-private").upload(path,file,{
    cacheControl:"3600",contentType:file.type,upsert:true
  });
  if(uploadError)throw new Error(uploadError.message);
  const {error:updateError}=await client.from("staff_profiles").update({photo_path:path}).eq("user_id",userId);
  if(updateError)throw new Error(updateError.message);
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
    const rules=await getStaffRules();
    const payload={name:document.querySelector("#name").value.trim(),username:document.querySelector("#username").value.trim().toLowerCase(),password:document.querySelector("#password").value,role:document.querySelector("#role").value};
    const photoFile=document.querySelector("#photo")?.files?.[0];
    if(!photoFile)throw new Error("Upload a staff profile photo before creating the account.");
    const validation=rules.validateStaffCreation(payload);
    if(!validation.ok)throw new Error(validation.error);
    const r=await fetch(STAFF_URL,{
      method:"POST",
      headers:{
        Authorization:"Bearer "+session.access_token,
        apikey:SUPABASE_ANON_KEY,
        "Content-Type":"application/json"
      },
      body:JSON.stringify(validation.value)
    });

    const text=await r.text();
    let data={};
    try{data=JSON.parse(text)}catch{data={};}
    if(!r.ok)throw new Error(data.error||text||("Could not create staff ("+r.status+")."));

    let photoError=null;
    try{await uploadStaffPhoto(data.user_id,photoFile);}catch(error){photoError=error;}
    msg.textContent=photoError
      ?"Staff account created, but the profile photo was not saved: "+photoError.message+" Upload it from the staff list."
      :"Staff created with a private profile photo. They can log in with the username and password.";
    msg.className=photoError?"form-msg error":"form-msg success";
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
    try{data=JSON.parse(text)}catch{data={};}
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
    const photoInput=e.target.closest("input[data-profile-photo]");
    if(photoInput){
      const file=photoInput.files?.[0],userId=photoInput.dataset.profilePhoto;
      photoInput.value="";
      uploadStaffPhoto(userId,file).then(loadStaff).catch(error=>{
        alert("Could not update staff photo: "+error.message);
        console.error(error);
      });
      return;
    }
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