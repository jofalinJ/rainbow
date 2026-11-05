import {describe,it,expect,vi} from "vitest";
import {validateOpeningStock,makeOpeningStockOperation,restoreOpeningStockOperation,receiveOpeningStock} from "../../admin/product-opening-stock.mjs";

const branch={id:"shop-a",name:"Thuckalay",kind:"branch",active:true};
const product={id:"product-a",product_code:"RGN00001",active:true};
const draft=quantity=>({quantity,locationId:branch.id,locations:[branch],active:true});
const makeOperation=()=>makeOpeningStockOperation({product,variantId:"variant-a",quantity:12,
  location:branch,requestId:"unchanged-request-id"});

describe("opening stock at an assigned physical shop",()=>{
  it("normalizes a valid entered quantity and preserves the authorized shop",()=>{
    expect(validateOpeningStock(draft(" 12 "))).toEqual({quantity:12,location:branch});
    expect(validateOpeningStock(draft("100000")).quantity).toBe(100000);
  });
  it("allows a zero-stock draft without a shop assignment",()=>{
    expect(validateOpeningStock({quantity:"0",active:false})).toEqual({quantity:0,location:null});
    expect(makeOpeningStockOperation({quantity:0})).toBeNull();
  });
  it.each(["",null,"-1","1.5","1e2","12 units","100001",Infinity,"9007199254740992"])("rejects invalid quantity %s before any save",quantity=>{
    expect(()=>validateOpeningStock(draft(quantity))).toThrow("whole number");
  });
  it("refuses stock for a draft product before creation",()=>{
    expect(()=>validateOpeningStock({...draft(2),active:false})).toThrow("Make the product active");
  });
  it("requires a location from the caller's authorized shop list",()=>{
    expect(()=>validateOpeningStock({...draft(2),locationId:"unassigned"})).toThrow("assigned physical shop");
    expect(()=>validateOpeningStock({...draft(2),locations:[]})).toThrow("assigned physical shop");
  });
  it("refuses inactive branches and online allocations",()=>{
    for(const location of [{...branch,active:false},{...branch,kind:"online"}]) {
      expect(()=>validateOpeningStock({...draft(2),locations:[location]})).toThrow("assigned physical shop");
    }
  });
  it("captures an immutable operation for the saved variant and selected shop",()=>{
    const operation=makeOperation();
    expect(operation).toEqual({productId:"product-a",productCode:"RGN00001",variantId:"variant-a",
      locationId:"shop-a",locationName:"Thuckalay",quantity:12,requestId:"unchanged-request-id",
      reason:"Opening stock for RGN00001"});
    expect(Object.isFrozen(operation)).toBe(true);
  });
  it("requires the saved variant and a stable request identifier",()=>{
    for(const missing of [{variantId:""},{requestId:""}]) {
      expect(()=>makeOpeningStockOperation({product,variantId:"variant-a",quantity:1,location:branch,
        requestId:"request-a",...missing})).toThrow("is missing");
    }
  });
  it("restores a serialized request without changing its idempotency key or payload",()=>{
    const original=makeOperation(),restored=restoreOpeningStockOperation(JSON.parse(JSON.stringify(original)));
    expect(restored).toEqual(original);
    expect(Object.isFrozen(restored)).toBe(true);
  });
  it.each([{quantity:-12},{quantity:0},{quantity:"12"},{requestId:""},{variantId:{}},
    {reason:"Some different adjustment"}])("rejects corrupted recovered request %s before sending",async changed=>{
    const client={rpc:vi.fn()};
    await expect(receiveOpeningStock(client,{...makeOperation(),...changed})).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("retries a lost response using exactly the same audited RPC request",async()=>{
    const operation=makeOperation();
    const client={rpc:vi.fn().mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce({data:{stock:12,already_applied:true},error:null})};
    await expect(receiveOpeningStock(client,operation)).rejects.toThrow("Connection lost");
    await expect(receiveOpeningStock(client,operation)).resolves.toEqual({stock:12,already_applied:true});
    const expected=["erp_adjust_stock",{p_location:"shop-a",p_variant:"variant-a",p_delta:12,
      p_reason:"Opening stock for RGN00001",p_request:"unchanged-request-id"}];
    expect(client.rpc.mock.calls).toEqual([expected,expected]);
  });
  it("reports server permission errors without treating them as receipt success",async()=>{
    const client={rpc:vi.fn().mockResolvedValue({data:null,error:{message:"Not assigned to this shop"}})};
    await expect(receiveOpeningStock(client,makeOperation())).rejects.toThrow("Not assigned to this shop");
  });
  it.each([null,{stock:-1},{stock:"12"},{stock:1.5},{stock:1000000001}])("does not confirm a malformed receipt %s",async data=>{
    const client={rpc:vi.fn().mockResolvedValue({data,error:null})};
    await expect(receiveOpeningStock(client,makeOperation())).rejects.toThrow("could not be confirmed");
  });
});
