import {describe,it,expect} from "vitest";
import {normalizeDraftLines,createDraftRecord,saveDraft,listDrafts,getDraft,deleteDraft}
 from "../../src/domain/offlineDrafts.mjs";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL("../../"+x,import.meta.url),"utf8");
const v1="00000000-0000-4000-8000-000000000001";
const v2="00000000-0000-4000-8000-000000000002";

function fakeIDB(){
 const table=new Map();
 const database={
  objectStoreNames:{contains:()=>false},
  createObjectStore:()=>{},
  close:()=>{},
  transaction(){
   let done,aborted;
   const tx={
    set oncomplete(fn){done=fn;},
    set onabort(fn){aborted=fn;},
    set onerror(_fn){},
    objectStore:()=>({
     add(v){return request(()=>{if(table.has(v.id))throw Error("Duplicate ID");table.set(v.id,structuredClone(v));return v.id;});},
     get(id){return request(()=>structuredClone(table.get(id)));},
     getAll(){return request(()=>[...table.values()].map(row=>structuredClone(row)));},
     delete(id){return request(()=>table.delete(id));}
    })
   };
   function request(callback){
    const r={result:undefined,error:null,onsuccess:null,onerror:null};
    queueMicrotask(()=>{
     try{r.result=callback();r.onsuccess?.();queueMicrotask(()=>done?.());}
     catch(e){r.error=e;r.onerror?.();queueMicrotask(()=>aborted?.());}
    });return r;
   }
   return tx;
  }
 };
 return {open(){
  const req={result:database,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
  queueMicrotask(()=>{req.onupgradeneeded?.();req.onsuccess?.();});return req;
 }};
}
describe("client-only PII-free offline cart drafts",()=>{
 it("enforces quantities and duplicate variant rejection",()=>{
  expect(()=>normalizeDraftLines([])).toThrow();
  expect(()=>normalizeDraftLines([{variantId:v1,quantity:1},{variantId:v1,quantity:1}])).toThrow();
  expect(()=>normalizeDraftLines([{variantId:v1,quantity:0}])).toThrow();
  expect(()=>normalizeDraftLines([{variantId:"invalid",quantity:1}])).toThrow();
 });
 it("records no customer, card, payment or invoice data",()=>{
  const d=createDraftRecord([{variantId:v1,quantity:2}],{id:"10000000-0000-4000-8000-000000000001",createdAt:123});
  expect(Object.keys(d).sort()).toEqual(["createdAt","id","kind","lines","status"]);
  expect(Object.keys(d.lines[0])).toEqual(["variantId","quantity"]);
  expect(d.status).toBe("draft");expect(d.kind).toBe("UNSUBMITTED_CART_DRAFT");
 });
 it("persists and removes unfinished drafts through IndexedDB transaction contract",async()=>{
  const db=fakeIDB();
  const d=createDraftRecord([{variantId:v1,quantity:2},{variantId:v2,quantity:1}],{
    id:"10000000-0000-4000-8000-000000000002",createdAt:123
  });
  expect((await saveDraft(d,db)).id).toBe(d.id);
  expect((await getDraft(d.id,db)).lines).toHaveLength(2);
  expect(await listDrafts(db)).toHaveLength(1);
  await expect(saveDraft(d,db)).rejects.toThrow("Duplicate");
  await deleteDraft(d.id,db);
  expect(await listDrafts(db)).toHaveLength(0);
 });
 it("requires online catalog revalidation before restoring to POS",()=>{
  const ui=read("admin/offline-drafts.mjs"),billing=read("admin/billing.js"),html=read("admin/billing.html");
  expect(ui).not.toContain("create_local_sale_once");
  expect(ui).not.toContain(".rpc(");
  expect(ui).toContain("UNSUBMITTED");
  expect(billing).toContain("await loadCatalog()");
  expect(billing).toContain("if(!navigator.onLine)");
  expect(html).toContain("Offline drafts · NOT BILLS");
 });
});
