import {CATALOG,render,validateCatalog} from './gallery.mjs';
const encoder=new TextEncoder();const decoder=new TextDecoder();
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
class HttpError extends Error{constructor(status,message){super(message);this.status=status}}
export async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')}
const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)};
const unbase64=s=>Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0));
async function mac(secret,value){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))))}
async function same(a,b){return await digest(encoder.encode(a))===await digest(encoder.encode(b))}
async function session(req,env){const cookie=req.headers.get('Cookie')||'';const value=cookie.match(/(?:^|; )olga_session=([^;]+)/)?.[1];if(!value)return false;const [exp,sig]=decodeURIComponent(value).split('.');return Number(exp)>Date.now()&&Number(exp)<Date.now()+13*3600000&&await same(sig||'',await mac(env.ADMIN_PASSWORD,exp))}
function cookie(value,age=43200){return `olga_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`}
function jpeg(bytes){
 if(bytes.length>1400000||bytes.length<100||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new HttpError(422,'Нужны подготовленные JPEG до 1,4 МБ.');
 let p=2,dimensions;
 while(p+4<bytes.length){if(bytes[p++]!==255)break;let marker=bytes[p++];if(marker===218)break;const size=(bytes[p]<<8)|bytes[p+1];if(size<2||p+size>bytes.length)throw new HttpError(422,'Повреждённое фото.');if(marker===225)throw new HttpError(422,'Фото должно быть подготовлено приложением.');if([192,193,194].includes(marker)){const h=(bytes[p+3]<<8)|bytes[p+4],w=(bytes[p+5]<<8)|bytes[p+6];dimensions={w,h}}p+=size;
 }if(!dimensions||Math.min(dimensions.w,dimensions.h)<1||Math.max(dimensions.w,dimensions.h)>1600)throw new HttpError(422,'Размер подготовленного фото должен быть до 1600 пикселей.');
}
export class GitRepository{
 constructor(env,fetcher=fetch){this.env=env;this.fetcher=fetcher;this.root=`https://api.github.com/repos/${env.GITHUB_REPOSITORY||'romanmontanov1-eng/rudnovskayapodolog'}`;this.branch=env.GALLERY_BRANCH||'main'}
 async api(path,method='GET',body){const r=await this.fetcher(this.root+path,{method,headers:{Authorization:`Bearer ${this.env.GITHUB_TOKEN}`,'User-Agent':'olga-works','Accept':'application/vnd.github+json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new HttpError([409,422].includes(r.status)?409:502,r.status===404?'Не найдены данные сайта. Сначала установите обновление.':'Не удалось сохранить в GitHub. Обновите список и повторите.');return r.json()}
 async text(path,ref){const d=await this.api(`/contents/${path}?ref=${encodeURIComponent(ref)}`);return decoder.decode(unbase64(d.content))}
 async read(){const ref=await this.api(`/git/ref/heads/${this.branch}`);const head=ref.object.sha;const commit=await this.api(`/git/commits/${head}`);const [catalog,index,works]=await Promise.all([this.text(CATALOG,head),this.text('index.html',head),this.text('works.html',head)]);return {head,tree:commit.tree.sha,catalog:validateCatalog(JSON.parse(catalog)),index,works}}
 async commit(state,files){const entries=await Promise.all(files.map(async f=>{const b=await this.api('/git/blobs','POST',{content:f.bytes?base64(f.bytes):f.text,encoding:f.bytes?'base64':'utf-8'});return {path:f.path,mode:'100644',type:'blob',sha:b.sha}}));const tree=await this.api('/git/trees','POST',{base_tree:state.tree,tree:entries});const commit=await this.api('/git/commits','POST',{message:'Обновить работу через кабинет Ольги',tree:tree.sha,parents:[state.head]});await this.api(`/git/refs/heads/${this.branch}`,'PATCH',{sha:commit.sha,force:false});return commit.sha}
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
export function createServer(assets,{repository=env=>new GitRepository(env),fetcher=fetch}={}){return {async fetch(req,env){try{
 const url=new URL(req.url),path=url.pathname;
 const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://raw.githubusercontent.com https://romanmontanov1-eng.github.io; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
 if(/^\/icon-(180|192|512)\.png$/.test(path)&&assets.icons){const size=path.match(/(180|192|512)/)[1];return new Response(unbase64(assets.icons[size]),{headers:{...security,'Content-Type':'image/png'}});}
 if(path==='/icon.svg')return new Response(assets.icon,{headers:{...security,'Content-Type':'image/svg+xml'}});
 if(path==='/manifest.webmanifest')return json(assets.manifest);
 if(!env.ADMIN_PASSWORD||!env.GITHUB_TOKEN)return json({error:'Кабинет ещё не настроен.'},503);
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('Origin')!==url.origin)return json({error:'Запрос отклонён.'},403);
 if(path==='/api/login'&&req.method==='POST'){
 if(!req.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Неверный запрос.'},415);
 if(env.LOGIN_LIMITER&&!(await env.LOGIN_LIMITER.limit({key:req.headers.get('CF-Connecting-IP')||'unknown'})).success)return json({error:'Слишком много попыток. Попробуйте через минуту.'},429);
 const {password}=await req.json();if(typeof password!=='string'||!await same(password,env.ADMIN_PASSWORD))return json({error:'Неверный пароль.'},401);const exp=String(Date.now()+12*3600000);return json({ok:true},200,{'Set-Cookie':cookie(exp+'.'+await mac(env.ADMIN_PASSWORD,exp))})}
 if(path==='/api/logout'&&req.method==='POST')return json({ok:true},200,{'Set-Cookie':cookie('',0)});
 if(path==='/'&&req.method==='GET')return new Response(assets.html,{headers:{...security,'Content-Type':'text/html;charset=utf-8'}});
 if(['/app.js','/app.css'].includes(path)&&req.method==='GET')return new Response(path.endsWith('.js')?assets.js:assets.css,{headers:{...security,'Content-Type':path.endsWith('.js')?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}});
 if(!await session(req,env))return json({error:'Войдите в кабинет.'},401);
 if(path==='/api/works'&&req.method==='GET'){const s=await repository(env).read();return json({works:s.catalog.works.map(({operations,...w})=>w),imageBase:`https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY||'romanmontanov1-eng/rudnovskayapodolog'}/${s.head}/`})}
 if(path==='/api/works'&&req.method==='POST'){
 if(Number(req.headers.get('Content-Length'))>3000000)return json({error:'Слишком большой запрос.'},413);
 const reader=req.body?.getReader();if(!reader)throw new HttpError(400,'Пустой запрос.');let length=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>3000000){await reader.cancel();throw new HttpError(413,'Слишком большой запрос.')}chunks.push(value)}const form=await new Response(new Blob(chunks),{headers:{'Content-Type':req.headers.get('Content-Type')||''}}).formData();const input={id:form.get('id'),operation:form.get('operation'),revision:Number(form.get('revision')),title:form.get('title'),visible:form.get('visible')==='true',before:form.get('before'),after:form.get('after'),beforeRef:form.get('beforeRef'),afterRef:form.get('afterRef')};
 const result=await saveWork(repository(env),input);const {operations,...work}=result.work;return json({...result,work,message:'Сохранено в репозитории. Ожидается обновление сайта.'})}
 if(path==='/api/site-status'&&req.method==='GET'){
 if((env.GALLERY_BRANCH||'main')!=='main')return json({state:'staging',message:'Сохранено в тестовой ветке. Действующий сайт не изменён.'});
 const s=await repository(env).read();const r=await fetcher('https://romanmontanov1-eng.github.io/rudnovskayapodolog/works.html?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error();const html=await r.text();const matches=s.catalog.works.every(w=>w.visible?html.includes(`data-work-id="${w.id}" data-revision="${w.revision}"`):!html.includes(`data-work-id="${w.id}"`));return json({state:matches?'live':'pending',message:matches?'Изменения уже появились на сайте.':'Сохранено. Сайт ещё обновляется.'})}
 return json({error:'Не найдено.'},404);
 }catch(e){return json({error:e.status?e.message:'Не удалось выполнить запрос. Поля сохранены — попробуйте ещё раз.'},e.status||502)}}}}
