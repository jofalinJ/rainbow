/* Pure catalogue-admin helpers. No browser/network dependencies. */
(function(root){
 "use strict";
 const PAGE_SIZE=40,IMPORT_MAX=500,IMAGE_MAX=50;
 const SELECT="id,product_code,product_name,type,gender,display_priority,active,selling_price,category_id,length_cm,description,thickness,gold_amount_g,product_variants(id,color,size,length_cm,stock_quantity,active),product_images(id,public_url,storage_path,is_primary,sort_order)";
 const FIELDS=["product_code","category","product_name","type","selling_price","gender","color","size","length_cm","description","thickness","gold_amount_g"];
 const CODE_RE=/^[A-Za-z0-9][A-Za-z0-9/_-]{1,39}$/;
 const number=value=>Number(value);
 const cleanSearch=input=>String(input??"").trim().replace(/[^\\p{L}\\p{N}\\s/_-]/gu," ").replace(/\\s+/g," ").slice(0,70);
 function csvParse(source){
   const sourceText=String(source??"").replace(/^\uFEFF/,"");
   const rows=[];let row=[],value="",quoted=false;
   for(let i=0;i<sourceText.length;i++){
     const ch=sourceText[i];
     if(quoted){
       if(ch==='"'&&sourceText[i+1]==='"'){value+='"';i++;}
       else if(ch==='"')quoted=false;
       else value+=ch;
     }else if(ch==='"'){if(value!=="")throw Error("Unexpected quote at character "+i);quoted=true;}
     else if(ch===","){row.push(value);value="";}
     else if(ch==="\r"||ch==="\n"){
       if(ch==="\r"&&sourceText[i+1]==="\n")i++;
       row.push(value);value="";if(row.some(x=>x.trim()!==""))rows.push(row);row=[];
     }else value+=ch;
   }
   if(quoted)throw Error("Unclosed quoted value in CSV");
   row.push(value);if(row.some(x=>x.trim()!==""))rows.push(row);
   return rows;
 }
 function parseImport(text){
   const rows=csvParse(text);
   if(!rows.length)throw Error("CSV file is empty.");
   const header=rows[0].map(x=>x.trim().toLowerCase().replace(/\s+/g,"_"));
   if(new Set(header).size!==header.length)throw Error("Duplicate CSV column heading.");
   for(const required of ["product_code","category","product_name","type","selling_price"]){
     if(!header.includes(required))throw Error("Missing CSV column: "+required);
   }
   if(rows.length-1>IMPORT_MAX)throw Error("Import up to "+IMPORT_MAX+" products per CSV. Split larger files.");
   const codes=new Set();
   return rows.slice(1).map((cells,index)=>{
     const raw=Object.fromEntries(header.map((h,i)=>[h,String(cells[i]??"").trim()]));
     const issues=[];
     if(cells.length>header.length)issues.push("Too many CSV columns");
     const code=raw.product_code||"";
     if(!CODE_RE.test(code))issues.push("Code must be 2–40 letters, digits, /, - or _");
     if(codes.has(code.toLowerCase()))issues.push("Duplicate code within this CSV");
     codes.add(code.toLowerCase());
     for(const key of ["category","product_name","type"]){
       if(!raw[key])issues.push("Missing "+key);
     }
     if((raw.product_name||"").length>160)issues.push("Name exceeds 160 characters");
     if((raw.type||"").length>100)issues.push("Type exceeds 100 characters");
     const price=number(raw.selling_price);
     if(!Number.isFinite(price)||price<=0||price>10000000||!/^\d+(?:\.\d{1,2})?$/.test(raw.selling_price||""))issues.push("Invalid positive rupee price");
     const audience=(raw.gender||"women").toLowerCase();
     if(!["women","male","unisex"].includes(audience))issues.push("Audience must be women, male or unisex");
     const len=raw.length_cm===""||raw.length_cm==null?null:number(raw.length_cm);
     if(len!==null&&(!Number.isFinite(len)||len<=0||len>10000))issues.push("Invalid positive length");
     const gold=raw.gold_amount_g===""||raw.gold_amount_g==null?null:number(raw.gold_amount_g);
     if(gold!==null&&(!Number.isFinite(gold)||gold<0||gold>100000))issues.push("Invalid gold amount");
     if((raw.description||"").length>4000)issues.push("Description exceeds 4,000 characters");
     return {number:index+2,raw,issues};
   });
 }
 function resolveImport(rows,categories){
   const byName=new Map(categories.map(c=>[c.name.trim().toLowerCase(),c]));
   return rows.map(row=>{
     const category=byName.get((row.raw.category||"").toLowerCase());
     const issues=row.issues.slice();
     if(!category)issues.push("Unknown category: "+row.raw.category);
     if(category?.has_length&&!Number(row.raw.length_cm))issues.push("Category requires length_cm");
     if(category?.has_color&&!row.raw.color)issues.push("Category requires color");
     if(category?.has_size&&!row.raw.size)issues.push("Category requires size");
     const p=row.raw;const length=p.length_cm?Number(p.length_cm):null;
     return {...row,issues,category,
       product:category?{
         category_id:category.id,product_code:p.product_code,product_name:p.product_name,type:p.type,
         selling_price:Number(p.selling_price),gender:(p.gender||"women").toLowerCase(),
         description:p.description||null,length_cm:length,
         thickness:p.thickness||null,gold_amount_g:p.gold_amount_g?Number(p.gold_amount_g):null,
         active:false
       }:null,
       variant:category?{
         color:category.has_color?(p.color||"0"):"0",size:category.has_size?(p.size||"0"):"0",
         length_cm:category.has_length?length:null,stock_quantity:0,low_stock_limit:3,active:true
       }:null};
   });
 }
 function safeCsvCell(value){
   const raw=String(value??"");
   const sanitized=/^[=+@\t\r]/.test(raw)?("'"+raw):raw;
   return '"'+sanitized.replaceAll('"','""')+'"';
 }
 function csvString(rows){return rows.map(row=>row.map(safeCsvCell).join(",")).join("\r\n")+"\r\n";}
 function parsePhotoName(name){
   const match=/^(.+)__([1-5])\.(?:jpe?g|png|webp)$/i.exec(String(name||""));
   if(!match)return null;
   if(match[1].includes("/"))return null; // Slash-containing SKUs must use portable %2F filenames.
   let code;
   try{code=decodeURIComponent(match[1]);}catch{return null;}
   return CODE_RE.test(code)?{code,position:Number(match[2]),filename:name}:null;
 }
 async function list(client,{page=0,search="",status="all",categories=[]}={}){
   const current=Math.max(0,Math.floor(Number(page)||0));
   let query=client.from("products").select(SELECT,{count:"exact"});
   if(status==="published")query=query.eq("active",true);
   if(status==="draft")query=query.eq("active",false);
   const term=cleanSearch(search);
   if(term){
     const ids=categories.filter(c=>c.name.toLowerCase().includes(term.toLowerCase())).map(c=>c.id).filter(id=>/^[a-f0-9-]{36}$/i.test(id)).slice(0,25);
     const ors=["product_code","product_name","type"].map(col=>col+".ilike.%"+term+"%");
     if(ids.length)ors.push("category_id.in.("+ids.join(",")+")");
     query=query.or(ors.join(","));
   }
   query=query.order("created_at",{ascending:false}).order("id",{ascending:true})
     .range(current*PAGE_SIZE,(current+1)*PAGE_SIZE-1);
   const {data,error,count}=await query;
   if(error)throw error;
   return {rows:data||[],count:Math.max(0,count||0),page:current,pageSize:PAGE_SIZE,
     pages:Math.ceil(Math.max(0,count||0)/PAGE_SIZE)};
 }
 root.RainbowAdminCatalogue={PAGE_SIZE,IMPORT_MAX,IMAGE_MAX,FIELDS,SELECT,csvParse,parseImport,resolveImport,
   csvString,safeCsvCell,parsePhotoName,list,cleanSearch};
})(typeof window!=="undefined"?window:globalThis);
