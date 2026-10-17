import {describe,it,expect} from "vitest";
import {calculateTaxLine,formatInvoiceSerial} from "../../src/domain/invoicePolicyDraft.mjs";
describe("invoice policy prototype — CA approval still required",()=>{
 it("does not assume a tax rate",()=>{
 expect(()=>calculateTaxLine({quantity:1,unitPaise:10000})).toThrow();
 });
 it("reconciles all line totals",()=>{
 for(const rateBps of [0,300,500,1200,1800,2800])
 for(const inclusive of [true,false])
 for(const intraState of [true,false])
 for(const unitPaise of [100,1357,9800,10001,123456]){
  const v=calculateTaxLine({quantity:2,unitPaise,discountPaise:90,rateBps,inclusive,intraState});
  expect(v.taxablePaise+v.cgstPaise+v.sgstPaise+v.igstPaise).toBe(v.totalPaise);
 }
 });
 it("accepts amount-inclusive and amount-exclusive choices",()=>{
 expect(calculateTaxLine({quantity:1,unitPaise:10000,rateBps:300,inclusive:false,intraState:true}).totalPaise).toBe(10300);
 expect(calculateTaxLine({quantity:1,unitPaise:10300,rateBps:300,inclusive:true,intraState:true}).totalPaise).toBe(10300);
 });
 it("caps counter invoice identifiers at 16 characters",()=>{
 expect(formatInvoiceSerial({counter:"A",year:2026,sequence:1}).length).toBeLessThanOrEqual(16);
 expect(()=>formatInvoiceSerial({counter:"A",year:2026,sequence:1000000})).toThrow();
 });
});
