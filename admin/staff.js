let staffRules=null;
async function getStaffRules(){if(!staffRules)staffRules=await import("../src/domain/staffRules.mjs");return staffRules;}

const STAFF_URL=SUPABASE_URL+"/functions/v1/create-staff-user";
const DELETE_STAFF_URL=SUPABASE_URL+"/functions/v1/delete-staff-user";
let deletingUserId=null;
const MAX_STAFF_PHOTOS=5;
const STAFF_IMAGE_TYPES=["image/jpeg","image/png","image/webp"];
function staffSlotPath(userId,slot){
  if(!Number.isInteger(slot)||slot<1||slot>MAX_STAFF_PHOTOS)throw new Error("Invalid photo slot.");
  return "profiles/"+String(userId)+"/"+(slot===1?"reference":"reference-"+slot);
}
function staffPhotoPaths(staff){
  return [staff.photo_path,...(Array.isArray(staff.reference_photo_paths)?staff.reference_photo_paths:[])].filter(Boolean);
}
function validateStaffImage(file){
  if(!file)throw new Error("Choose a photo first.");
  if(!STAFF_IMAGE_TYPES.includes(file.type))throw new Error("Use a JPEG, PNG or WebP image.");
  if(!file.size||file.size>5*1024*1024)throw new Error("Each photo must be under 5 MB and not empty.");
}


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
    const photosByPath=new Map((s.photo_refs||[]).map(ref=>[ref.path,ref]));
    const photoSlots=Array.from({length:MAX_STAFF_PHOTOS},(_,index)=>{
      const slot=index+1,ref=photosByPath.get(staffSlotPath(s.user_id,slot));
      const preview=ref?.url?"<img loading='lazy' src='"+escapeHtml(ref.url)+"' alt='Reference photo "+slot+"'>":
        "<span>"+(ref?"Preview unavailable":"Empty")+"</span>";
      return "<div class='staff-photo-slot'><div class='staff-photo-slot-preview'>"+preview+"</div>"+
        "<strong>Photo "+slot+(slot===1?" · Main":"")+"</strong>"+
        "<label class='staff-photo-upload'>"+(ref?"Replace":"Upload")+
        "<input type='file' data-profile-photo='"+escapeHtml(s.user_id)+"' data-photo-slot='"+slot+"' accept='image/jpeg,image/png,image/webp'></label>"+
        (slot>1&&ref?"<button type='button' data-remove-reference='"+slot+"' data-staff-id='"+escapeHtml(s.user_id)+"'>Remove</button>":"")+
        "</div>";
    }).join("");
    const photoManager="<details class='staff-photo-manager'><summary>Manage photos ("+s.photo_count+"/5)</summary>"+
      "<div class='staff-photo-grid'>"+photoSlots+"</div><small>Use clear photos of the same person with varied angles and light.</small></details>";
    return "<tr data-testid='staff-row' data-username='"+escapeHtml(s.username||"")+"'>"+
      "<td><b>"+escapeHtml(s.full_name||"—")+"</b></td>"+
      "<td class='muted'>"+escapeHtml(s.username||"—")+"</td>"+
      "<td><div class='staff-photo-cell'>"+photo+"<label class='staff-photo-upload'>Change photo<input type='file' data-profile-photo='"+escapeHtml(s.user_id)+"' accept='image/jpeg,image/png,image/webp'></label>"+photoManager+"</div></td>"+
      "<td><span class='muted'>"+(isAdmin?"Admin":"Staff")+"</span></td>"+
      "<td><span class='status "+statusClass+"'>"+statusLabel+"</span></td>"+
      "<td class='staff-actions'>"+
        (isAdmin
          ? "<span class='muted'>Protected</span>"
          : "<div class='staff-action-group'>"+
              "<button type='button' data-action='toggle' data-user-id='"+escapeHtml(s.user_id)+"' data-active='"+(!s.active)+"'>"+(s.active?"Deactivate":"Activate")+"</button>"+
              "<button type='button' data-testid='delete-staff' class='danger-button' data-action='delete' data-user-id='"+escapeHtml(s.user_id)+"' data-username='"+escapeHtml(s.username||s.full_name||"staff")+"'>Remove</button>"+
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
      .select("user_id,full_name,username,role,active,created_at,photo_path,reference_photo_paths,archived_at")
      .is("archived_at",null)
      .order("created_at",{ascending:true});

    if(error)throw new Error(error.message);
    const client=bootSupabase();
    const profiles=Array.isArray(data)?data:[];
    const withPhotos=await Promise.all(profiles.map(async profile=>{
      const paths=staffPhotoPaths(profile);
      const photo_refs=await Promise.all(paths.map(async path=>{
        const {data:photo,error:photoError}=await client.storage.from("staff-private").createSignedUrl(path,600);
        if(photoError)console.warn("Could not create staff photo link:",photoError);
        return {path,url:photo?.signedUrl||""};
      }));
      return {...profile,photo_refs,photo_count:paths.length,photo_url:photo_refs.find(p=>p.path===profile.photo_path)?.url||""};
    }));
    renderStaff(withPhotos);
  }catch(e){
    showStaffError("Could not load staff: "+e.message);
    console.error(e);
  }
}

async function uploadStaffPhoto(userId,file,slot=1){
  validateStaffImage(file);
  const client=bootSupabase(),path=staffSlotPath(userId,slot);
  let extras=null,previouslyEnrolled=false;
  if(slot>1){
    const {data,error}=await client.from("staff_profiles").select("reference_photo_paths").eq("user_id",userId).single();
    if(error||!data)throw new Error(error?.message||"Staff account not found.");
    extras=Array.isArray(data.reference_photo_paths)?[...data.reference_photo_paths]:[];
    previouslyEnrolled=extras.includes(path);
    if(!previouslyEnrolled){
      if(extras.length>=4)throw new Error("This staff member already has five reference photos.");
      extras.push(path);
    }
  }
  const {error:uploadError}=await client.storage.from("staff-private").upload(path,file,{
    cacheControl:"60",contentType:file.type,upsert:true
  });
  if(uploadError)throw new Error(uploadError.message);
  const changes=slot===1?{photo_path:path}:{reference_photo_paths:extras};
  const {data:updated,error:updateError}=await client.from("staff_profiles")
    .update(changes).eq("user_id",userId).select("user_id").maybeSingle();
  if(updateError||!updated){
    if(slot>1&&!previouslyEnrolled)await client.storage.from("staff-private").remove([path]);
    throw new Error(updateError?.message||"Only admins can save staff photos.");
  }
}
async function deleteStaffExtraPhoto(userId,slot){
  if(!Number.isInteger(slot)||slot<2||slot>MAX_STAFF_PHOTOS)throw new Error("The main profile photo can only be replaced.");
  const client=bootSupabase(),path=staffSlotPath(userId,slot);
  const {data,error}=await client.from("staff_profiles").select("reference_photo_paths").eq("user_id",userId).single();
  if(error||!data)throw new Error(error?.message||"Staff account not found.");
  const extras=Array.isArray(data.reference_photo_paths)?data.reference_photo_paths:[];
  if(!extras.includes(path))return;
  const {data:updated,error:updateError}=await client.from("staff_profiles")
    .update({reference_photo_paths:extras.filter(item=>item!==path)})
    .eq("user_id",userId).select("user_id").maybeSingle();
  if(updateError||!updated)throw new Error(updateError?.message||"Could not remove this reference.");
  const {error:deleteError}=await client.storage.from("staff-private").remove([path]);
  if(deleteError)console.warn("Unenrolled photo needs private Storage cleanup:",deleteError);
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
    const photoFiles=Array.from(document.querySelector("#photo")?.files||[]);
    if(!photoFiles.length)throw new Error("Upload at least one reference photo.");
    if(photoFiles.length>MAX_STAFF_PHOTOS)throw new Error("Select no more than five photos.");
    photoFiles.forEach(validateStaffImage);
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

    let photoError=null,saved=0;
    for(let index=0;index<photoFiles.length;index++){
      try{await uploadStaffPhoto(data.user_id,photoFiles[index],index+1);saved++;}
      catch(error){photoError=error;break;}
    }
    msg.textContent=photoError
      ?"Staff account created, but only "+saved+" of "+photoFiles.length+" photos were saved: "+photoError.message+" Use Manage photos to finish."
      :"Staff created with "+saved+" private reference photo"+(saved===1?"":"s")+". They can log in with the username and password.";
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
  if(!confirm("Remove "+label+" from staff? Their login will be blocked and they will disappear from the staff list. Previous orders, stock records and attendance are preserved."))return;

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
      msg.textContent="Staff access removed. Past orders and inventory records have been preserved.";
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
      const slot=Number(photoInput.dataset.photoSlot||1);
      photoInput.value="";
      if(rows.dataset.photoBusy==="true")return;
      rows.dataset.photoBusy="true";
      uploadStaffPhoto(userId,file,slot).then(loadStaff).catch(error=>{
        alert("Could not update staff photo: "+error.message);
        console.error(error);
      }).finally(()=>{rows.dataset.photoBusy="false";});
      return;
    }
  });

  rows.addEventListener("click",e=>{
    const remove=e.target.closest("button[data-remove-reference]");
    if(remove){
      if(rows.dataset.photoBusy==="true")return;
      const slot=Number(remove.dataset.removeReference),userId=remove.dataset.staffId;
      if(!confirm("Remove reference photo "+slot+"?"))return;
      rows.dataset.photoBusy="true";
      deleteStaffExtraPhoto(userId,slot).then(loadStaff).catch(error=>{
        alert("Could not remove staff photo: "+error.message);
        console.error(error);
      }).finally(()=>{rows.dataset.photoBusy="false";});
      return;
    }
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