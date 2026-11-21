import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Builder,By,until} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

// Real Chromium exercises the REAL HTML and admin/app.js role-routing code.
// Auth and REST are local, deterministic fixtures. No external credentials,
// production endpoints, customer data, or provider calls are used.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../..");
const allow=new Set(["/admin/login.html","/admin/index.html","/admin/audit.html",
  "/admin/billing.html","/admin/app.js","/admin/audit.js",
  "/admin/style.css","/admin/premium.css","/design-system.css",
  "/assets/brand/rainbow-logo.png"]);
function bootFixture(){
  const window=globalThis;
  const location=window.location;
  const uid={
    admin:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    cashier:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    inventory:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    disabled:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    archived:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
  };
  const staff={
    [uid.admin]:{role:"admin",full_name:"Fixture Owner",username:"admin",active:true,archived_at:null},
    [uid.cashier]:{role:"cashier",full_name:"Fixture Cashier",username:"cashier",active:true,archived_at:null},
    [uid.inventory]:{role:"inventory_staff",full_name:"Fixture Inventory",username:"inventory",active:true,archived_at:null},
    [uid.disabled]:{role:"admin",full_name:"Fixture Disabled",username:"disabled",active:false,archived_at:null},
    [uid.archived]:{role:"admin",full_name:"Fixture Archived",username:"archived",active:false,archived_at:"2026-11-20T10:00:00Z"}
  };
  const url=location.origin+"/__fixture/api";
  window.RAINBOW_SUPABASE_CONFIG=Object.freeze({
    supabaseUrl:url,supabasePublishableKey:"fixture_public_key_only"
  });
  window.RAINBOW_MULTI_SHOP_ENABLED=true;
  function session(){
    const id=localStorage.getItem("__fixture_staff");
    return staff[id]?{user:{id},access_token:"fixture:"+id,refresh_token:"fixture-refresh"}:null;
  }
  function query(name){
    const filters=[];
    const request={
      select(){return request;},
      eq(field,value){filters.push([field,value]);return request;},
      order(){return request;},
      limit(){return request;},
      range(){return request;},
      maybeSingle:async()=>{
        if(name==="staff_profiles"){
          const id=filters.find(([field])=>field==="user_id")?.[1];
          return {data:staff[id]||null,error:null};
        }
        return {data:null,error:null};
      },
      then(resolve,reject){
        const data=name==="admin_audit_events"?[]:[];
        return Promise.resolve({data,error:null}).then(resolve,reject);
      }
    };
    return request;
  }
  window.supabase={createClient:()=>({
    auth:{
      signInWithPassword:async({email,password})=>{
        const user=String(email||"").split("@")[0];
        const id=uid[user];
        if(!id||password!=="FixturePass123!")
          return {data:{user:null,session:null},error:{message:"Invalid fixture credentials"}};
        return {data:{user:{id},session:{
          user:{id},access_token:"fixture:"+id,refresh_token:"fixture-refresh"}},error:null};
      },
      setSession:async({access_token})=>{
        const id=String(access_token||"").replace(/^fixture:/,"");
        if(!staff[id])return {data:{session:null},error:{message:"Unknown fixture account"}};
        localStorage.setItem("__fixture_staff",id);
        return {data:{session:session()},error:null};
      },
      getUser:async()=>({
        data:{user:session()?.user||null},
        error:session()?null:{name:"AuthSessionMissingError",status:401,message:"No fixture session"}
      }),
      getSession:async()=>({data:{session:session()},error:null}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
      signOut:async()=>{localStorage.removeItem("__fixture_staff");return {error:null};}
    },
    from:query,
    channel:()=>({on(){return this;},subscribe(){return this;}}),
    removeChannel(){},
    rpc:async()=>({data:null,error:null})
  })};
}
async function serve(){
  const server=createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,"http://127.0.0.1").pathname;
      res.setHeader("Cache-Control","no-store");
      res.setHeader("Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
        "connect-src 'self'; img-src 'self' data:; font-src 'self'");
      if(pathname==="/__fixture/bootstrap.js"){
        res.setHeader("Content-Type","text/javascript; charset=utf-8");
        res.end("("+bootFixture.toString()+")();");return;
      }
      if(pathname==="/admin/pwa.js"){
        res.setHeader("Content-Type","text/javascript; charset=utf-8");
        res.end("/* no service worker in isolated test */");return;
      }
      if(pathname.startsWith("/__fixture/api/")){
        res.setHeader("Content-Type","application/json");
        res.end("[]");return;
      }
      if(!allow.has(pathname)){res.statusCode=404;res.end("Fixture-only server: denied");return;}
      const full=path.join(root,pathname);
      let content=await readFile(full);
      if(pathname.endsWith(".html")){
        let html=content.toString("utf8");
        html=html.replace(/<script\s+src="config\.js"><\/script>/g,
          '<script src="/__fixture/bootstrap.js"></script>');
        html=html.replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/g,"");
        html=html.replace(/<script[^>]+src="pwa\.js"[^>]*><\/script>/g,"");
        // Only real shared authentication and audit UI scripts are exercised.
        html=html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,(tag,script)=>{
          return /(^|\/)(app\.js|audit\.js)(\?|$)/.test(script) ||
            script==="/__fixture/bootstrap.js"?tag:"";
        });
        content=Buffer.from(html,"utf8");
      }
      res.setHeader("Content-Type",pathname.endsWith(".html")?
        "text/html; charset=utf-8":pathname.endsWith(".css")?
        "text/css; charset=utf-8":pathname.endsWith(".png")?
        "image/png":"text/javascript; charset=utf-8");
      res.end(content);
    }catch{res.statusCode=500;res.end("Fixture server error");}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return {base:"http://127.0.0.1:"+server.address().port,
    close:()=>new Promise(resolve=>server.close(resolve))};
}
async function browser(fn){
  const site=await serve();
  const opts=new chrome.Options().addArguments("--headless=new","--no-sandbox",
    "--disable-dev-shm-usage","--disable-background-networking",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1","--window-size=1100,880");
  let driver;
  try{
    driver=await new Builder().forBrowser("chrome").setChromeOptions(opts).build();
    await fn(driver,site.base);
  }finally{
    if(driver)await driver.quit();
    await site.close();
  }
}
async function signIn(driver,base,username){
  await driver.get(base+"/admin/login.html");
  await driver.findElement(By.id("username")).sendKeys(username);
  await driver.findElement(By.id("password")).sendKeys("FixturePass123!");
  await driver.findElement(By.css("#login button")).click();
}
test("anonymous user is redirected from owner audit to login",async()=>{
  await browser(async(driver,base)=>{
    await driver.get(base+"/admin/audit.html");
    await driver.wait(until.urlContains("/admin/login.html"),10000);
    assert.match(await driver.getCurrentUrl(),/admin\/login\.html/);
  });
});
test("fixture admin signs in through real login UI and views owner-only audit",async()=>{
  await browser(async(driver,base)=>{
    await signIn(driver,base,"admin");
    await driver.wait(until.urlContains("/admin/index.html"),10000);
    await driver.get(base+"/admin/audit.html");
    await driver.wait(async()=>{
      const text=await driver.findElement(By.id("auditStatus")).getText();
      return text.includes("Read-only history");
    },12000);
    assert.equal(await driver.findElement(By.css("aside nav a[href='audit.html']")).getText(),"Audit History");
    assert.equal(await driver.findElement(By.id("auditRows")).getText(),"No matching audit events yet.");
  });
});
for(const role of ["cashier","inventory"]){
  test("fixture "+role+" login cannot reach owner-only audit",async()=>{
    await browser(async(driver,base)=>{
      await signIn(driver,base,role);
      await driver.wait(until.urlContains("/admin/billing.html"),10000);
      await driver.get(base+"/admin/audit.html");
      await driver.wait(until.urlContains("/admin/billing.html"),10000);
      const nav=await driver.findElements(By.css("aside nav a[href='audit.html']"));
      assert.equal(nav.length,0);
    });
  });
}
for(const role of ["disabled","archived"]){
  test(role+" fixture account cannot sign in even with valid password",async()=>{
    await browser(async(driver,base)=>{
      await signIn(driver,base,role);
      await driver.wait(async()=>{
        const message=await driver.findElement(By.id("msg")).getText();
        return message.includes("Invalid username or password.");
      },10000);
      assert.match(await driver.getCurrentUrl(),/\/admin\/login\.html/);
    });
  });
}
test("unknown fixture credentials never establish a browser session",async()=>{
  await browser(async(driver,base)=>{
    await signIn(driver,base,"unknown");
    await driver.wait(async()=>(
      await driver.findElement(By.id("msg")).getText()
    ).includes("Invalid username or password."),10000);
    await driver.get(base+"/admin/audit.html");
    await driver.wait(until.urlContains("/admin/login.html"),10000);
  });
});
