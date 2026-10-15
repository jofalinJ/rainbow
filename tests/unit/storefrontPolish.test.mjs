import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const promoSql=read("supabase/migrations/20261015180000_ordered_storefront_promotions.sql");
const attendanceSql=read("supabase/migrations/20261015180500_exclude_admin_personal_attendance.sql");
describe("admin and customer page improvements",()=>{
  it("only loads online orders in Orders management",()=>{
    const js=read("admin/orders.js");
    expect(js).toContain('.eq("source","online")');
    expect(js).toContain('data.filter(row=>row.source==="online")');
    expect(js).toContain("setupShipmentManagement");
  });
  it("opens the selected customer and loads only their related bills",()=>{
    const html=read("admin/customers.html"),js=read("admin/customers.js");
    expect(html).toContain('id="customerDetails"');
    expect(js).toContain('data-customer-id');
    expect(js).toContain('.eq("customer_id",customer.id)');
    expect(js).toContain("invoices!invoices_order_id_fkey");
    expect(js).toContain("../invoice.html?token=");
    expect(js).toContain("customerRecords.find(row=>String(row.id)===String(id))");
  });
  it("removes admin personal attendance but keeps employee attendance and staff oversight",()=>{
    const app=read("admin/app.js");
    expect(app).toContain('roles:["cashier","inventory_staff"]');
    expect(app).toContain('{label:"Attendance",href:"attendance.html",roles:["admin"]}');
    expect(read("admin/my-attendance.js")).toContain('if(profile.role==="admin"){location.replace("index.html");return;}');
    expect(attendanceSql).toContain("sp.role in ('cashier','inventory_staff')");
    expect(attendanceSql).not.toContain("sp.role in ('admin','cashier','inventory_staff')");
  });
});
describe("real product-image-only promotional carousel",()=>{
  it("stores up to eight unique choices, with an admin-only atomic update",()=>{
    expect(promoSql).toContain("display_order integer not null unique");
    expect(promoSql).toContain("v_count>8");
    expect(promoSql).toContain("count(distinct id)");
    expect(promoSql).toContain("sp.role='admin'".replace("sp.","s."));
    expect(promoSql).toContain("pg_advisory_xact_lock");
    expect(promoSql).toContain("and p.active=true");
    expect(promoSql).toContain("v.stock_quantity>0");
    expect(promoSql).toContain("public.product_images");
    expect(promoSql).toContain("using (true)");
  });
  it("allows rearranging images on the admin dashboard",()=>{
    const admin=read("admin/promotion.js"),html=read("admin/index.html");
    expect(html).toContain('id="promotionItems"');
    expect(admin).toContain("selected.splice(index,1)");
    expect(admin).toContain("[selected[index],selected[next]]");
    expect(admin).toContain('rpc("set_homepage_promotions"');
    expect(admin).toContain("firstImage(p)");
  });
  it("only displays available product photos and rotates them accessibly",()=>{
    const site=read("content.js"),html=read("index.html"),css=read("content.css");
    expect(html).toContain('id="promotionCarousel"');
    expect(html).toContain('id="promotionImage"');
    expect(html).not.toContain('id="promotionPrice"');
    expect(html).not.toContain('id="promotionName"');
    expect(site).toContain('from("storefront_promotion_items")');
    expect(site).toContain("filter(p=>getStock(p)>0&&Boolean(getImage(p)))");
    expect(site).toContain("},5000)");
    expect(site).toContain("promotionPaused");
    expect(site).toContain("reducePromotionMotion");
    expect(css).toContain(".rotating-feature-frame");
  });
});
