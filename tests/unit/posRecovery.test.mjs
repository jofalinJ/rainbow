import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import {runInNewContext} from "node:vm";

// Execute the real recovery functions in a constrained, browser-shaped context.
const source=readFileSync(new URL("../../admin/billing.js",import.meta.url),"utf8");
const start=source.indexOf("let pendingSale=null;");
const end=source.indexOf("let catalogueRevision=0;",start);
if(start<0||end<=start)throw new Error("Could not locate POS recovery functions");

function browserContext(){
  const values=new Map();
  const sessionStorage={
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>{values.set(key,String(value));},
    removeItem:key=>{values.delete(key);}
  };
  const globals={sessionStorage,crypto:webcrypto,TextEncoder,console};
  const recovery=runInNewContext(source.slice(start,end)+
    "\n;({readPendingSale,clearPendingSale,saleRequestHash,validPendingSale})",globals);
  return {sessionStorage,...recovery};
}
const UUID="123e4567-e89b-42d3-a456-426614174000";
const items=[{variant_id:UUID,quantity:2}];
const customer={name:"Customer Example",whatsapp_number:"9000000000",address:"Only test address"};

describe("POS retry across a tab reload",()=>{
  it("derives a deterministic SHA-256 digest without persisting customer details",async()=>{
    const ctx=browserContext();
    const hash=await ctx.saleRequestHash(items,"cash",customer);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const record={id:UUID,hash};
    ctx.sessionStorage.setItem("rainbow_pos_pending_sale_v1",JSON.stringify(record));
    expect(JSON.stringify(ctx.readPendingSale())).toBe(JSON.stringify(record));
    const stored=ctx.sessionStorage.getItem("rainbow_pos_pending_sale_v1");
    expect(stored).not.toContain("Customer Example");
    expect(stored).not.toContain("9000000000");
    expect(stored).not.toContain("Only test address");
    expect(await ctx.saleRequestHash(items,"cash",customer)).toBe(hash);
  });
  it("detects changed cart, payment or customer details instead of reusing an unsafe sale ID",async()=>{
    const ctx=browserContext();
    const expected=await ctx.saleRequestHash(items,"cash",customer);
    expect(await ctx.saleRequestHash(items,"upi",customer)).not.toBe(expected);
    expect(await ctx.saleRequestHash([{...items[0],quantity:1}],"cash",customer)).not.toBe(expected);
    expect(await ctx.saleRequestHash(items,"cash",{...customer,name:"Different name"})).not.toBe(expected);
  });
  it("rejects malformed stored recovery IDs and clears them on confirmed success",async()=>{
    const ctx=browserContext();
    ctx.sessionStorage.setItem("rainbow_pos_pending_sale_v1",JSON.stringify({id:"bad",hash:"no"}));
    expect(ctx.readPendingSale()).toBe(null);
    ctx.sessionStorage.setItem("rainbow_pos_pending_sale_v1",JSON.stringify({
      id:UUID,hash:"a".repeat(64)
    }));
    expect(ctx.readPendingSale().id).toBe(UUID);
    ctx.clearPendingSale();
    expect(ctx.sessionStorage.getItem("rainbow_pos_pending_sale_v1")).toBe(null);
  });
});
