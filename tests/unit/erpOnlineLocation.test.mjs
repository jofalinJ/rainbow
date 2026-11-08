import {readFileSync} from "node:fs";
import {createContext,runInContext} from "node:vm";
import {expect,it,vi} from "vitest";

const readAdmin=name=>readFileSync(new URL(`../../admin/${name}.js`,import.meta.url),"utf8");
const inventorySource=readAdmin("inventory");
const erpSource=readAdmin("erp");

class Element extends EventTarget {
  children=[];
  textContent="";
  #value="";

  get value(){return this.#value;}
  set value(value){this.#value=this.options.some(option=>option.value===value)?value:"";}
  get options(){return this.children;}
  add(option){this.append(option);}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;this.value=children[0]?.value||"";}
}

async function loadInventoryLocationFixture(){
  const locations=[
    {id:"shop-a",name:"Shop A",kind:"branch",active:true},
    {id:"shop-b",name:"Shop B",kind:"branch",active:true},
    {id:"online",name:"Online Store",kind:"online",active:true}
  ];
  const transfer={id:"online-transfer",to_location:"online",from_location:"shop-a",
    quantity:2,reason:"Fixture online allocation",status:"in_transit"};
  const transferLocations=[],inventoryLoads=[];
  const rows={erp_locations:locations,erp_transfers:[transfer],erp_suppliers:[],erp_purchase_orders:[]};
  const client={
    from(table){
      const filters={};
      const query={
        select(){return query;},order(){return query;},limit(){return query;},
        eq(key,value){filters[key]=value;return query;},
        then(resolve){
          if(table==="erp_transfers")transferLocations.push(filters.to_location);
          const data=rows[table].filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value));
          return Promise.resolve({data,error:null}).then(resolve);
        }
      };
      return query;
    },
    rpc:vi.fn(async(name,params)=>{
      if(name==="erp_receive_transfer"&&params.p_transfer===transfer.id)transfer.status="received";
      return {data:{},error:null};
    })
  };
  let initErp;
  const elements=new Map();
  const get=id=>{
    if(id==="rows")return null;
    if(!elements.has(id))elements.set(id,new Element());
    return elements.get(id);
  };
  const document={
    readyState:"loading",getElementById:get,createElement:()=>new Element(),
    addEventListener(type,listener){if(type==="DOMContentLoaded")initErp=listener;}
  };
  const window={
    RAINBOW_MULTI_SHOP_ENABLED:true,requireSession:async()=>{},bootSupabase:()=>client,
    getAuthUser:async()=>({id:"fixture-admin"}),getMyProfile:async()=>({active:true,role:"admin"}),
    addEventListener(){}
  };
  const context=createContext({document,window,bootSupabase:window.bootSupabase,inventoryLoads,Event,URL,
    location:{href:"https://example.invalid/admin/inventory.html"},
    Option:class {constructor(label,value){this.label=label;this.value=value;}}
  });
  runInContext(inventorySource,context,{filename:"admin/inventory.js"});
  // Run the real branch picker. Stub the unrelated inventory table reload.
  await runInContext("loadInventory=async()=>inventoryLoads.push(inventoryBranchId);loadInventoryBranchPicker();",context);
  runInContext(erpSource,context,{filename:"admin/erp.js"});
  await initErp();
  expect(get("erpStatus").textContent).toBe("Shared catalogue and shop stock controls loaded.");
  transferLocations.length=0;
  const workingLocation=get("erpLocation"),branchPicker=get("inventoryBranchSelect");
  const choose=(picker,value)=>{picker.value=value;picker.dispatchEvent(new Event("change"));};
  return {workingLocation,branchPicker,choose,transferLocations,inventoryLoads,get,client};
}

it("keeps Online Store selected and loads its pending receipt without changing the physical shop",async()=>{
  const {workingLocation,branchPicker,choose,transferLocations,inventoryLoads,get,client}=await loadInventoryLocationFixture();
  expect(branchPicker.value).toBe("shop-a");
  expect(branchPicker.options.map(option=>option.value)).toEqual(["","shop-a","shop-b"]);

  choose(workingLocation,"online");

  expect(workingLocation.value).toBe("online");
  expect(branchPicker.value).toBe("shop-a");
  expect(inventoryLoads).toEqual([]);
  await vi.waitFor(()=>expect(transferLocations).toEqual(["online"]));
  await vi.waitFor(()=>expect(get("erpPendingTransfers").children).toHaveLength(1));
  const receiptButton=get("erpPendingTransfers").children[0].children[1];
  expect(receiptButton.textContent).toBe("Confirm receipt");
  receiptButton.dispatchEvent(new Event("click"));
  await vi.waitFor(()=>expect(client.rpc).toHaveBeenCalledWith("erp_receive_transfer",{p_transfer:"online-transfer"}));
});

it("still keeps both selectors aligned when switching between physical shops",async()=>{
  const {workingLocation,branchPicker,choose,transferLocations,inventoryLoads}=await loadInventoryLocationFixture();

  choose(workingLocation,"shop-b");
  expect(branchPicker.value).toBe("shop-b");
  expect(inventoryLoads).toEqual(["shop-b"]);
  await vi.waitFor(()=>expect(transferLocations).toContain("shop-b"));

  choose(branchPicker,"shop-a");
  expect(workingLocation.value).toBe("shop-a");
  expect(inventoryLoads).toEqual(["shop-b","shop-a"]);
  await vi.waitFor(()=>expect(transferLocations).toContain("shop-a"));
});
