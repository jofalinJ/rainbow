(() => {
  const key="rainbow_cart_v1";
  const maxLines=50;
  const maxQuantity=100;

  function read(){
    try{
      const saved=JSON.parse(localStorage.getItem(key)||"[]");
      return Array.isArray(saved)?saved.filter(item=>
        item?.variant_id&&item.product&&Number.isInteger(Number(item.quantity))&&Number(item.quantity)>0
      ):[];
    }catch{return [];}
  }

  function add(line,quantity,stock){
    if(!Number.isInteger(quantity)||quantity<1)return "Choose a whole quantity of at least 1.";
    const items=read();
    const existing=items.find(item=>String(item.variant_id)===String(line.variant_id));
    if(!existing&&items.length>=maxLines)return "Your bag can hold up to "+maxLines+" different options. Remove an option before adding another.";
    const current=Number(existing?.quantity||0);
    const remaining=Math.max(0,Math.min(maxQuantity,Number(stock)||0)-current);
    if(quantity>remaining){
      if(remaining===0)return "You can’t add more of this option. Review the quantity in your bag.";
      return "You can add "+remaining+" more of this option. Choose a smaller quantity.";
    }
    const entry={...line,quantity:current+quantity};
    if(existing)Object.assign(existing,entry);else items.push(entry);
    try{
      localStorage.setItem(key,JSON.stringify(items));
    }catch{
      return "Could not save your bag on this device.";
    }
    return "";
  }

  window.RainbowBag={key,maxLines,maxQuantity,read,add};
})();
