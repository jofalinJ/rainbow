// This adapter never accepts browser-provided scores or returns model vectors.
export function selfHostedUrl(env) {
  try {
    const url = new URL(env.SELF_HOSTED_FACE_URL || '');
    const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:' && env.SELF_HOSTED_ALLOW_LOCAL_HTTP === 'true'))) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch { return null; }
}
export function selfHostedProvider(env, {fetchImpl=fetch}={}) {
  const base = selfHostedUrl(env);
  const key = env.SELF_HOSTED_FACE_API_KEY || '';
  const pending = new Map();
  const validId = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
  const pathId = value => {
    if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw new Error('Invalid provider reference');
    return encodeURIComponent(value);
  };
  async function request(path, method='GET', body) {
    if (!base || key.length < 32) throw new Error('Self-hosted face service is not configured');
    const response = await fetchImpl(base+path,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Self-hosted face service rejected the request');
    const result = await response.json();
    return result;
  }
  return {
    kind:'self_hosted',
    async createCollection(id) { await request('/v1/collections','POST',{collection_id:id}); },
    async deleteCollection(id) { await request('/v1/collections/'+pathId(id),'DELETE'); },
    async createSession({collection,purpose}) {
      const result = await request('/v1/sessions','POST',{collection_id:collection,mode:purpose});
      if (!validId(result.session_id) || typeof result.upload_token !== 'string' || result.upload_token.length < 32
        || !Number.isFinite(Date.parse(result.expires_at)) || Date.parse(result.expires_at) <= Date.now()
        || result.challenge?.type !== 'passive_multiframe' || result.challenge?.frame_count !== 6) throw new Error('Invalid capture session');
      pending.set(result.session_id,result);
      return result.session_id;
    },
    async browserCredentials(id) {
      const result = pending.get(id);
      pending.delete(id);
      if (!result) throw new Error('Capture session unavailable');
      return {uploadUrl:base+'/v1/sessions/'+pathId(id)+'/capture',uploadToken:result.upload_token,
        expiration:result.expires_at,capture:{frameCount:6,intervalMs:600}};
    },
    async results(id) {
      if (!validId(id)) throw new Error('Invalid capture session');
      const result = await request('/v1/sessions/'+pathId(id)+'/result');
      if (result.provider !== 'self_hosted' || result.template_token !== id) throw new Error('Mismatched capture evidence');
      return result;
    },
    async match(collection,sample) {
      if (!validId(sample)) throw new Error('Invalid sample reference');
      return request('/v1/collections/'+pathId(collection)+'/verify','POST',{session_id:sample});
    },
    async index(collection,sample) {
      if (!validId(sample)) throw new Error('Invalid sample reference');
      const result = await request('/v1/collections/'+pathId(collection)+'/samples','POST',{session_id:sample});
      if (result.indexed !== true) throw new Error('Sample indexing failed');
    },
  };
}
