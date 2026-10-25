let inventoryRules=null;
async function getInventoryRules(){if(!inventoryRules)inventoryRules=await import("../src/domain/inventoryRules.mjs");return inventoryRules;}

let inventory=[],categories=[],selectedCategoryId=null,inventoryTools=null;
const ERP_INVENTORY=window.RAINBOW_MULTI_SHOP_ENABLED===true;
let inventoryBranchId="";
async function loadInventoryBranchPicker(){
 if(!ERP_INVENTORY)return;
 const picker=document.getElementById("inventoryBranchPicker"),
 select=document.getElementById("inventoryBranchSelect");
 picker.hidden=false;
 const {data,error}=await bootSupabase().from("erp_locations")
 .select("id,name,kind").eq("kind","branch").eq("active",true).order("name");
 if(error)throw error;
 select.replaceChildren(new Option("Choose shop",""));
 for(const location of data||[])select.add(new Option(location.name,location.id));
 if(data?.length){inventoryBranchId=data[0].id;select.value=inventoryBranchId;}
 else document.getElementById("inventoryBranchHint").textContent=
 "No assigned shop. Ask admin to grant staff access.";
 select.addEventListener("change",async()=>{
   inventoryBranchId=select.value;
   const inTools=document.getElementById("erpLocation");
   if(inTools){inTools.value=inventoryBranchId;inTools.dispatchEvent(new Event("change"));}
   try{await loadInventory();}catch(e){console.error("Branch inventory unavailable",e);}
 });
}

async function loadInventory(){inventoryRules=await getInventoryRules();categories=await sb("categories?select=id,name,has_color,has_size,has_length,has_thickness,has_gold_amount&active=eq.true&order=name");inventory=await sb("product_variants?select=id,color,size,length_cm,stock_quantity,low_stock_limit,barcode,products(id,product_code,product_name,type,category_id,length_cm,thickness,gold_amount_g)&active=eq.true&order=created_at.desc");if(ERP_INVENTORY){
 const balances=new Map();
 if(inventoryBranchId){
  for(let page=0;page<100;page++){
   const {data,error}=await bootSupabase().from("erp_stock_balances")
     .select("variant_id,on_hand,reserved").eq("location_id",inventoryBranchId)
     .range(page*500,page*500+499);
   if(error)throw error;
   for(const row of data||[])balances.set(row.variant_id,Math.max(0,row.on_hand-row.reserved));
   if((data||[]).length<500)break;
   if(page===99)throw Error("Inventory exceeds allowed range.");
  }
 }
 inventory=inventory.map(item=>({...item,stock_quantity:balances.get(item.id)||0}));
}
if(categories.length)selectedCategoryId=selectedCategoryId||categories[0].id;renderCategories();renderInventory();
if(!inventoryTools){
  const module=await import("./inventory-adjustments.mjs");
  inventoryTools=module.setupInventoryAdjustmentUI({
    getVariant:id=>inventory.find(item=>String(item.id)===String(id)),
    onUpdated:loadInventory
  });
}}
function renderCategories(){document.getElementById("categoryTabs").innerHTML=categories.map(c=>'<button type="button" class="'+(c.id===selectedCategoryId?"active":"")+'" data-id="'+esc(c.id)+'">'+esc(c.name)+'</button>').join("");document.querySelectorAll("#categoryTabs button").forEach(b=>b.onclick=()=>{selectedCategoryId=b.dataset.id;renderCategories();renderInventory();});}
function getInventoryStatus(v){const s=inventoryRules.getStockStatus(v.stock_quantity,v.low_stock_limit);return[s.label,s.tone];}
function esc(x){return String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));}
function renderInventory(){const cat=categories.find(c=>c.id===selectedCategoryId);if(!cat)return;const q=(document.getElementById("search").value||"").toLowerCase().trim();const rows=inventory.filter(v=>{const p=v.products||{};return p.category_id===selectedCategoryId&&[p.product_code,p.product_name,p.type,v.color,v.size,v.barcode].some(x=>String(x??"").toLowerCase().includes(q));});document.getElementById("selectedCategory").textContent=cat.name;document.getElementById("categoryMeta").textContent=rows.length+" product variants";document.getElementById("variantCount").textContent=rows.length;document.getElementById("stockCount").textContent=rows.reduce((s,v)=>s+Number(v.stock_quantity||0),0);document.getElementById("lowCount").textContent=rows.filter(v=>Number(v.stock_quantity||0)>0&&Number(v.stock_quantity||0)<=Number(v.low_stock_limit||0)).length;document.getElementById("outCount").textContent=rows.filter(v=>Number(v.stock_quantity||0)===0).length;
let columns=["Code","Product","Type"];if(cat.has_color)columns.push("Color");if(cat.has_size)columns.push("Size");if(cat.has_length)columns.push("Length");if(cat.has_thickness)columns.push("Thickness");if(cat.has_gold_amount)columns.push("Gold Amount");columns.push("Stock","Limit","Status","Barcode","Actions");document.getElementById("head").innerHTML="<tr>"+columns.map(x=>"<th>"+x+"</th>").join("")+"</tr>";
document.getElementById("rows").innerHTML=rows.map(v=>{const p=v.products||{},[label,cls]=getInventoryStatus(v);let cells="<td><b>"+esc(p.product_code||"—")+"</b></td><td>"+esc(p.product_name||"—")+"</td><td>"+esc(p.type||"—")+"</td>";if(cat.has_color)cells+="<td>"+esc(v.color||"0")+"</td>";if(cat.has_size)cells+="<td>"+esc(v.size||"0")+"</td>";if(cat.has_length)cells+="<td>"+((v.length_cm??p.length_cm)==null?"—":esc(v.length_cm??p.length_cm)+" cm")+"</td>";if(cat.has_thickness)cells+="<td>"+esc(p.thickness||"—")+"</td>";if(cat.has_gold_amount)cells+="<td>"+(p.gold_amount_g==null?"—":esc(p.gold_amount_g)+" g")+"</td>";cells+="<td><b>"+Number(v.stock_quantity||0)+"</b></td><td>"+Number(v.low_stock_limit||0)+"</td><td><span class='"+cls+"'>"+label+"</span></td><td>"+esc(v.barcode||"—")+"</td>";cells+="<td><button type='button' class='stock-row-button' data-manage-stock='"+esc(v.id)+"'>Manage stock</button></td>";return"<tr>"+cells+"</tr>"}).join("")||"<tr><td colspan='"+columns.length+"'>No products found in this category.</td></tr>";
document.querySelectorAll("[data-manage-stock]").forEach(button=>{
  button.addEventListener("click",()=>{
    if(!ERP_INVENTORY){inventoryTools?.open(button.dataset.manageStock,button);return;}
    const variant=inventory.find(x=>String(x.id)===String(button.dataset.manageStock));
    const details=document.getElementById("branchInventoryTools");
    if(details)details.open=true;
    const search=document.getElementById("erpSearch");
    if(search && variant?.products?.product_code){
      search.value=variant.products.product_code;
      document.getElementById("erpSearchBtn")?.click();
    }
    details?.scrollIntoView({behavior:"smooth",block:"start"});
  });
});
}
document.getElementById("search").oninput=renderInventory;
if(document.getElementById("rows"))requireSession()
 .then(async()=>{await loadInventoryBranchPicker();await loadInventory();})
 .catch(error=>{console.error(error);document.getElementById("rows").textContent="Could not load inventory: "+error.message;});