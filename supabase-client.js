/* One browser client per page, shared by storefront modules and live settings. */
(() => {
  let client=null;
  window.RainbowSupabase={
    getClient(){
      if(client)return client;
      const cfg=window.RAINBOW_SUPABASE_CONFIG||{};
      if(!window.supabase?.createClient||!cfg.supabaseUrl||!cfg.supabasePublishableKey)return null;
      client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
      return client;
    }
  };
})();
