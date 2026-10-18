import {describe,it,expect,vi} from 'vitest';
import {readRequestBody} from '../../supabase/functions/face-attendance/service.mjs';
const request = (body,headers={}) => new Request('https://example.test/functions/v1/face-attendance',{method:'POST',body,headers,duplex:'half'});
describe('bounded attendance request input',()=>{
  it('reads a small JSON request without changing its bytes',async()=>{
    const body='{"operation":"status","name":"தமிழ்"}';
    expect(await readRequestBody(request(body))).toBe(body);
  });
  it('rejects an oversized declared content length without reading a stream',async()=>{
    const source={getReader:vi.fn()};
    await expect(readRequestBody({headers:new Headers({'Content-Length':'8193'}),body:source})).rejects.toMatchObject({status:413});
    expect(source.getReader).not.toHaveBeenCalled();
  });
  it('bounds chunked bodies even without Content-Length and cancels the stream',async()=>{
    let reads=0;
    const cancel=vi.fn(),releaseLock=vi.fn();
    const reader={read:vi.fn(async()=>({done:false,value:new Uint8Array(++reads===1?8000:193)})),cancel,releaseLock};
    await expect(readRequestBody({headers:new Headers(),body:{getReader:()=>reader}})).rejects.toMatchObject({status:413});
    expect(reads).toBe(2);expect(cancel).toHaveBeenCalledOnce();expect(releaseLock).toHaveBeenCalledOnce();
  });
  it('does not trust a false short Content-Length or multibyte character count',async()=>{
    await expect(readRequestBody(request('₹'.repeat(3000),{'Content-Length':'1'}))).rejects.toMatchObject({status:413});
  });
  it('accepts exactly the byte limit and handles an empty body',async()=>{
    expect((await readRequestBody(request('x'.repeat(8192)))).length).toBe(8192);
    expect(await readRequestBody({headers:new Headers(),body:null})).toBe('');
  });
});
