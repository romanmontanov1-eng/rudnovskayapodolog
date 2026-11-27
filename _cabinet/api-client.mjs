export class ApiError extends Error {
 constructor(message,{path,status=0,code='NETWORK',requestId=null,unknown=false,stage=null,requestDispatched=false,responseReceived=false}={}){super(message);Object.assign(this,{path,status,code,requestId,unknown,stage,requestDispatched,responseReceived})}
}
export async function requestJSON(path,options={}, {fetcher=(...args)=>globalThis.fetch(...args),timeoutMs=30000}={}) {
 const mutation=path==='/api/works'&&options.method==='POST';
 const {onDispatch,onResponse,...requestOptions}=options;
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
 let response,text,invoked=false;
 try {
  onDispatch?.();invoked=true;
  response=await fetcher(path,{...requestOptions,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...options.headers},signal:controller.signal});
  onResponse?.(response.status);
  text=await response.text();
 } catch {
  if(!invoked)throw new ApiError('Не удалось подготовить отправку запроса.',{path,code:'REQUEST_SETUP',stage:'request-setup',requestDispatched:false,responseReceived:false,unknown:false});
  throw new ApiError(controller.signal.aborted?'Сервер не ответил вовремя. Проверьте соединение и повторите действие.':`Не удалось связаться с сервером (${path}, NETWORK). Проверьте интернет и повторите действие.`,{path,status:response?.status||0,code:controller.signal.aborted?'TIMEOUT':'NETWORK',unknown:mutation,stage:response?'response-read':'dispatch',requestDispatched:true,responseReceived:Boolean(response)});
 } finally {clearTimeout(timer)}
 const meta={path,stage:'response',requestDispatched:true,responseReceived:true,status:response.status,requestId:response.headers.get('X-Request-ID')||response.headers.get('CF-Ray'),unknown:mutation&&response.status>=500};
 const type=response.headers.get('Content-Type')||'';
 const diagnostic=meta.requestId?` Код проверки: ${meta.requestId}.`:'';
 if(!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(type))throw new ApiError(`Сервер вернул ответ другого формата (HTTP ${response.status}). Повторите позже.${diagnostic}`,{...meta,code:'NON_JSON',unknown:mutation&&(response.ok||response.status>=500)});
 let data;
 try{data=JSON.parse(text.replace(/^\uFEFF/,''));if(!data||typeof data!=='object'||Array.isArray(data))throw Error()}catch{throw new ApiError(`Не удалось прочитать JSON сервера (HTTP ${response.status}). Повторите позже.${diagnostic}`,{...meta,code:'INVALID_JSON',unknown:mutation&&(response.ok||response.status>=500)})}
 if(!response.ok)throw new ApiError(typeof data.error==='string'?data.error:`Сервер отклонил запрос (HTTP ${response.status}).`,{...meta,code:typeof data.code==='string'?data.code:'HTTP'});
 return data;
}
