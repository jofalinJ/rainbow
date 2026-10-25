import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../../content.js",import.meta.url),"utf8");
function section(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  if(from<0||to<0)throw new Error("Catalogue lifecycle test could not find its runtime functions.");
  return source.slice(from,to);
}
const requestSource=section("  function catalogueRequest(","  const initialSection=");
const loadSource=section("  async function loadMoreProducts(","  function resetCatalogue(");
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};

function harness(){
  const snapshots=[],status={textContent:""};
  const page=vi.fn();
  const context={
    client:{},catalogue:{page,PAGE_SIZE:24},
    paging:{epoch:0,loading:false,hasMore:true,total:0,offset:0,autoPages:0,error:""},
    catalogueProducts:[],activeSearch:"ring",
    pageFilters:()=>({search:"ring"}),
    syncShopFilters:vi.fn(),renderPromotion:vi.fn(),showSearchFeedback:vi.fn(),renderPager:vi.fn(),
    document:{getElementById:id=>id==="productStatus"?status:null},
    console:{warn:vi.fn()},window:{setTimeout,clearTimeout},
  };
  context.render=()=>snapshots.push({
    loading:context.paging.loading,error:context.paging.error,
    products:context.catalogueProducts.map(product=>product.id),
    total:context.paging.total,hasMore:context.paging.hasMore,
  });
  runInNewContext(requestSource+loadSource+"\nthis.load=loadMoreProducts;this.request=catalogueRequest;",context);
  return {context,page,snapshots,status,load:context.load,request:context.request};
}

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());

describe("desktop catalogue request lifecycle",()=>{
  it("finishes an empty response with an empty, unlocked render instead of skeletons",async()=>{
    const ui=harness(),response=deferred();ui.page.mockReturnValue(response.promise);
    const task=ui.load();
    expect(ui.snapshots.at(-1)).toMatchObject({loading:true,products:[]});
    response.resolve({items:[],total:0,hasMore:false});await task;
    expect(ui.snapshots.at(-1)).toMatchObject({loading:false,products:[],total:0,hasMore:false,error:""});
    expect(ui.context.paging.loading).toBe(false);
    expect(ui.context.showSearchFeedback).toHaveBeenCalledWith("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unlocks after rejection, renders retry feedback, and permits a successful retry",async()=>{
    const ui=harness(),first=deferred(),retry=deferred();
    ui.page.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const task=ui.load();first.reject(new Error("Offline"));await task;
    expect(ui.snapshots.at(-1)).toMatchObject({loading:false,products:[]});
    expect(ui.snapshots.at(-1).error).toMatch(/connection.*retry/i);
    expect(ui.status.textContent).toMatch(/could not load/i);
    const retried=ui.load(true);
    expect(ui.page).toHaveBeenCalledTimes(2);
    expect(ui.snapshots.at(-1)).toMatchObject({loading:true,error:""});
    retry.resolve({items:[{id:"ring-1"}],total:1,hasMore:false});await retried;
    expect(ui.snapshots.at(-1)).toMatchObject({loading:false,products:["ring-1"],error:"",total:1});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps existing cards intact while another page is pending or fails",async()=>{
    const ui=harness(),response=deferred();
    ui.context.catalogueProducts=[{id:"existing-design"}];
    ui.page.mockReturnValue(response.promise);
    const task=ui.load(true);
    expect(ui.snapshots).toHaveLength(0);
    expect(ui.context.renderPager).toHaveBeenCalledWith(false);
    response.reject(new Error("Offline"));await task;
    expect(ui.snapshots).toHaveLength(0);
    expect(ui.context.catalogueProducts).toEqual([{id:"existing-design"}]);
    expect(ui.context.paging.loading).toBe(false);
    expect(ui.context.paging.error).toMatch(/retry/i);
  });

  it("does not issue a second query while a page is already pending",async()=>{
    const ui=harness(),response=deferred();ui.page.mockReturnValue(response.promise);
    const first=ui.load();await ui.load(true);
    expect(ui.page).toHaveBeenCalledOnce();
    expect(ui.snapshots).toHaveLength(1);
    expect(ui.context.paging.loading).toBe(true);
    response.resolve({items:[],total:0,hasMore:false});await first;
  });

  it.each(["resolve","reject"])("ignores a stale request's %s without clearing a newer loading state",async outcome=>{
    const ui=harness(),oldResponse=deferred(),newResponse=deferred();
    ui.page.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    const oldTask=ui.load();
    ui.context.paging.epoch++;
    ui.context.paging.loading=false;
    ui.context.catalogueProducts=[];
    const currentTask=ui.load();
    const beforeStaleSettlement=ui.snapshots.length;
    if(outcome==="resolve")oldResponse.resolve({items:[{id:"old-design"}],total:1,hasMore:false});
    else oldResponse.reject(new Error("Old query failed"));
    await oldTask;
    expect(ui.snapshots).toHaveLength(beforeStaleSettlement);
    expect(ui.context.catalogueProducts).toEqual([]);
    expect(ui.context.paging.loading).toBe(true);
    expect(ui.context.paging.error).toBe("");
    newResponse.resolve({items:[{id:"current-design"}],total:1,hasMore:false});await currentTask;
    expect(ui.snapshots.at(-1)).toMatchObject({loading:false,products:["current-design"],error:""});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("turns a stalled page into retryable feedback at the deadline",async()=>{
    const ui=harness(),response=deferred();ui.page.mockReturnValue(response.promise);
    const task=ui.load();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(ui.context.paging.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(1);await task;
    expect(ui.snapshots.at(-1)).toMatchObject({loading:false,products:[]});
    expect(ui.snapshots.at(-1).error).toMatch(/retry/i);
    expect(ui.context.paging.loading).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const completedRenders=ui.snapshots.length;
    response.resolve({items:[{id:"late-design"}],total:1,hasMore:false});
    await Promise.resolve();await Promise.resolve();
    expect(ui.snapshots).toHaveLength(completedRenders);
    expect(ui.context.catalogueProducts).toEqual([]);
  });
});

describe("catalogue request deadline cleanup",()=>{
  it("rejects a request that never settles after fifteen seconds",async()=>{
    const ui=harness(),response=deferred();
    const task=ui.request(response.promise);
    const rejected=expect(task).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(15_000);await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when the request succeeds before the deadline",async()=>{
    const ui=harness(),response=deferred();
    const task=ui.request(response.promise),value={items:[],total:0,hasMore:false};
    expect(vi.getTimerCount()).toBe(1);
    response.resolve(value);expect(await task).toBe(value);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when the request fails before the deadline",async()=>{
    const ui=harness(),response=deferred();
    const task=ui.request(response.promise),error=new Error("Request failed");
    const rejected=expect(task).rejects.toBe(error);
    response.reject(error);await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
