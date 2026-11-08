import {describe,it,expect,vi} from "vitest";
import {buildOpeningStockPlan,createVariantStockOperation,saveVariantStockOperation} from "../../admin/product-opening-stock.mjs";

const branches=[{id:"shop-a",name:"Shop A",kind:"branch",active:true},{id:"shop-b",name:"Shop B",kind:"branch"}];
const plan=(changes={})=>buildOpeningStockPlan({quantity:"25",multiShop:true,locations:branches,locationId:"shop-a",...changes});
const operation=(opening=plan())=>createVariantStockOperation({
  productId:"product-1",draft:{color:"Pink",size:"08",length_cm:null,stock_quantity:25,low_stock_limit:3},
  opening,requestId:"receipt-1"
});
const callbacks=()=>({insertVariant:vi.fn().mockResolvedValue([{id:"variant-1",stock_quantity:0}]),receiveStock:vi.fn().mockResolvedValue({stock:25})});

describe("product opening stock",()=>{
  it("accepts trimmed nonnegative whole quantities and an authorized branch",()=>{
    expect(plan({quantity:" 25 "})).toEqual({quantity:25,multiShop:true,locationId:"shop-a",locationName:"Shop A"});
    expect(plan({quantity:"100000"}).quantity).toBe(100000);
    expect(plan({locationId:"shop-b"}).locationId).toBe("shop-b");
  });
  it.each(["",null,undefined,"-1","1.5","1e2","NaN","Infinity","9007199254740993"])("rejects invalid quantities (%s)",quantity=>{
    expect(()=>plan({quantity})).toThrow(/Initial stock/);
  });
  it("bounds branch receipt quantities and legacy database integers",()=>{
    expect(()=>plan({quantity:"100001"})).toThrow(/or less/);
    expect(plan({multiShop:false,quantity:"2147483647",locationId:""}).quantity).toBe(2147483647);
    expect(()=>plan({multiShop:false,quantity:"2147483648"})).toThrow(/or less/);
  });
  it("requires an active assigned physical branch only for positive multi-shop stock",()=>{
    for(const changes of [
      {locations:[]},{locationId:"unassigned"},{locationId:""},
      {locations:[{id:"shop-a",kind:"online",active:true}]},
      {locations:[{id:"shop-a",kind:"branch",active:false}]}
    ])expect(()=>plan(changes)).toThrow(/assigned shop/);
    expect(plan({quantity:"0",locations:[],active:false}).quantity).toBe(0);
    expect(plan({multiShop:false,locations:[],active:false}).quantity).toBe(25);
  });
  it("requires publishing before positive branch stock and permits zero-stock drafts",()=>{
    expect(()=>plan({active:false})).toThrow(/Make the product active/);
    expect(plan({active:false,quantity:"0"}).quantity).toBe(0);
  });
  it("inserts at zero online stock then receives the exact quantity into the chosen branch",async()=>{
    const save=operation(),io=callbacks();
    await expect(saveVariantStockOperation(save,io)).resolves.toEqual({id:"variant-1",stock_quantity:0});
    expect(io.insertVariant).toHaveBeenCalledExactlyOnceWith({
      product_id:"product-1",color:"Pink",size:"08",length_cm:null,stock_quantity:0,low_stock_limit:3
    });
    expect(io.receiveStock).toHaveBeenCalledExactlyOnceWith({
      p_location:"shop-a",p_variant:"variant-1",p_delta:25,
      p_reason:"Opening stock from product entry",p_request:"receipt-1"
    });
    expect(io.insertVariant.mock.invocationCallOrder[0]).toBeLessThan(io.receiveStock.mock.invocationCallOrder[0]);
    expect(save.stockSaved).toBe(true);
  });
  it.each([plan({quantity:"0",locations:[],active:false}),plan({multiShop:false})])("does not receive stock for zero or legacy entry",async opening=>{
    const save=operation(opening),io=callbacks();
    await saveVariantStockOperation(save,io);
    expect(io.insertVariant.mock.calls[0][0].stock_quantity).toBe(opening.multiShop?0:25);
    expect(io.receiveStock).not.toHaveBeenCalled();
    expect(save.stockSaved).toBe(true);
  });
  it("retains the variant and idempotency key after an ambiguous stock response",async()=>{
    const save=operation(),io=callbacks();
    io.receiveStock.mockRejectedValueOnce(new Error("Connection dropped"));
    await expect(saveVariantStockOperation(save,io)).rejects.toThrow("Connection dropped");
    expect(save.variant.id).toBe("variant-1");
    expect(save.stockSaved).toBe(false);
    await saveVariantStockOperation(save,io);
    await saveVariantStockOperation(save,io);
    expect(io.insertVariant).toHaveBeenCalledTimes(1);
    expect(io.receiveStock).toHaveBeenCalledTimes(2);
    expect(io.receiveStock.mock.calls[1]).toEqual(io.receiveStock.mock.calls[0]);
  });
  it("shares a concurrent save and never double-inserts or double-receives",async()=>{
    const save=operation(),io=callbacks();
    await Promise.all([saveVariantStockOperation(save,io),saveVariantStockOperation(save,io)]);
    expect(io.insertVariant).toHaveBeenCalledTimes(1);
    expect(io.receiveStock).toHaveBeenCalledTimes(1);
  });
  it.each([[],[{}],[{id:"one"},{id:"two"}],null])("does not receive an unverified variant %#",async rows=>{
    const save=operation(),io=callbacks();io.insertVariant.mockResolvedValue(rows);
    await expect(saveVariantStockOperation(save,io)).rejects.toThrow(/could not be verified/);
    expect(save.variant).toBe(null);
    expect(io.receiveStock).not.toHaveBeenCalled();
  });
  it("does not receive stock after a failed variant insert",async()=>{
    const save=operation(),io=callbacks();io.insertVariant.mockRejectedValue(new Error("Denied"));
    await expect(saveVariantStockOperation(save,io)).rejects.toThrow("Denied");
    expect(io.receiveStock).not.toHaveBeenCalled();
  });
  it("snapshots stock values so later form changes cannot alter a retry",async()=>{
    const opening=plan(),save=operation(opening),io=callbacks();
    opening.quantity=99;opening.locationId="shop-b";
    await saveVariantStockOperation(save,io);
    expect(io.receiveStock.mock.calls[0][0]).toMatchObject({p_delta:25,p_location:"shop-a"});
  });
});
