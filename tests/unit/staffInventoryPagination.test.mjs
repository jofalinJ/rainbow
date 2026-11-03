import {describe,it,expect} from "vitest";
import {fetchInventoryVariants,fetchBranchAvailableBalances} from "../../admin/inventory-page-loader.mjs";
import {readFileSync} from "node:fs";

function fakeClient(rows,failedPage=-1){
  const calls=[];
  let rangeCount=0;
  const client={
    from(table){
      calls.push(["from",table]);
      const query={
        select(columns){calls.push(["select",columns]);return query;},
        eq(...args){calls.push(["eq",...args]);return query;},
        order(...args){calls.push(["order",...args]);return query;},
        range(first,last){
          calls.push(["range",first,last]);
          if(rangeCount++===failedPage)return Promise.resolve({error:{message:"network failure"},data:null});
          return Promise.resolve({data:rows.slice(first,last+1),error:null});
        }
      };
      return query;
    }
  };
  return {client,calls};
}

describe("staff inventory pagination",()=>{
  it("loads all 1,205 variants without silently stopping at the 1,000-row API cap",async()=>{
    const rows=Array.from({length:1205},(_,i)=>({id:String(i)}));
    const {client,calls}=fakeClient(rows);
    expect(await fetchInventoryVariants(client)).toEqual(rows);
    expect(calls.filter(c=>c[0]==="range")).toEqual([
      ["range",0,499],["range",500,999],["range",1000,1499]
    ]);
    expect(calls).toContainEqual(["eq","active",true]);
    expect(calls.filter(c=>c[0]==="order").map(c=>c[1])).toContain("id");
  });

  it("does not convert network or RLS errors into an incomplete inventory",async()=>{
    const rows=Array.from({length:10},(_,i)=>({id:String(i)}));
    const {client}=fakeClient(rows,1);
    await expect(fetchInventoryVariants(client,{pageSize:5,maxPages:5}))
      .rejects.toThrow("Inventory page 2 failed");
  });

  it("fails safely at an exact pagination limit instead of returning a misleading partial list",async()=>{
    const rows=Array.from({length:15},(_,i)=>({id:String(i)}));
    const {client}=fakeClient(rows);
    await expect(fetchInventoryVariants(client,{pageSize:5,maxPages:2}))
      .rejects.toThrow("exceeds safe loading limit");
  });

  it("computes available branch quantities as on hand minus reserved",async()=>{
    const rows=[
      {variant_id:"one",on_hand:6,reserved:2},
      {variant_id:"two",on_hand:0,reserved:0},
      {variant_id:"three",on_hand:3,reserved:3}
    ];
    const {client,calls}=fakeClient(rows);
    const balances=await fetchBranchAvailableBalances(client,"branch-1",{pageSize:2,maxPages:5});
    expect([...balances.entries()]).toEqual([["one",4],["two",0],["three",0]]);
    expect(calls).toContainEqual(["eq","location_id","branch-1"]);
    expect(calls).toContainEqual(["order","variant_id",{ascending:true}]);
    expect(calls.filter(c=>c[0]==="range")).toEqual([["range",0,1],["range",2,3]]);
  });

  it("refuses corrupt server stock balances rather than displaying false availability",async()=>{
    for(const row of [
      {variant_id:"x",on_hand:1,reserved:2},
      {variant_id:"x",on_hand:-1,reserved:0},
      {variant_id:"x",on_hand:"NaN",reserved:0}
    ]){
      const {client}=fakeClient([row]);
      await expect(fetchBranchAvailableBalances(client,"branch-1"))
        .rejects.toThrow("Invalid branch stock balance");
    }
  });

  it("does not query all branches when no branch has been selected",async()=>{
    const {client,calls}=fakeClient([{variant_id:"x",on_hand:2,reserved:0}]);
    expect((await fetchBranchAvailableBalances(client,"")).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("rejects unbounded paging settings",async()=>{
    const {client}=fakeClient([]);
    await expect(fetchInventoryVariants(client,{pageSize:5000,maxPages:1}))
      .rejects.toThrow("Invalid inventory page limits");
  });

  it("ignores stale async results when staff rapidly changes shops",()=>{
    const code=readFileSync(new URL("../../admin/inventory.js",import.meta.url),"utf8");
    expect(code).toContain("const epoch=++inventoryLoadEpoch,selectedLocation=inventoryBranchId;");
    expect(code).toContain("if(epoch!==inventoryLoadEpoch)return;");
    expect(code).toContain("pages.fetchInventoryVariants(client)");
    expect(code).toContain("pages.fetchBranchAvailableBalances(client,selectedLocation)");
  });
});
