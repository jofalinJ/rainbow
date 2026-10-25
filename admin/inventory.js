let inventoryRules=null;
async function getInventoryRules(){if(!inventoryRules)inventoryRules=await import("../src/domain/inventoryRules.mjs");return inventoryRules;}

let inventory=[],categories=[],selectedCategoryId=null,inventoryTools=null;
let inventoryPage=0,inventoryTotal=0,inventoryStats={},inventoryRevision=0,inventorySearchTimer=null;
const INVENTORY_PAGE_SIZE=80;

async function loadInventory(){
  inventoryRules=await getInventoryRules();
  categories=await sb("categories?select=id,name,has_color,has_size,has_length,has_thickness,has_gold_amount&active=eq.true&order=name");
  if(categories.length)selectedCategoryId=selectedCategoryId||categories[0].id;
  renderCategories();
  await loadInventoryPage({reset:true});
  if(!inventoryTools){
    const module=await import("./inventory-adjustments.mjs");
    inventoryTools=module.setupInventoryAdjustmentUI({
      getVariant:id=>inventory.find(item=>String(item.id)===String(id)),
      onUpdated:()=>loadInventoryPage()
    });
  }
}
async function loadInventoryPage({reset=false}={}){
  if(reset)inventoryPage=0;
  if(!selectedCategoryId)return;
  const revision=++inventoryRevision;
  document.getElementById("categoryMeta").textContent="Loading inventory…";
  try{
    const {data,error}=await bootSupabase().rpc("search_inventory_variants",{
      p_category_id:selectedCategoryId,
      p_search:document.getElementById("search").value.trim().slice(0,90),
      p_offset:inventoryPage*INVENTORY_PAGE_SIZE,
      p_limit:INVENTORY_PAGE_SIZE
    });
    if(error)throw error;
    if(revision!==inventoryRevision)return;
    inventoryTotal=Number(data?.total||0);
    inventoryStats={stock:Number(data?.stock||0),low:Number(data?.low||0),out:Number(data?.out||0)};
    inventory=Array.isArray(data?.rows)?data.rows:[];
    if(!inventory.length&&inventoryPage>0){inventoryPage--;return loadInventoryPage();}
    renderInventory();
    const previous=document.getElementById("inventoryPrev");
    const next=document.getElementById("inventoryNext");
    const info=document.getElementById("inventoryPageInfo");
    if(previous)previous.disabled=inventoryPage===0;
    if(next)next.disabled=(inventoryPage+1)*INVENTORY_PAGE_SIZE>=inventoryTotal;
    if(info)info.textContent=inventoryTotal
      ?"Page "+(inventoryPage+1)+" of "+Math.ceil(inventoryTotal/INVENTORY_PAGE_SIZE)
      :"No matching variants";
  }catch(error){
    if(revision!==inventoryRevision)return;
    console.error("Inventory query failed",error);
    document.getElementById("categoryMeta").textContent="Could not load inventory: "+error.message;
    document.getElementById("rows").innerHTML="<tr><td>Inventory unavailable. Retry your search or refresh the page.</td></tr>";
  }
}
function renderCategories(){
  document.getElementById("categoryTabs").innerHTML=categories.map(c=>
    '<button type="button" class="'+(c.id===selectedCategoryId?"active":"")+
    '" data-id="'+esc(c.id)+'">'+esc(c.name)+'</button>').join("");
  document.querySelectorAll("#categoryTabs button").forEach(button=>button.onclick=()=>{
    selectedCategoryId=button.dataset.id;renderCategories();loadInventoryPage({reset:true});
  });
}
function getInventoryStatus(v){const s=inventoryRules.getStockStatus(v.stock_quantity,v.low_stock_limit);return[s.label,s.tone];}
function esc(x){return String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));}
function renderInventory(){
  const cat=categories.find(c=>c.id===selectedCategoryId);if(!cat)return;
  const rows=inventory;
  document.getElementById("selectedCategory").textContent=cat.name;
  document.getElementById("categoryMeta").textContent=inventoryTotal+" matching product variants";
  document.getElementById("variantCount").textContent=inventoryTotal;
  document.getElementById("stockCount").textContent=inventoryStats.stock||0;
  document.getElementById("lowCount").textContent=inventoryStats.low||0;
  document.getElementById("outCount").textContent=inventoryStats.out||0;
let columns=["Code","Product","Type"];if(cat.has_color)columns.push("Color");if(cat.has_size)columns.push("Size");if(cat.has_length)columns.push("Length");if(cat.has_thickness)columns.push("Thickness");if(cat.has_gold_amount)columns.push("Gold Amount");columns.push("Stock","Limit","Status","Barcode","Actions");document.getElementById("head").innerHTML="<tr>"+columns.map(x=>"<th>"+x+"</th>").join("")+"</tr>";
document.getElementById("rows").innerHTML=rows.map(v=>{const p=v.products||{},[label,cls]=getInventoryStatus(v);let cells="<td><b>"+esc(p.product_code||"—")+"</b></td><td>"+esc(p.product_name||"—")+"</td><td>"+esc(p.type||"—")+"</td>";if(cat.has_color)cells+="<td>"+esc(v.color||"0")+"</td>";if(cat.has_size)cells+="<td>"+esc(v.size||"0")+"</td>";if(cat.has_length)cells+="<td>"+((v.length_cm??p.length_cm)==null?"—":esc(v.length_cm??p.length_cm)+" cm")+"</td>";if(cat.has_thickness)cells+="<td>"+esc(p.thickness||"—")+"</td>";if(cat.has_gold_amount)cells+="<td>"+(p.gold_amount_g==null?"—":esc(p.gold_amount_g)+" g")+"</td>";cells+="<td><b>"+Number(v.stock_quantity||0)+"</b></td><td>"+Number(v.low_stock_limit||0)+"</td><td><span class='"+cls+"'>"+label+"</span></td><td>"+esc(v.barcode||"—")+"</td>";cells+="<td><button type='button' class='stock-row-button' data-manage-stock='"+esc(v.id)+"'>Manage stock</button></td>";return"<tr>"+cells+"</tr>"}).join("")||"<tr><td colspan='"+columns.length+"'>No products found in this category.</td></tr>";
document.querySelectorAll("[data-manage-stock]").forEach(button=>{
  button.addEventListener("click",()=>inventoryTools?.open(button.dataset.manageStock,button));
});
}
document.getElementById("search").oninput=()=>{
  clearTimeout(inventorySearchTimer);
  inventorySearchTimer=setTimeout(()=>loadInventoryPage({reset:true}),260);
};
document.getElementById("inventoryPrev")?.addEventListener("click",()=>{
  if(inventoryPage>0){inventoryPage--;loadInventoryPage();}
});
document.getElementById("inventoryNext")?.addEventListener("click",()=>{
  if((inventoryPage+1)*INVENTORY_PAGE_SIZE<inventoryTotal){inventoryPage++;loadInventoryPage();}
});
if(document.getElementById("rows"))requireSession().then(loadInventory).catch(error=>{
  console.error("Inventory initialization failed",error);
  document.getElementById("categoryMeta").textContent=error.message||"Inventory unavailable.";
});