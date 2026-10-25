import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=name=>readFileSync(new URL("../../"+name,import.meta.url),"utf8");

describe("shared storefront client",()=>{
  it("reuses one auth client across storefront access, polling and realtime refreshes",async()=>{
    const intervals=[],events={};
    const channel={on:vi.fn().mockReturnThis(),subscribe:vi.fn().mockReturnThis()};
    const client={
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null}),order:async()=>({data:[]})})})}),
      channel:vi.fn(()=>channel),removeChannel:vi.fn()
    };
    const createClient=vi.fn(()=>client),clearInterval=vi.fn();
    const window={supabase:{createClient},RAINBOW_SUPABASE_CONFIG:{supabaseUrl:"https://example.supabase.co",supabasePublishableKey:"test-public-key"},
      setInterval:fn=>{intervals.push(fn);return 42;},clearInterval,addEventListener:(name,fn)=>{events[name]=fn;}};
    const context={window,document:{readyState:"complete",querySelector:()=>null,getElementById:()=>null},console};
    runInNewContext(source("supabase-client.js"),context);
    expect(window.RainbowSupabase.getClient()).toBe(client);
    runInNewContext(source("business-live.js"),context);
    await Promise.resolve();
    for(let i=0;i<4;i++)await intervals[0]();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.channel).toHaveBeenCalledTimes(1);
    events.pagehide();
    expect(clearInterval).toHaveBeenCalledWith(42);
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
    events.pageshow({persisted:true});
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.channel).toHaveBeenCalledTimes(2);
    expect(intervals).toHaveLength(2);
    events.pageshow({persisted:true});
    expect(intervals).toHaveLength(2);
  });

  it("can initialize after configuration arrives without creating extra clients",()=>{
    const createClient=vi.fn(()=>({})),window={};
    runInNewContext(source("supabase-client.js"),{window});
    expect(window.RainbowSupabase.getClient()).toBeNull();
    window.supabase={createClient};
    window.RAINBOW_SUPABASE_CONFIG={supabaseUrl:"https://example.supabase.co",supabasePublishableKey:"test"};
    expect(window.RainbowSupabase.getClient()).toBe(window.RainbowSupabase.getClient());
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

describe("root recovery callback forwarding",()=>{
  function redirect(href){
    const current=new URL(href),replace=vi.fn();
    runInNewContext(source("recovery-redirect.js"),{URL,URLSearchParams,window:{location:{href,hash:current.hash,replace}}});
    return replace;
  }
  it("forwards recovery fragments to a fixed same-origin path without a redirect parameter",()=>{
    const fn=redirect("https://rainbowgoldcovering.com/?next=https://other.example/#type=recovery&access_token=test-only");
    expect(fn).toHaveBeenCalledWith("https://rainbowgoldcovering.com/reset-password.html#type=recovery&access_token=test-only");
  });
  it("forwards an expired recovery error for a useful recovery page",()=>{
    expect(redirect("https://rainbowgoldcovering.com/#error=access_denied&error_code=otp_expired")).toHaveBeenCalledOnce();
  });
  it("leaves shopping section and ordinary sign-in navigation alone",()=>{
    expect(redirect("https://rainbowgoldcovering.com/#process")).not.toHaveBeenCalled();
    expect(redirect("https://rainbowgoldcovering.com/#type=signup&access_token=test-only")).not.toHaveBeenCalled();
  });
});
