import {test,expect} from "vitest";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

for(const name of ["send-order-alert","send-whatsapp-bill"]){
  test(`${name} cannot send even with old runtime credentials`,async()=>{
    let handler,calls=0;
    const code=await readFile(new URL(`../../supabase/functions/${name}/index.ts`,import.meta.url),"utf8");
    vm.runInNewContext(code,{
      Deno:{serve:fn=>{handler=fn;},env:{get:()=>"configured"}},
      Headers,Response,Set,
      fetch:()=>{calls++;throw new Error("No network request is permitted");}
    });
    const response=await handler(new Request("https://functions.invalid/",{
      method:"POST",headers:{Origin:"https://rainbowgoldcovering.com",Authorization:"Bearer obsolete-token"},body:"{}"
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({enabled:false});
    expect(calls).toBe(0);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const preflight=await handler(new Request("https://functions.invalid/",{method:"OPTIONS",headers:{Origin:"https://untrusted.invalid"}}));
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });
}
