import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {describe,expect,it,vi} from "vitest";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const source=read("admin/app.js");

function loginFixture({profile,username="admin@example.test",next="",signInError=null,profileError=null,sessionError=null,storedSession={user:{id:"fixture-user"}}}={}){
  const button={disabled:false};
  const inputs={username:{value:username},password:{value:"fixture-password"},msg:{textContent:""}};
  const form={querySelector:()=>button,addEventListener:(_event,callback)=>{form.submit=callback;}};
  const location={search:next,href:""};
  const passwordSignIn=vi.fn(async ()=>({
    data:{user:{id:"fixture-user"},session:{access_token:"fixture-access",refresh_token:"fixture-refresh"}},
    error:signInError
  }));
  const lookupProfile=vi.fn(async ()=>({data:profile,error:profileError}));
  const filter=vi.fn(()=>({maybeSingle:lookupProfile}));
  const setSession=vi.fn(async ()=>({data:{session:storedSession},error:sessionError}));
  const createClient=vi.fn((_,__,options)=>options?{
    auth:{signInWithPassword:passwordSignIn},
    from:()=>({select:()=>({eq:filter})})
  }:{auth:{setSession}});
  const window={
    supabase:{createClient},
    addEventListener(){},
    RAINBOW_SUPABASE_CONFIG:{supabaseUrl:"https://example.test",supabasePublishableKey:"fixture-key"}
  };
  const document={querySelector:()=>form,getElementById:id=>inputs[id]};
  runInNewContext(source,{document,window,location,URLSearchParams});
  return {
    submit:()=>form.submit({preventDefault(){}}),button,location,inputs,
    createClient,passwordSignIn,lookupProfile,filter,setSession
  };
}

describe("staff sign-in",()=>{
  it.each([
    ["storefront",null],
    ["inactive",{role:"cashier",active:false}],
    ["archived",{role:"admin",active:true,archived_at:"2026-11-14"}],
    ["other role",{role:"customer",active:true}]
  ])("keeps a %s account out of the portal and preserves the browser session",async (_label,profile)=>{
    const login=loginFixture({profile});
    await login.submit();
    expect(login.inputs.msg.textContent).toBe("Invalid username or password.");
    expect(login.location.href).toBe("");
    expect(login.button.disabled).toBe(false);
    expect(login.setSession).not.toHaveBeenCalled();
    expect(login.createClient).toHaveBeenCalledTimes(1);
    expect(login.createClient.mock.calls[0][2].auth).toMatchObject({
      persistSession:false,autoRefreshToken:false,detectSessionInUrl:false
    });
    expect(login.filter).toHaveBeenCalledWith("user_id","fixture-user");
  });

  it.each([
    ["admin"," Owner@Example.test ","Owner@Example.test","?next=owner.html","owner.html"],
    ["cashier"," Staff.User ","staff.user@staff.rainbow.local","","index.html"],
    ["inventory_staff","legacy","legacy@staff.rainbow.local","?next=https://example.test","index.html"]
  ])("allows active %s accounts to keep using their existing credentials",async (role,username,email,next,destination)=>{
    const login=loginFixture({profile:{role,active:true,archived_at:null},username,next});
    await login.submit();
    expect(login.passwordSignIn).toHaveBeenCalledWith({email,password:"fixture-password"});
    expect(login.setSession).toHaveBeenCalledExactlyOnceWith({access_token:"fixture-access",refresh_token:"fixture-refresh"});
    expect(login.location.href).toBe(destination);
  });

  it("does not open the portal after failed authentication or a profile lookup error",async ()=>{
    for(const options of [{signInError:new Error("Invalid login")},{profileError:new Error("Unavailable")}]){
      const login=loginFixture(options);
      await login.submit();
      expect(login.setSession).not.toHaveBeenCalled();
      expect(login.location.href).toBe("");
      expect(login.button.disabled).toBe(false);
    }
  });

  it.each([
    {sessionError:new Error("Unavailable")},
    {storedSession:null},
    {storedSession:{user:{id:"another-user"}}}
  ])("leaves the form available if the verified session cannot be established",async options=>{
    const login=loginFixture({profile:{role:"admin",active:true},...options});
    await login.submit();
    expect(login.location.href).toBe("");
    expect(login.button.disabled).toBe(false);
    expect(login.inputs.msg.textContent).toBe("Could not sign in right now. Please try again.");
  });

  it("uses the Staff Login label without mentioning administrator sign-in",()=>{
    const html=read("admin/login.html");
    expect(html).toContain('<p id="mode">Staff Login</p>');
    expect(html).not.toMatch(/admin login|admin creates/i);
  });
});
