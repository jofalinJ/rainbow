import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {validateStockAdjustment,movementDelta} from "../../src/domain/stockAdjustmentRules.mjs";

const source=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const sql=source("supabase/migrations/20261015195000_inventory_adjustments_and_history.sql");
describe("safe stock adjustments",()=>{
  it("accepts adding or removing whole-number units",()=>{
    expect(validateStockAdjustment("add","12","Received from supplier",20))
      .toEqual({change:12,reason:"Received from supplier",after:32});
    expect(validateStockAdjustment("remove","5","Damaged while packaging",20))
      .toEqual({change:-5,reason:"Damaged while packaging",after:15});
  });
  it("allows removing precisely the available stock, including the last unit",()=>{
    expect(validateStockAdjustment("remove","20","Corrected physical stock count",20).after).toBe(0);
  });
  it.each([
    ["remove","6","Damaged stock",5,"available"],
    ["add","0","Received items",10,"1 to 100,000"],
    ["add","-2","Received items",10,"whole-number"],
    ["remove","0.2","Damage report",10,"whole-number"],
    ["add","100001","Large delivery",10,"1 to 100,000"],
    ["add","7","short",10,"8 to 240"],
    ["lost","7","Damage report",10,"Choose Add or Remove"],
    ["add","7","Received items",-1,"unavailable"]
  ])("rejects invalid adjustment %#",(direction,qty,reason,stock,text)=>{
    expect(()=>validateStockAdjustment(direction,qty,reason,stock)).toThrow(text);
  });
  it("displays legacy transactions and new signed changes correctly",()=>{
    expect(movementDelta({transaction_type:"sale_local",quantity:4})).toBe(-4);
    expect(movementDelta({transaction_type:"sale_online",quantity:6})).toBe(-6);
    expect(movementDelta({transaction_type:"stock_in",quantity:9})).toBe(9);
    expect(movementDelta({transaction_type:"return",quantity:3})).toBe(3);
    expect(movementDelta({transaction_type:"damage",quantity:2})).toBe(-2);
    expect(movementDelta({transaction_type:"adjustment",quantity:2,quantity_delta:-2})).toBe(-2);
  });
});
describe("inventory audit and backend permissions",()=>{
  it("uses the existing table and signed balances without overwriting historic transactions",()=>{
    expect(sql).toContain("alter table public.inventory_transactions");
    expect(sql).toContain("add column if not exists quantity_delta");
    expect(sql).toContain("add column if not exists stock_before");
    expect(sql).toContain("stock_after - stock_before = quantity_delta");
    expect(sql).not.toMatch(/delete from public\.inventory_transactions/i);
  });
  it("checks active roles, locks variants and prevents stock falling below zero",()=>{
    expect(sql).toContain("s.active=true and s.role in ('admin','inventory_staff')");
    expect(sql).toContain("for update of v");
    expect(sql).toContain("if v_after < 0");
    expect(sql).toContain("v_before::bigint+p_quantity_change::bigint");
    expect(sql).toContain("insert into public.inventory_transactions(");
    expect(sql).toContain("auth.uid()");
  });
  it("makes transaction history read-only to browser clients while allowing RPC",()=>{
    expect(sql).toContain("revoke all privileges on public.inventory_transactions from anon,authenticated");
    expect(sql).toContain("grant select on public.inventory_transactions to authenticated");
    expect(sql).toContain('create policy "Authorized staff read stock history"');
    expect(sql).toContain("grant execute on function public.adjust_variant_stock(uuid,integer,text)");
    const ui=source("admin/inventory.js"),html=source("admin/inventory.html");
    const controller=source("admin/inventory-adjustments.mjs");
    expect(ui).toContain('inventory-adjustments.mjs');
    expect(ui).toContain('data-manage-stock');
    expect(ui).toContain('v.length_cm??p.length_cm');
    expect(html).toContain('id="stockAdjustmentForm"');
    expect(html).toContain('id="stockHistory"');
    expect(controller).toContain('rpc("adjust_variant_stock"');
    expect(controller).toContain('.from("inventory_transactions")');
    expect(controller).toContain('onUpdated()');
  });
});
