import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createServer,GitRepository} from '../server.mjs';
import {requestJSON} from '../api-client.mjs';
const origin='https://cabinet.test';
const env={ADMIN_PASSWORD:'Тестовый-пароль-🔒',GITHUB_TOKEN:'test-token',LOGIN_LIMITER:{limit:async()=>({success:true})}};
const req=(path,{method='GET',headers={},body}={})=>new Request(origin+path,{method,headers,body});
const login=(server,e=env,password=e.ADMIN_PASSWORD,headers={})=>server.fetch(req('/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json; charset=utf-8',...headers},body:JSON.stringify({password})}),e);
const assets={html:'<html lang="ru">Работы Ольги</html>',js:'',client:'',css:''};
const repo={read:async()=>({head:'sha',catalog:{works:[{id:'case-1',title:'До и после',operations:[]}]}})};
const server=createServer(assets,{repository:()=>repo});
test('UTF-8 вход → Secure cookie → session → works → logout, без нормализации пароля',async()=>{
 const r=await login(server);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/json; charset=utf-8/);assert.deepEqual(await r.json(),{ok:true});const cookie=r.headers.get('set-cookie');assert.match(cookie,/Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200/);assert.ok(/^[\x20-\x7e]+$/.test(cookie));const headers={Cookie:cookie.split(';')[0]};assert.equal((await server.fetch(req('/api/session',{headers}),env)).status,200);
 const works=await server.fetch(req('/api/works',{headers}),env);assert.equal(works.status,200);assert.equal((await works.json()).works[0].title,'До и после');const logout=await server.fetch(req('/api/logout',{method:'POST',headers:{...headers,Origin:origin}}),env);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await server.fetch(req('/api/session',{headers:{Cookie:'olga_session='}}),env)).status,401);assert.equal((await login(server,env,env.ADMIN_PASSWORD+' ')).status,401);
});
test('Origin отсутствующий/null/чужой отклоняется до limiter и cookie',async()=>{for(const Origin of ['null','https://evil.test','']){let calls=0;const r=await login(server,{...env,LOGIN_LIMITER:{limit:async()=>{calls++;return{success:true}}}},env.ADMIN_PASSWORD,{Origin});assert.equal(r.status,403);assert.equal((await r.json()).code,'ORIGIN_MISMATCH');assert.equal(calls,0);assert.equal(r.headers.get('set-cookie'),null)}});
test('401 неверный пароль и отсутствие/подделка/повреждение/истечение cookie',async()=>{
 const wrong=await login(server,env,'wrong');assert.equal(wrong.status,401);assert.equal((await wrong.json()).code,'INVALID_PASSWORD');assert.equal(wrong.headers.get('set-cookie'),null);
 for(const value of ['', 'olga_session=%E0%A4%A','olga_session=0.fake',`olga_session=${Date.now()+3600000}.fake`])assert.equal((await server.fetch(req('/api/works',{headers:{Cookie:value}}),env)).status,401);
 const r=await login(server);assert.equal((await server.fetch(req('/api/session',{headers:{Cookie:r.headers.get('set-cookie').split(';')[0]}}),{...env,ADMIN_PASSWORD:'rotated'})).status,401);
});
test('LOGIN_LIMITER: 429 Retry-After; при отказе/отсутствии защита закрывает вход',async()=>{
 const denied=await login(server,{...env,LOGIN_LIMITER:{limit:async()=>({success:false})}});assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'60');assert.equal(denied.headers.get('set-cookie'),null);
 for(const limiter of [undefined,{}, {limit:async()=>{throw Error('private detail')}},{limit:async()=>({})}]){const r=await login(server,{...env,LOGIN_LIMITER:limiter});assert.equal(r.status,503);const data=await r.json();assert.equal(data.code,'LOGIN_LIMITER_UNAVAILABLE');assert.ok(!JSON.stringify(data).includes('private detail'));assert.equal(r.headers.get('set-cookie'),null)}
});
test('неверный JSON/Content-Type/структура дают 400/415, не сетевую ошибку',async()=>{
 for(const body of ['{','null','{}','{"password":123}']){const r=await server.fetch(req('/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body}),env);assert.equal(r.status,400);assert.match(r.headers.get('content-type'),/utf-8/);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok((await r.json()).requestId)}
 assert.equal((await login(server,env,env.ADMIN_PASSWORD,{'Content-Type':'text/plain'})).status,415);
});
test('настройка GitHub не влияет на вход; session отделена от загрузки works',async()=>{
 const e={...env,GITHUB_TOKEN:undefined};const r=await login(server,e);assert.equal(r.status,200);const headers={Cookie:r.headers.get('set-cookie').split(';')[0]};assert.equal((await server.fetch(req('/api/session',{headers}),e)).status,200);const works=await server.fetch(req('/api/works',{headers}),e);assert.equal(works.status,503);assert.equal((await works.json()).code,'GITHUB_NOT_CONFIGURED');
 assert.equal((await server.fetch(req('/'),{})).status,200);assert.equal((await login(server,{...env,ADMIN_PASSWORD:undefined})).status,503);
});
test('GitHub 401/403/HTML/network возвращаются JSON 502 с отдельной причиной',async()=>{
 const cookie=(await login(server)).headers.get('set-cookie').split(';')[0];
 for(const [fetcher,code] of [[async()=>new Response('{}',{status:401}),'GITHUB_AUTH'],[async()=>new Response('{}',{status:403}),'GITHUB_ACCESS'],[async()=>new Response('<html>bad</html>'),'GITHUB_RESPONSE'],[async()=>{throw Error('private token')},'GITHUB_NETWORK']]){const s=createServer(assets,{repository:e=>new GitRepository(e,fetcher)});const r=await s.fetch(req('/api/works',{headers:{Cookie:cookie}}),env);assert.equal(r.status,502);assert.match(r.headers.get('content-type'),/utf-8/);const data=await r.json();assert.equal(data.code,code);assert.equal(data.requestId,r.headers.get('x-request-id'));assert.ok(!JSON.stringify(data).includes('private token'));assert.equal((await s.fetch(req('/api/session',{headers:{Cookie:cookie}}),env)).status,200)}
});
test('client: cookies явно same-origin, UTF-8/BOM и статусы сохраняются',async()=>{
 const fetcher=async(path,options)=>{assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.headers.Accept,'application/json');return new Response('\uFEFF{"ok":"Ольга"}',{headers:{'Content-Type':'application/json; charset=utf-8'}})};assert.deepEqual(await requestJSON('/api/login',{}, {fetcher}),{ok:'Ольга'});
 const bad=async()=>Response.json({error:'Неверный пароль.',code:'INVALID_PASSWORD'},{status:401});await assert.rejects(requestJSON('/api/login',{}, {fetcher:bad}),e=>e.status===401&&e.message==='Неверный пароль.'&&!e.unknown);
});
test('client: полные HTML 502, повреждённый JSON, сетевой обрыв и timeout различаются',async()=>{
 const scenarios=[{f:async()=>new Response('<html>Bad Gateway</html>',{status:502,headers:{'Content-Type':'text/html','CF-Ray':'test-ray'}}),code:'NON_JSON',status:502}, {f:async()=>new Response('{"ok":',{headers:{'Content-Type':'application/json'}}),code:'INVALID_JSON',status:200},{f:async()=>{throw TypeError('Failed to fetch')},code:'NETWORK',status:0},{f:async()=>new Response(new ReadableStream({start(c){c.error(Error('body interrupted'))}}),{headers:{'Content-Type':'application/json'}}),code:'NETWORK',status:200}];
 for(const s of scenarios)await assert.rejects(requestJSON('/api/works',{method:'POST'},{fetcher:s.f}),e=>e.code===s.code&&e.status===s.status&&e.unknown);
 await assert.rejects(requestJSON('/api/login',{}, {timeoutMs:5,fetcher:(p,o)=>new Promise((res,rej)=>o.signal.addEventListener('abort',()=>rej(Error('timeout'))))}),e=>e.code==='TIMEOUT'&&!e.unknown);
});
test('UI: successful login + failed works не сбрасывает экран на login; при failed login пароль остаётся',async()=>{
 const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace("import {requestJSON} from './api-client.mjs';",'');
 const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{hidden:true,value:'Тестовый пароль',textContent:'',disabled:false});return nodes.get(s)};
 let accepted=false;
 const context={document:{querySelector:node,querySelectorAll:()=>[]},indexedDB:{open:()=>({})},window:{scrollTo(){},addEventListener(){}},navigator:{onLine:true},URL,Blob,Image:class{},crypto,structuredClone,requestJSON:async(path)=>{if(path==='/api/session')throw Object.assign(Error('Войдите'),{status:401});if(path==='/api/login'){if(!accepted)throw Object.assign(Error('Неверный пароль'),{status:401});return{ok:true}}if(path==='/api/works')throw Object.assign(Error('GitHub недоступен'),{status:502})}};
 vm.runInNewContext(source,context);await new Promise(setImmediate);
 const button={disabled:false};const event={preventDefault(){},target:{querySelector:()=>button}};await node('#login-form').onsubmit(event);assert.equal(node('#password').value,'Тестовый пароль');accepted=true;await node('#login-form').onsubmit(event);assert.equal(node('#home').hidden,false);assert.equal(node('#login').hidden,true);assert.match(node('#status').textContent,/Вход выполнен, но работы не загрузились/);assert.equal(button.disabled,false);
});
