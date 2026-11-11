import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read = path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const owner = read("admin/owner.js");
const migration = read("supabase/migrations/20261111130000_online_markup_2_5_percent.sql");
const priceCalculation = owner.match(/const markupPrice=amount=>([^;]+);/);
if(!priceCalculation)throw new Error("Owner online price preview is missing");
const markupPrice = runInNewContext("amount=>"+priceCalculation[1],{});

describe("2.5% online-only markup rounded to the nearest rupee",()=>{
  it.each([
    [1000,1025],
    [100,103], // ₹102.50 => ₹103: exactly 50 paise rounds up
    [99.99,102], // ₹102.48975 => ₹102: below 50 paise rounds down
    [20,21], // ₹20.50 => ₹21
    [19.99,20],
    [999.99,1025],
  ])("previews shop ₹%s as online ₹%s",(shop,expected)=>{
    expect(markupPrice(shop)).toBe(expected);
    expect(Number.isInteger(markupPrice(shop))).toBe(true);
  });

  it("enforces the same rounding in publication, price edits and existing-listing backfill",()=>{
    expect(migration.match(/round\((?:v_shop_price|new\.selling_price|p\.selling_price)\*1\.025,0\)/g))
      .toHaveLength(4);
    expect(migration).not.toMatch(/round\((?:v_shop_price|new\.selling_price|p\.selling_price)\*1\.025,2\)/);
    expect(migration).toContain("l.online_price as selling_price");
    expect(migration).not.toContain("set selling_price=");
  });
});
