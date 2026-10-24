import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const source=readFileSync(new URL("../../invoice.js",import.meta.url),"utf8");
async function invoice(search,data){
  const elements={invoice:{innerHTML:""},printBtn:{disabled:true},waBtn:{style:{display:"none"}}};
  const rpc=vi.fn().mockResolvedValue({data,error:null});
  const render=vi.fn();
  const window={RAINBOW_SUPABASE_CONFIG:{supabaseUrl:"https://example.supabase.co",supabasePublishableKey:"public"},supabase:{createClient:()=>({rpc})},RainbowInvoice:{render,money:String}};
  runInNewContext(source,{document:{getElementById:id=>elements[id]},location:{search},URLSearchParams,window,RainbowInvoice:window.RainbowInvoice,console,setTimeout});
  await new Promise(resolve=>setTimeout(resolve,0));
  return {elements,rpc,render};
}
describe("secure public invoice access",()=>{
  it("rejects missing or malformed tokens before making a database request",async()=>{
    for(const query of ["","?token=1","?token="+"-".repeat(36)]){
      const result=await invoice(query,{});
      expect(result.rpc).not.toHaveBeenCalled();
      expect(result.elements.printBtn.disabled).toBe(true);
      expect(result.elements.invoice.innerHTML).toContain("invalid secure bill link");
    }
  });
  it("requests only the token-scoped public invoice and enables print after successful loading",async()=>{
    const token="58cad012-6529-41be-b14e-4ad0878c19db";
    const data={invoice_number:"RG-TEST-1",total_amount:100};
    const result=await invoice("?token="+token,data);
    expect(result.rpc).toHaveBeenCalledWith("get_public_invoice",{p_token:token});
    expect(result.render).toHaveBeenCalledWith(data,result.elements.invoice);
    expect(result.elements.printBtn.disabled).toBe(false);
    expect(result.elements.waBtn.style.display).toBe("none");
  });
  it("keeps printing disabled when the token has no accessible invoice",async()=>{
    const result=await invoice("?token=58cad012-6529-41be-b14e-4ad0878c19db",null);
    expect(result.elements.printBtn.disabled).toBe(true);
    expect(result.elements.invoice.innerHTML).toContain("Bill not found");
    expect(result.render).not.toHaveBeenCalled();
  });
  it("prevents the invoice capability URL being sent as a referrer to third-party dependencies",()=>{
    const page=readFileSync(new URL("../../invoice.html",import.meta.url),"utf8");
    expect(page).toContain('<meta name="referrer" content="no-referrer">');
  });
});
