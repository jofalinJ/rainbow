const productionSupabaseRef="ajnicsvtymvvkgepjmmk";
const productionStoreHosts=new Set([
  "rainbowgoldcovering.com","www.rainbowgoldcovering.com","jofalinj.github.io","rainbow-api.jofalin2005.workers.dev"
]);

export function isolatedOrigin(value,label){
  const url=new URL(value);
  const hostname=url.hostname.toLowerCase().replace(/\.$/,"");
  const loopback=["127.0.0.1","localhost","[::1]"].includes(hostname);
  if(url.protocol!=="https:"&&!(url.protocol==="http:"&&loopback))
    throw new Error(`${label} must be HTTPS or HTTP on loopback.`);
  if(url.username||url.password||url.search||url.hash||url.pathname!=="/"||
    hostname.split(".").includes(productionSupabaseRef)||productionStoreHosts.has(hostname))
    throw new Error(`${label} must be an isolated origin.`);
  return url.origin;
}

export function isolatedRuntimeConfig(env){
  if(!env.SUPABASE_TEST_PUBLISHABLE_KEY&&env.E2E_ENABLED!=="true")return null;
  if(!env.SUPABASE_TEST_URL||!env.SUPABASE_TEST_PUBLISHABLE_KEY)
    throw new Error("Isolated browser tests require SUPABASE_TEST_URL and SUPABASE_TEST_PUBLISHABLE_KEY.");
  const supabaseUrl=isolatedOrigin(env.SUPABASE_TEST_URL,"SUPABASE_TEST_URL");
  const apiBaseUrl=env.PAYMENT_TEST_API_URL?isolatedOrigin(env.PAYMENT_TEST_API_URL,"PAYMENT_TEST_API_URL"):"";
  const supabase={supabaseUrl,supabasePublishableKey:env.SUPABASE_TEST_PUBLISHABLE_KEY};
  const websocketUrl=supabaseUrl.replace(/^http/,"ws");
  return {
    supabaseScript:`window.RAINBOW_SUPABASE_CONFIG=Object.freeze(${JSON.stringify(supabase)});\nwindow.RAINBOW_MULTI_SHOP_ENABLED=true;`,
    paymentScript:`window.RAINBOW_PAYMENT_CONFIG=Object.freeze(${JSON.stringify({apiBaseUrl})});`,
    connectPolicy:["connect-src 'self'",supabaseUrl,websocketUrl,apiBaseUrl].filter(Boolean).join(" ")
  };
}
