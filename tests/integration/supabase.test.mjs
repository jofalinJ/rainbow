import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url=(process.env.SUPABASE_TEST_URL||"").replace(/\/$/,"");
const key=process.env.SUPABASE_TEST_SERVICE_ROLE_KEY||"";
const productionUrl="https://ajnicsvtymvvkgepjmmk.supabase.co";

describe("isolated Supabase integration", () => {
  it("is configured as a non-production environment", () => {
    if(!url&&!key){
      expect(true).toBe(true);
      return;
    }
    expect(url).toBeTruthy();
    expect(key).toBeTruthy();
    expect(url).not.toBe(productionUrl);
  });

  it("can read the core ecommerce schema", async () => {
    if(!url||!key){
      return;
    }
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const checks=[
      ["products","id"],
      ["product_variants","id"],
      ["orders","id"],
      ["order_items","id"],
      ["customers","id"],
      ["branches","id"],
      ["business_settings","id"]
    ];
    for(const [table,column] of checks){
      const {error}=await client.from(table).select(column).limit(1);
      expect(error,table+" should be readable").toBeNull();
    }
  });
});
