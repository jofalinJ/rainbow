import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const migration=prefix=>read("supabase/migrations/20261025"+prefix);

describe("isolated shop staff sessions",()=>{
  it("uses the same per-tab session store for login and the protected console",()=>{
    const login=read("admin/login.html");
    const app=read("admin/app.js");
    for(const code of [login,app]){
      expect(code).toContain("storage:window.sessionStorage");
      expect(code).toContain('storageKey:"rainbow-staff-session"');
      expect(code).toContain("detectSessionInUrl:false");
    }
  });
});

describe("exactly-once local POS billing",()=>{
  const sql=migration("120100_idempotent_local_sales.sql");
  const client=read("admin/billing.js");
  it("persists the request result atomically and locks concurrent retries",()=>{
    expect(sql).toContain("app_private.local_sale_requests");
    expect(sql).toContain("on conflict (request_id) do nothing");
    expect(sql).toContain("where request_id = v_request_id for update");
    expect(sql).toContain("v_existing_hash is distinct from v_request_hash");
    expect(sql).toContain("if v_existing_response is not null then return v_existing_response;");
    expect(sql).toContain("set response=v_final_response");
  });
  it("rejects duplicate variant lines and handles unnamed walk-ins",()=>{
    expect(sql).toContain("Duplicate product variant in sale");
    expect(sql.match(/CREATE OR REPLACE FUNCTION public\.create_local_sale/g)).toHaveLength(1);
    expect(sql.match(/\$function\$/g)).toHaveLength(2);
    expect(sql).toContain("coalesce(v_customer_phone,'')");
    expect(sql).toContain("return v_final_response;");
    expect(sql).toContain("$function$;");
    expect(sql).toContain("public.get_local_sale_receipt(p_request_id uuid)");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("created_by=auth.uid()");
    expect(sql).toContain("revoke all on function public.get_local_sale_receipt(uuid) from public, anon, authenticated");
    expect(sql).toContain("coalesce(v_customer_name, 'Walk-in Customer')");
    expect(sql).not.toContain("if v_customer_name is not null or v_customer_phone is not null then");
  });
  it("retries with the same ID and never retries because a receipt refresh fails",()=>{
    expect(client).toContain('const PENDING_SALE_KEY="rainbow_pos_pending_sale_v1"');
    expect(client).toContain("sessionStorage.setItem(PENDING_SALE_KEY,JSON.stringify(next))");
    expect(client).toContain("pendingSale=pendingSale||readPendingSale()");
    expect(client).toContain("const hash=await saleRequestHash(items,payment,customer)");
    expect(client).toContain("if(pendingSale&&pendingSale.hash!==hash)");
    expect(client).toContain("clearPendingSale()");
    expect(client).toContain('rpc("get_local_sale_receipt",{p_request_id:previous.id})');
    expect(client).toContain('if(pendingSale)await recoverPreviousSale()');
    expect(client).toContain("if(pendingSale?.id===previous.id)clearPendingSale()");

    expect(client).not.toContain("pendingSale.fingerprint");
    expect(client).toContain("saleBusy=true;");
    expect(client.indexOf("saleBusy=true;",client.indexOf("async function completeSale"))).toBeLessThan(
      client.indexOf("await saleRequestHash(items,payment,customer)"));
    expect(client).toContain("customer.client_sale_id=pendingSale.id");
    expect(client).toContain("if(cart.size===0||saleBusy)return;");
    expect(client).toContain('showReceipt(data,savedItems,customerPhone,customerName)');
    expect(client).toContain('console.warn("Catalogue refresh failed after sale"');
  });
});

describe("privilege separation and atomic product inserts",()=>{
  const policy=migration("120200_harden_local_order_rls.sql");
  const productSql=migration("120300_atomic_product_creation.sql");
  const productJs=read("admin/products.js");
  it("prevents untrusted customers from directly creating local orders and payments",()=>{
    for(const table of ["orders","order_items","payments"]){
      expect(policy).toContain("on public."+table+";");
    }
    expect(policy).toContain("revoke truncate, trigger, references");
  });
  it("creates a product and first variant inside one staff-RLS-controlled transaction",()=>{
    expect(productSql).toContain("security invoker");
    expect(productSql).toContain("public.is_inventory_staff()");
    expect(productSql).toContain("insert into public.products");
    expect(productSql).toContain("insert into public.product_variants");
    expect(productJs).toContain('rpc("create_product_with_variant"');
    expect(productJs).toContain("Product exists, but the remaining photos did not upload");
  });
});

describe("large-catalogue bounded admin queries",()=>{
  const admin=read("admin/app.js");
  const reports=read("admin/reports.js");
  const bills=read("admin/bills.js");
  const billing=read("admin/billing.js");
  const inventory=read("admin/inventory.js");
  it("computes exact reporting totals in SQL and loads only recent display rows",()=>{
    expect(migration("120400_admin_exact_metrics.sql")).toContain("get_admin_operational_metrics");
    expect(admin).toContain('rpc("get_admin_operational_metrics")');
    expect(reports).toContain('rpc("get_admin_operational_metrics")');
    expect(reports).toContain(".limit(30)");
  });
  it("paginates invoices and inventory with exact matching totals",()=>{
    expect(migration("120500_paginated_bill_history.sql")).toContain("search_shop_bills");
    expect(migration("120600_paginated_inventory.sql")).toContain("search_inventory_variants");
    expect(bills).toContain('rpc("search_shop_bills"');
    expect(inventory).toContain('rpc("search_inventory_variants"');
    expect(read("admin/bills.html")).toContain('id="billNext"');
    expect(read("admin/inventory.html")).toContain('id="inventoryNext"');
    expect(inventory).not.toContain('inventory=await sb("product_variants?select=');
  });
  it("searches POS products without requesting all 10,000 rows",()=>{
    expect(billing).toContain(".limit(120)");
    expect(billing).toContain('.ilike("barcode",q)');
    expect(billing).not.toContain("&limit=1000");
  });
});
