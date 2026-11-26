import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../worker.mjs';
const origin='https://cabinet.test';
const text=async path=>(await worker.fetch(new Request(origin+path),{})).text();
test('generated HTML uses one versioned classic script and fail-closed login form',async()=>{
 const html=await text('/');assert.match(html,/<script defer src="\/app.js\?v=[a-f0-9]{16}"><\/script>/);assert.ok(!html.includes('type="module"'));assert.match(html,/<form id="login-form" method="post" action="\/api\/login">/);assert.match(html,/<button class="primary" disabled>Войти/);assert.match(html,/<noscript>/);assert.match(html,/name="password"/);
 const js=await text('/app.js');assert.ok(!/^import |^export /m.test(js));new vm.Script(js);
 const r=await worker.fetch(new Request(origin+'/app.js?v=old'),{});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('content-type'),/javascript.*utf-8/);assert.ok(!r.headers.get('content-security-policy').includes("script-src 'self' 'unsafe-inline'"));
});
test('startup installs submit before enabling button and does not open IndexedDB',async()=>{
 const nodes=new Map();const button={disabled:true};let opens=0;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',hidden:true,textContent:'',disabled:false,addEventListener(){},querySelector(){return button}});return nodes.get(s)};
 const context={document:{querySelector:node,querySelectorAll:()=>[]},window:{scrollTo(){},addEventListener(){}},navigator:{onLine:true},indexedDB:{open(){opens++;throw Error('storage denied')}},setTimeout,clearTimeout,AbortController,Response,fetch:async()=>Response.json({error:'Войдите',code:'SESSION_REQUIRED'},{status:401}),URL,Blob,crypto,structuredClone};
 vm.runInNewContext(await text('/app.js'),context);assert.equal(typeof node('#login-form').onsubmit,'function');assert.equal(button.disabled,false);await new Promise(setImmediate);assert.equal(opens,0);assert.equal(node('#login').hidden,false);
});
