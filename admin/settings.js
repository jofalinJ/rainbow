(()=>{
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]));
const client=()=>bootSupabase();
function showError(m){const e=$('pageError');if(e){e.style.display='block';e.textContent=m;}}
async function load(){
 const c=client();
 const s=await c.from('business_settings').select('*').eq('id',true).maybeSingle(); if(s.error)throw s.error;
 if(s.data){['business_name','legal_display_name','tagline','trust_line','instagram_handle','logo_url'].forEach(k=>{if($(k))$(k).value=s.data[k]||'';});}
 const b=await c.from('branches').select('id,code,name,address,map_url,active').order('name'); if(b.error)throw b.error; renderBranches(b.data||[]);
}
function renderBranches(rows){
 const root=$('branchRows');
 root.innerHTML='';
 if(!rows.length){root.innerHTML='<p>No branches configured.</p>';return;}
 rows.forEach(b=>{
  const card=document.createElement('div');card.className='panel';card.style.margin='12px 0';card.dataset.id=b.id;
  card.innerHTML='<div style="display:grid;grid-template-columns:120px 1fr 1fr;gap:12px"><label>Code<input data-f="code"></label><label>Name<input data-f="name"></label><label>Address<input data-f="address"></label><label>Maps URL<input data-f="map_url"></label><label style="display:flex;gap:8px;align-items:center"><input data-f="active" type="checkbox"> Active</label></div><div style="margin-top:12px"><button class="profile" data-save>Save</button> <button data-disable>Disable</button><span data-status style="margin-left:10px"></span></div>';
  card.querySelector('[data-f="code"]').value=b.code||'';card.querySelector('[data-f="name"]').value=b.name||'';card.querySelector('[data-f="address"]').value=b.address||'';card.querySelector('[data-f="map_url"]').value=b.map_url||'';card.querySelector('[data-f="active"]').checked=!!b.active;
  card.querySelector('[data-save]').onclick=()=>saveBranch(b.id,card);card.querySelector('[data-disable]').onclick=()=>disableBranch(b.id);root.appendChild(card);
 });
}
async function saveBusiness(){
 const payload={id:true,business_name:$('business_name').value.trim(),legal_display_name:$('legal_display_name').value.trim(),tagline:$('tagline').value.trim(),trust_line:$('trust_line').value.trim(),instagram_handle:$('instagram_handle').value.trim()||null,logo_url:$('logo_url').value.trim()||null,updated_at:new Date().toISOString()};
 const r=await client().from('business_settings').upsert(payload,{onConflict:'id'});if(r.error)throw r.error;$('businessStatus').textContent='Saved.';
}
async function saveBranch(id,card){
 const g=f=>card.querySelector('[data-f="'+f+'"]');
 const payload={code:g('code').value.trim().toUpperCase(),name:g('name').value.trim(),address:g('address').value.trim(),map_url:g('map_url').value.trim()||null,active:g('active').checked,updated_at:new Date().toISOString()};
 const r=await client().from('branches').update(payload).eq('id',id);const st=card.querySelector('[data-status]');if(r.error){st.textContent=r.error.message;return;}st.textContent='Saved.';
}
async function disableBranch(id){if(!confirm('Disable this branch? It will disappear from the customer website.'))return;const r=await client().from('branches').update({active:false,updated_at:new Date().toISOString()}).eq('id',id);if(r.error){alert(r.error.message);return;}await load();}
async function addBranch(){const code=prompt('Branch code, e.g. NGL');if(!code)return;const name=prompt('Branch name');if(!name)return;const address=prompt('Full address');if(!address)return;const r=await client().from('branches').insert({code:code.trim().toUpperCase(),name:name.trim(),address:address.trim(),active:true});if(r.error){alert(r.error.message);return;}await load();}
window.initBusinessSettings=async()=>{try{const p=await getMyProfile();if(p.role!=='admin'||!p.active)throw new Error('Admin access is required.');await load();$('saveBusiness').onclick=()=>saveBusiness().catch(e=>showError(e.message));$('newBranch').onclick=()=>addBranch().catch(e=>showError(e.message));}catch(e){showError(e.message);}};
})();