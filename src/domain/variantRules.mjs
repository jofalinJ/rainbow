// Shared, side-effect-free rules for creating a new product variation.
// Database enforces uniqueness, including length, to protect concurrent writes.
function nonNegativeInteger(raw,label){
  const text=String(raw??"").trim();
  if(!/^\d+$/.test(text))throw new Error(label+" must be a whole number of zero or more.");
  const value=Number(text);
  if(!Number.isSafeInteger(value)||value>1_000_000_000)throw new Error(label+" is too large.");
  return value;
}
export function buildVariantDraft(category,fields){
  if(!category)throw new Error("Choose an existing product and category.");
  const color=category.has_color?String(fields.color??"").trim()||"0":"0";
  const size=category.has_size?String(fields.size??"").trim()||"0":"0";
  const rawLength=String(fields.length??"").trim();
  let length=null;
  if(category.has_length){
    if(!rawLength)throw new Error("Enter a length in centimetres.");
    length=Number(rawLength);
    if(!Number.isFinite(length)||length<=0||length>100000)throw new Error("Enter a valid positive length in centimetres.");
    if(!/^\d+(?:\.\d{1,2})?$/.test(rawLength))throw new Error("Enter length with at most two decimal places.");
  }
  if(color.length>80||size.length>80)throw new Error("Color and size must be 80 characters or fewer.");
  return {color,size,length_cm:length,stock_quantity:nonNegativeInteger(fields.stock,"Stock"),
    low_stock_limit:nonNegativeInteger(fields.low,"Low stock limit")};
}
export function sameVariant(a,b){
  const normalize=v=>String(v??"0").trim().toLowerCase();
  const length=v=>v==null||String(v).trim()===""?null:Number(v);
  return normalize(a.color)===normalize(b.color)&&normalize(a.size)===normalize(b.size)
    &&length(a.length_cm)===length(b.length_cm);
}
