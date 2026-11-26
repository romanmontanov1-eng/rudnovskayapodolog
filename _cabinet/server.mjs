import {CATALOG,render,validateCatalog} from './gallery.mjs';
const encoder=new TextEncoder();const decoder=new TextDecoder();
const json=(data,status=200,headers={})=>new Response(encoder.encode(JSON.stringify(data)),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
class HttpError extends Error{constructor(status,message,code='REQUEST_FAILED'){super(message);this.status=status;this.code=code}}
export async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')}
const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)};
const unbase64=s=>Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0));
async function mac(secret,value){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))))}
async function same(a,b){return await digest(encoder.encode(a))===await digest(encoder.encode(b))}
async function session(req,env){const value=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)olga_session=([^;]+)/)?.[1];if(!value)return false;try{const [exp,sig,...rest]=decodeURIComponent(value).split('.');return !rest.length&&/^\d+$/.test(exp)&&Number(exp)>Date.now()&&Number(exp)<Date.now()+13*3600000&&await same(sig||'',await mac(env.ADMIN_PASSWORD,exp))}catch{return false}}
function cookie(value,age=43200){return `olga_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`}
function jpeg(bytes){
 if(bytes.length>1400000||bytes.length<100||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new HttpError(422,'Нужны подготовленные JPEG до 1,4 МБ.');
 let p=2,dimensions;
 while(p+4<bytes.length){if(bytes[p++]!==255)break;let marker=bytes[p++];if(marker===218)break;const size=(bytes[p]<<8)|bytes[p+1];if(size<2||p+size>bytes.length)throw new HttpError(422,'Повреждённое фото.');if(marker===225)throw new HttpError(422,'Фото должно быть подготовлено приложением.');if([192,193,194].includes(marker)){const h=(bytes[p+3]<<8)|bytes[p+4],w=(bytes[p+5]<<8)|bytes[p+6];dimensions={w,h}}p+=size;
 }if(!dimensions||Math.min(dimensions.w,dimensions.h)<1||Math.max(dimensions.w,dimensions.h)>1600)throw new HttpError(422,'Размер подготовленного фото должен быть до 1600 пикселей.');
}
export function githubFailure(error){
 const name=['TypeError','Error','AbortError','TimeoutError','NetworkError'].includes(error?.name)?error.name:'Error';
 const message=typeof error?.message==='string'?error.message:'';
 const candidate=error?.cause?.code||error?.code;
 const code=['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_INVALID_THIS','ERR_INVALID_CHAR'].includes(candidate)?candidate:undefined;
 let reason='fetch_exception';
 if(/illegal invocation|incorrect [`']?this|invalid this/i.test(message)||code==='ERR_INVALID_THIS')reason='illegal_invocation';
 else if(/header|ByteString|ISO-8859-1/i.test(message)||code==='ERR_INVALID_CHAR')reason='invalid_header';
 else if(name==='AbortError'||name==='TimeoutError'||/TIMEOUT|TIMEDOUT/.test(code||''))reason='timeout';
 else if(['ENOTFOUND','EAI_AGAIN'].includes(code))reason='dns';
 else if(['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code))reason='tls';
 else if(['ECONNRESET','ECONNREFUSED'].includes(code))reason='connection';
 return {reason,exceptionName:name,...(code?{exceptionCode:code}:{})};
}
function githubEndpoint(path){if(path.startsWith('/git/ref'))return 'ref';if(path.startsWith('/git/commits'))return 'commit';if(path.startsWith('/git/trees'))return 'tree';if(path.startsWith('/git/blobs'))return 'blob';if(path.startsWith('/contents/'))return 'contents';return 'other'}
export class GitRepository{
 // The native Workers fetch is receiver-sensitive. Never call it as this.fetcher.
 constructor(env,fetcher=(...args)=>globalThis.fetch(...args),{requestId,logger=entry=>console.info(JSON.stringify(entry))}={}){
 this.env=env;this.fetcher=fetcher;this.requestId=requestId;this.logger=logger;
 const repo=env.GITHUB_REPOSITORY||'romanmontanov1-eng/rudnovskayapodolog';
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new HttpError(503,'Некорректное имя репозитория в GITHUB_REPOSITORY.','GITHUB_CONFIG');
 this.root=`https://api.github.com/repos/${repo}`;this.branch=env.GALLERY_BRANCH||'main';
 if(typeof this.branch!=='string'||!this.branch||/[\s?#\x00-\x1f]/.test(this.branch))throw new HttpError(503,'Некорректная ветка GALLERY_BRANCH.','GITHUB_CONFIG');
 }
 async api(path,method='GET',body){
 const started=Date.now();const context={event:'github_request',requestId:this.requestId,method,endpoint:githubEndpoint(path),host:'api.github.com'};
 const report=detail=>{try{this.logger({...context,durationMs:Date.now()-started,...detail})}catch{}};
 const raw=this.env.GITHUB_TOKEN;const token=typeof raw==='string'?raw.trim():'';
 if(!token||!/^[\x21-\x7e]+$/.test(token)||/["'`]/.test(token)){
 report({githubStatus:null,reason:'invalid_token_header'});throw new HttpError(503,'GITHUB_TOKEN должен содержать только токен GitHub без кавычек, пробелов и переводов строк. Проверьте секрет в Cloudflare.','GITHUB_TOKEN_FORMAT');
 }
 let r;try{r=await this.fetcher(this.root+path,{method,redirect:'manual',headers:{Authorization:`Bearer ${token}`,'User-Agent':'olga-works','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})}catch(error){report({githubStatus:null,...githubFailure(error)});throw new HttpError(502,'Не удалось связаться с GitHub. Повторите позже.','GITHUB_NETWORK')}
 const id=r.headers.get('x-github-request-id');const remaining=r.headers.get('x-ratelimit-remaining');
 const upstream={githubStatus:r.status,...(id&&/^[A-Za-z0-9:-]{1,128}$/.test(id)?{githubRequestId:id}:{}),...(remaining&&/^\d{1,9}$/.test(remaining)?{rateLimitRemaining:Number(remaining)}:{})};
 if(!r.ok){report({...upstream,reason:'http_error'});if(r.status===401)throw new HttpError(502,'Вход выполнен, но токен GitHub недействителен. Владелец должен обновить GITHUB_TOKEN в Cloudflare.','GITHUB_AUTH');if(r.status===403||r.status===429)throw new HttpError(502,'GitHub отклонил доступ или ограничил запросы. Владелец должен проверить права токена и лимиты GitHub.','GITHUB_ACCESS');throw new HttpError([409,422].includes(r.status)?409:502,r.status===404?'Не найдены данные сайта. Проверьте репозиторий, ветку и доступ токена.':'Не удалось сохранить в GitHub. Обновите список и повторите.','GITHUB_HTTP')}
 try{const data=await r.json();report({...upstream,reason:'ok'});return data}catch(error){report({...upstream,reason:'invalid_response',...{exceptionName:githubFailure(error).exceptionName}});throw new HttpError(502,'GitHub вернул некорректный ответ. Повторите позже.','GITHUB_RESPONSE')}
 }

 async text(path,ref){const d=await this.api(`/contents/${path}?ref=${encodeURIComponent(ref)}`);return decoder.decode(unbase64(d.content))}
 async read(){const ref=await this.api(`/git/ref/heads/${encodeURIComponent(this.branch)}`);const head=ref.object.sha;const commit=await this.api(`/git/commits/${head}`);const [catalog,index,works]=await Promise.all([this.text(CATALOG,head),this.text('index.html',head),this.text('works.html',head)]);return {head,tree:commit.tree.sha,catalog:validateCatalog(JSON.parse(catalog)),index,works}}
 async commit(state,files){const entries=await Promise.all(files.map(async f=>{const b=await this.api('/git/blobs','POST',{content:f.bytes?base64(f.bytes):f.text,encoding:f.bytes?'base64':'utf-8'});return {path:f.path,mode:'100644',type:'blob',sha:b.sha}}));const tree=await this.api('/git/trees','POST',{base_tree:state.tree,tree:entries});const commit=await this.api('/git/commits','POST',{message:'Обновить работу через кабинет Ольги',tree:tree.sha,parents:[state.head]});await this.api(`/git/refs/heads/${encodeURIComponent(this.branch)}`,'PATCH',{sha:commit.sha,force:false});return commit.sha}
}
export async function saveWork(repo,input){
 const {id,operation,revision,title,visible}=input;
 if(!/^(case-[1-6]|[a-f0-9-]{36})$/.test(id||'')||! /^[a-f0-9-]{36}$/.test(operation||'')||!Number.isInteger(revision)||revision<0||typeof title!=='string'||!title.trim()||title.trim().length>100||typeof visible!=='boolean')throw new HttpError(422,'Проверьте название и оба фото.');
 const uploads={};for(const side of ['before','after']){const value=input[side];if(value){const bytes=value instanceof Uint8Array?value:new Uint8Array(await value.arrayBuffer());jpeg(bytes);uploads[side]={bytes,path:`assets/images/pairs/${id}/${await digest(bytes)}.jpg`}}}
 const refs={before:input.beforeRef||null,after:input.afterRef||null};
 const fingerprint=await digest(encoder.encode(JSON.stringify({id,revision,title:title.trim(),visible,before:uploads.before?.path||refs.before,after:uploads.after?.path||refs.after})));
 for(let attempt=0;attempt<3;attempt++){
 const state=await repo.read();const old=state.catalog.works.find(w=>w.id===id);const op=old?.operations?.find(o=>o.id===operation);
 if(op){if(op.hash!==fingerprint)throw new HttpError(409,'Этот запрос уже использован. Обновите список.');return {work:old,replayed:true}}
 if((old?.revision||0)!==revision)throw new HttpError(409,'Работа уже изменена. Ваши поля сохранены. Вернитесь к списку и откройте актуальную версию.');
 for(const value of Object.values(refs))if(value&&![old?.before,old?.after].includes(value))throw new HttpError(422,'Некорректная ссылка на фото.');
 const work={id,title:title.trim(),before:uploads.before?.path||refs.before||old?.before,after:uploads.after?.path||refs.after||old?.after,visible,revision:revision+1,createdAt:old?.createdAt||new Date().toISOString(),operations:[...(old?.operations||[]),{id:operation,hash:fingerprint}]};
 if(!work.before||!work.after)throw new HttpError(422,'Выберите оба фото.');
 state.catalog.works=state.catalog.works.filter(w=>w.id!==id);state.catalog.works.push(work);
 const files=[{path:CATALOG,text:JSON.stringify(state.catalog,null,2)+'\n'},{path:'index.html',text:render(state.index,state.catalog.works,2)},{path:'works.html',text:render(state.works,state.catalog.works)}];
 for(const item of Object.values(uploads))if(!files.some(f=>f.path===item.path))files.push(item);
 try{return {work,commit:await repo.commit(state,files)}}catch(e){if(e.status!==409||attempt===2)throw e}
 }
}
export function createServer(assets,{repository=(env,context)=>new GitRepository(env,undefined,context),fetcher=fetch}={}){return {async fetch(req,env){const requestId=crypto.randomUUID();try{
 const url=new URL(req.url),path=url.pathname;
 const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://raw.githubusercontent.com https://romanmontanov1-eng.github.io; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
 if(/^\/icon-(180|192|512)\.png$/.test(path)&&assets.icons){const size=path.match(/(180|192|512)/)[1];return new Response(unbase64(assets.icons[size]),{headers:{...security,'Content-Type':'image/png'}});}
 if(path==='/icon.svg')return new Response(assets.icon,{headers:{...security,'Content-Type':'image/svg+xml'}});
 if(path==='/manifest.webmanifest')return json(assets.manifest);

 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('Origin')!==url.origin)throw new HttpError(403,'Запрос отклонён: откройте приложение по его основному HTTPS-адресу.','ORIGIN_MISMATCH');
 if(path==='/api/login'&&req.method==='POST'){
 if(!env.ADMIN_PASSWORD)throw new HttpError(503,'Пароль кабинета не настроен. Владелец должен задать ADMIN_PASSWORD в Cloudflare.','ADMIN_NOT_CONFIGURED');
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||''))throw new HttpError(415,'Нужен запрос JSON в UTF-8.','CONTENT_TYPE');
 if(!env.LOGIN_LIMITER||typeof env.LOGIN_LIMITER.limit!=='function')throw new HttpError(503,'Защита входа не настроена. Владелец должен проверить LOGIN_LIMITER в Cloudflare.','LOGIN_LIMITER_UNAVAILABLE');
 let allowed;try{allowed=await env.LOGIN_LIMITER.limit({key:req.headers.get('CF-Connecting-IP')||'unknown'})}catch{throw new HttpError(503,'Защита входа временно недоступна. Повторите позже.','LOGIN_LIMITER_UNAVAILABLE')}
 if(!allowed||typeof allowed.success!=='boolean')throw new HttpError(503,'Защита входа временно недоступна.','LOGIN_LIMITER_UNAVAILABLE');
 if(!allowed.success)return json({error:'Слишком много попыток. Попробуйте через минуту.',code:'LOGIN_RATE_LIMITED',requestId},429,{'Retry-After':'60','X-Request-ID':requestId});
 let data;try{const raw=await req.text();if(encoder.encode(raw).length>8192)throw new HttpError(413,'Слишком большой запрос входа.','LOGIN_BODY_SIZE');data=JSON.parse(raw)}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Некорректный JSON запроса входа.','INVALID_JSON')}
 if(!data||typeof data.password!=='string')throw new HttpError(400,'Укажите пароль строкой.','INVALID_LOGIN');
 if(!await same(data.password,env.ADMIN_PASSWORD))throw new HttpError(401,'Неверный пароль.','INVALID_PASSWORD');
 const exp=String(Date.now()+12*3600000);return json({ok:true},200,{'Set-Cookie':cookie(exp+'.'+await mac(env.ADMIN_PASSWORD,exp)),'X-Request-ID':requestId})}
 if(path==='/api/logout'&&req.method==='POST')return json({ok:true},200,{'Set-Cookie':cookie('',0)});
 if(path==='/'&&req.method==='GET')return new Response(assets.html,{headers:{...security,'Content-Type':'text/html;charset=utf-8'}});
 if(['/app.js','/api-client.mjs','/app.css'].includes(path)&&req.method==='GET')return new Response(path==='/api-client.mjs'?assets.client:path==='/app.js'?assets.js:assets.css,{headers:{...security,'Content-Type':path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}});
 if(!env.ADMIN_PASSWORD)throw new HttpError(503,'Пароль кабинета не настроен.','ADMIN_NOT_CONFIGURED');
 if(!await session(req,env))throw new HttpError(401,'Войдите в кабинет.','SESSION_REQUIRED');
 if(path==='/api/session'&&req.method==='GET')return json({authenticated:true},200,{'X-Request-ID':requestId});
 if(!env.GITHUB_TOKEN)throw new HttpError(503,'Вход выполнен, но доступ к GitHub не настроен. Владелец должен задать GITHUB_TOKEN в Cloudflare.','GITHUB_NOT_CONFIGURED');
 if(path==='/api/works'&&req.method==='GET'){const s=await repository(env,{requestId}).read();return json({works:s.catalog.works.map(({operations,...w})=>w),imageBase:`https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY||'romanmontanov1-eng/rudnovskayapodolog'}/${s.head}/`},200,{'X-Request-ID':requestId})}
 if(path==='/api/works'&&req.method==='POST'){
 if(Number(req.headers.get('Content-Length'))>3000000)return json({error:'Слишком большой запрос.'},413);
 const reader=req.body?.getReader();if(!reader)throw new HttpError(400,'Пустой запрос.');let length=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>3000000){await reader.cancel();throw new HttpError(413,'Слишком большой запрос.')}chunks.push(value)}const form=await new Response(new Blob(chunks),{headers:{'Content-Type':req.headers.get('Content-Type')||''}}).formData();const input={id:form.get('id'),operation:form.get('operation'),revision:Number(form.get('revision')),title:form.get('title'),visible:form.get('visible')==='true',before:form.get('before'),after:form.get('after'),beforeRef:form.get('beforeRef'),afterRef:form.get('afterRef')};
 const result=await saveWork(repository(env,{requestId}),input);const {operations,...work}=result.work;return json({...result,work,message:'Сохранено в репозитории. Ожидается обновление сайта.'})}
 if(path==='/api/site-status'&&req.method==='GET'){
 if((env.GALLERY_BRANCH||'main')!=='main')return json({state:'staging',message:'Сохранено в тестовой ветке. Действующий сайт не изменён.'});
 const s=await repository(env,{requestId}).read();const r=await fetcher('https://romanmontanov1-eng.github.io/rudnovskayapodolog/works.html?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error();const html=await r.text();const matches=s.catalog.works.every(w=>w.visible?html.includes(`data-work-id="${w.id}" data-revision="${w.revision}"`):!html.includes(`data-work-id="${w.id}"`));return json({state:matches?'live':'pending',message:matches?'Изменения уже появились на сайте.':'Сохранено. Сайт ещё обновляется.'})}
 return json({error:'Не найдено.'},404);
 }catch(e){const status=e instanceof HttpError?e.status:502,code=e instanceof HttpError?e.code:'INTERNAL_ERROR';console.error(JSON.stringify({requestId,path:new URL(req.url).pathname,status,code}));return json({error:e instanceof HttpError?e.message:'Не удалось выполнить запрос. Поля сохранены — попробуйте ещё раз.',code,requestId},status,{'X-Request-ID':requestId})}}}}
