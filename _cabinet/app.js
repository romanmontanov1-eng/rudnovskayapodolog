import {requestJSON} from './api-client.mjs';
const $=s=>document.querySelector(s);let db,current=null,remote=[],imageBase='',busy=false,objectURLs=[],editorAction=0;
const STORAGE_TIMEOUT_MS=8000,PHOTO_TIMEOUT_MS=20000;
let ready,lastStorageError='';const draftSaves=new Map();
function database(){
 if(!ready){let attempt;attempt=new Promise((resolve,reject)=>{let done=false,r;const timer=setTimeout(()=>finish(Error('Хранилище черновиков не ответило. Повторите сохранение.')),STORAGE_TIMEOUT_MS);
 function finish(error){if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve()}
 try{r=indexedDB.open('olga-works',1);r.onupgradeneeded=()=>r.result.createObjectStore('works',{keyPath:'id'});r.onsuccess=()=>{if(done){r.result.close();return}db=r.result;db.onversionchange=()=>{db.close();db=null;ready=undefined};finish()};r.onerror=r.onblocked=()=>finish(Error('Хранилище черновиков недоступно. Разрешите сохранение данных этого сайта.'))}catch{finish(Error('Хранилище черновиков недоступно. Разрешите сохранение данных этого сайта.'))}
 });ready=attempt;attempt.catch(()=>{if(ready===attempt)ready=undefined})}return ready;
}
async function tx(mode,fn){await database();return new Promise((resolve,reject)=>{let done=false,t,r;const connection=db;const timer=setTimeout(()=>{finish(Error('Сохранение в браузере не завершилось. Повторите действие.'));try{t?.abort()}catch{}try{connection?.close()}catch{}if(db===connection){db=null;ready=undefined}},STORAGE_TIMEOUT_MS);
 function finish(error,value){if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value)}
 try{t=db.transaction('works',mode);t.oncomplete=()=>finish(null,r?.result);t.onerror=t.onabort=()=>finish(Error('Браузер не сохранил черновик. Проверьте свободное место и разрешение на хранение данных.'));r=fn(t.objectStore('works'))}catch{try{t?.abort()}catch{}finish(Error('Браузер не сохранил черновик. Проверьте свободное место и разрешение на хранение данных.'))}
 })}
function bounded(promise,message,timeout=PHOTO_TIMEOUT_MS){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(message)),timeout);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})})}

const say=s=>$('#status').textContent=s;
async function storedRecord(record){const snapshot=structuredClone(record);for(const side of ['before','after'])if(snapshot[side] instanceof Blob){const blob=snapshot[side];snapshot[side]={format:'olga-binary-v1',type:blob.type,bytes:await bounded(blob.arrayBuffer(),'Не удалось подготовить черновик для хранения.',STORAGE_TIMEOUT_MS)}}return snapshot}
function restoredRecord(record){for(const side of ['before','after']){const value=record[side];if(value?.format==='olga-binary-v1'&&value.bytes instanceof ArrayBuffer)record[side]=new Blob([value.bytes],{type:value.type||'image/jpeg'});else if(typeof value==='string'&&value.startsWith('data:'))record[side]=dataBlob(value)}record.revision??=0;record.visible??=true;return record}
async function persist({quiet=false,recordSnapshot}={}){const record=current;if(!record)return false;let job;job=(async()=>{await Promise.resolve();try{const snapshot=recordSnapshot||await storedRecord(record);const latest=draftSaves.get(record.id);if(latest&&latest!==job)return latest;await tx('readwrite',s=>s.put(snapshot));lastStorageError='';return true}catch(e){lastStorageError=e.message+' Данные остаются в открытой форме; не закрывайте страницу.';return false}})();draftSaves.set(record.id,job);const saved=await job;if(!saved&&!quiet&&current===record)say(lastStorageError);return saved}

function dataBlob(value){const [head,data]=value.split(',');return new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:head.match(/data:([^;]+)/)[1]})}
async function drafts(){const all=await tx('readonly',s=>s.getAll());for(const d of all){const migrate=['before','after'].some(side=>d[side] instanceof Blob||(typeof d[side]==='string'&&d[side].startsWith('data:')));restoredRecord(d);if(migrate){const snapshot=await storedRecord(d);await tx('readwrite',s=>s.put(snapshot))}}return all}

function source(value){if(value instanceof Blob){const u=URL.createObjectURL(value);objectURLs.push(u);return u}return value?imageBase+value:''}
function release(){objectURLs.forEach(URL.revokeObjectURL);objectURLs=[]}
function photo(value,label){const img=new Image();img.src=source(value);img.alt=label;return img}
async function api(path,options){try{return await requestJSON(path,options)}catch(e){if(e.status===401&&path!=='/api/login')show('login');throw e}}
async function openSession(){try{await api('/api/session');await home()}catch(e){if(e.status===401||e.code==='ADMIN_NOT_CONFIGURED')show('login');else show('home');if(e.status!==401)say(e.message)}}

function show(section){for(const id of ['login','home','editor'])$('#'+id).hidden=id!==section;window.scrollTo(0,0)}
function lock(value){busy=value;document.querySelectorAll('#editor button,#editor input').forEach(el=>el.disabled=value)}
function changed(){current.operation=null;current.updated=Date.now();const record=current,action=editorAction;persist({quiet:true}).then(saved=>{if(!saved&&current===record&&!busy&&action===editorAction)say(lastStorageError)})}
function previews(){release();for(const side of ['before','after']){const frame=$('#'+side);frame.replaceChildren(current[side]?photo(current[side],side==='before'?'Фото до':'Фото после'):document.createTextNode('Выберите фото'));frame.nextElementSibling.querySelector('span').textContent=current[side]?'Заменить фото':'Выбрать фото'}}
function edit(record){current=structuredClone(record);current.revision??=0;current.visible??=true;show('editor');$('#title').value=current.title;$('#heading').textContent=current.revision?'Редактировать работу':'Новая работа';$('#save').textContent=current.revision&&current.visible?'Сохранить изменения':'Опубликовать';$('#hide').hidden=!current.revision||!current.visible;document.querySelectorAll('[type=file]').forEach(i=>i.value='');previews();say(current.requestState==='sending'||current.requestState==='unknown'||current.requestState==='unconfirmed'?'Предыдущая отправка не подтверждена. Подключитесь к интернету и повторите действие — дубль не создастся.':'')}
async function home(){if(busy)return;release();const data=await api('/api/works');remote=data.works;imageBase=data.imageBase;const local=await drafts(),records=[...local,...remote.filter(w=>!local.some(d=>d.id===w.id))].sort((a,b)=>(b.createdAt||'9999').localeCompare(a.createdAt||'9999'));const list=$('#list');list.replaceChildren();if(!records.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='Добавьте первую пару «до и после».';list.append(empty)}for(const r of records){const a=document.createElement('article'),pair=document.createElement('div');pair.className='pair';['before','after'].forEach((side,i)=>{const p=document.createElement('div');p.className='photo';const strong=document.createElement('strong');strong.textContent=i?'После':'До';const f=document.createElement('div');f.className='frame';f.append(r[side]?photo(r[side],strong.textContent):document.createTextNode('Нет фото'));p.append(strong,f);pair.append(p)});const h=document.createElement('h2');h.textContent=r.title||'Без названия';const note=document.createElement('small');note.className='muted';note.textContent=local.some(d=>d.id===r.id)?(r.requestState==='sending'||r.requestState==='unknown'||r.requestState==='unconfirmed'?'Отправка не подтверждена · откройте и повторите':'Черновик на устройстве'):r.visible?'Включена для показа':'Снята с показа';const b=document.createElement('button');b.textContent='Открыть работу';b.onclick=()=>edit(r);a.append(pair,h,note,b);if(local.some(d=>d.id===r.id)&&remote.some(w=>w.id===r.id)){const reset=document.createElement('button');reset.textContent='Открыть сохранённую версию';reset.onclick=async()=>{if(confirm('Убрать локальные правки этой работы и открыть сохранённую версию?')){await tx('readwrite',s=>s.delete(r.id));edit(remote.find(w=>w.id===r.id))}};a.append(reset)}list.append(a)}current=null;show('home')}
$('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;say('Проверяю пароль…');try{await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#password').value})});$('#password').value='';say('Вход выполнен. Загружаю работы…');show('home');try{await home();say('')}catch(e){say(e.status===401?'Сессия не сохранилась. Разрешите cookies для этого сайта и войдите снова.':'Вход выполнен, но работы не загрузились. '+e.message)}}catch(e){say(e.message)}finally{button.disabled=false}};
$('#password').addEventListener('invalid',()=>say('Введите пароль в поле перед входом.'));
$('#login-form').querySelector('button').disabled=false;
$('#logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});remote=[];release();$('#list').replaceChildren();show('login');say('Вы вышли из кабинета.')}catch(e){say(e.message)}};
$('#add').onclick=()=>edit({id:crypto.randomUUID(),title:'',before:null,after:null,revision:0,visible:true,updated:Date.now()});
$('#back').onclick=async()=>{if(busy)return;if(current&&(current.title||current.before||current.after)&&!await persist())return;try{await home();say('')}catch(e){say(e.message)}};
$('#title').addEventListener('invalid',()=>say('Введите короткое название работы.'));
$('#title').oninput=()=>{current.title=$('#title').value;changed()};
$('#swap').onclick=()=>{[current.before,current.after]=[current.after,current.before];previews();changed();say('Снимки поменялись местами.')};
async function optimize(file){
 if(file.size>40*1024*1024)throw Error('Файл больше 40 МБ. Выберите уменьшенную копию.');
 const url=URL.createObjectURL(file),img=new Image();
 try{
 await bounded(new Promise((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error('FORMAT'));img.src=url;if(typeof img.decode==='function')img.decode().then(resolve,()=>reject(Error('FORMAT')))}),'Чтение фото заняло слишком много времени. Выберите JPEG/PNG или уменьшенную копию.');
 if(!img.naturalWidth||!img.naturalHeight)throw Error('FORMAT');
 const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));let ctx;try{ctx=canvas.getContext('2d',{colorSpace:'srgb'})}catch{ctx=canvas.getContext('2d')}if(!ctx)throw Error('Не удалось обработать фото. Выберите другой снимок.');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
 try{for(const quality of [.9,.82,.72]){const blob=await bounded(new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality)),'Подготовка фото не завершилась. Выберите другой JPEG/PNG.');if(blob&&blob.type==='image/jpeg'&&blob.size<=1400000)return blob}throw Error('Не удалось уменьшить фото. Выберите другой снимок.')}finally{canvas.width=canvas.height=1}
 }catch(e){if(e.message==='FORMAT')throw Error('Не удалось прочитать этот формат. Если это HEIC/HEIF, экспортируйте фото в JPEG или PNG. Название и выбранные снимки сохранены в форме.');if(!/фото|Файл|JPEG|PNG|формат/.test(e.message))throw Error('Не удалось обработать фото. Выберите JPEG/PNG или уменьшенную копию. Данные остаются в форме.');throw e}
 finally{img.onload=img.onerror=null;img.removeAttribute('src');URL.revokeObjectURL(url)}
}
document.querySelectorAll('[type=file]').forEach(input=>input.onchange=async()=>{const file=input.files[0];if(!file)return;if(busy){input.value='';return}let prepared=false;const record=current,action=editorAction;lock(true);say('Подготавливаю фото…');try{const blob=await optimize(file);if(current!==record)return;current[input.dataset.side]=blob;current.operation=null;current.updated=Date.now();previews();prepared=true}catch(e){say(e.message)}finally{input.value='';lock(false)}
 if(prepared){const saved=await persist({quiet:true});if(current===record&&!busy&&action===editorAction)say(saved?'Фото подготовлено и сохранено в черновике.':lastStorageError)}
});

$('#draft').onclick=async()=>{if(busy)return;editorAction++;lock(true);say('Сохраняю черновик…');try{current.title=$('#title').value;if(await persist())say('Черновик сохранён на устройстве. На сайт не отправлен.')}finally{lock(false)}};
function publicationError(code,message){return Object.assign(Error(message),{publicationCode:code,publicMessage:message})}
function publicationTrace(stage,outcome,{code,status,exceptionName,dispatched=false,responseReceived=false}={}){try{const safeCode=/^(PUBLICATION_[A-Z_]+|REQUEST_SETUP|NETWORK|TIMEOUT|HTTP|NON_JSON|INVALID_JSON|GITHUB_[A-Z_]+|SESSION_REQUIRED|ORIGIN_MISMATCH)$/.test(code||'')?code:undefined;console.info(JSON.stringify({event:'publication',stage,outcome,...(safeCode?{code:safeCode}:{}),...(Number.isInteger(status)?{status}:{}),...(['TypeError','DataCloneError','QuotaExceededError','InvalidStateError','Error','AbortError'].includes(exceptionName)?{exceptionName}:{}),dispatched,responseReceived}))}catch{}}
function validatePublication(record,visible){if(!record||!record.title?.trim()||!record.before||!record.after)throw publicationError('PUBLICATION_FIELDS','Добавьте название и оба фото.');if(record.title.trim().length>100||!Number.isInteger(record.revision)||record.revision<0||typeof visible!=='boolean'||!/^(case-[1-6]|[a-f0-9-]{36})$/.test(record.id||'')||!/^[a-f0-9-]{36}$/.test(record.operation||''))throw publicationError('PUBLICATION_METADATA','Не удалось проверить данные работы. Откройте работу заново; введённые данные остаются в форме.')}
function publicationBody(snapshot,visible){
 validatePublication(snapshot,visible);const encoder=new TextEncoder(),boundary='olga-'+crypto.randomUUID(),parts=[];
 function field(name,value){parts.push(encoder.encode('--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+String(value)+'\r\n'))}
 for(const [name,value]of Object.entries({id:snapshot.id,operation:snapshot.operation,revision:snapshot.revision,title:snapshot.title.trim(),visible}))field(name,value);
 for(const side of ['before','after']){const value=snapshot[side];if(value?.format==='olga-binary-v1'&&value.bytes instanceof ArrayBuffer){const bytes=new Uint8Array(value.bytes);if(bytes.length<100||bytes.length>1400000||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw publicationError('PUBLICATION_PHOTO','Фото не подготовлено для публикации. Замените снимок на JPEG или PNG.');parts.push(encoder.encode('--'+boundary+'\r\nContent-Disposition: form-data; name="'+side+'"; filename="'+side+'.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'),bytes,encoder.encode('\r\n'))}else if(snapshot.revision>0&&typeof value==='string'&&/^assets\/images\/[^\r\n]+$/.test(value)){field(side+'Ref',value)}else throw publicationError('PUBLICATION_PHOTO','Не удалось прочитать один из снимков. Замените только этот снимок и повторите публикацию.')}
 parts.push(encoder.encode('--'+boundary+'--\r\n'));const length=parts.reduce((n,p)=>n+p.byteLength,0);if(length>3000000)throw publicationError('PUBLICATION_SIZE','Пара фотографий слишком велика. Выберите уменьшенные снимки.');const body=new Uint8Array(length);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.byteLength}return {body,headers:{'Content-Type':'multipart/form-data; boundary='+boundary}};
}
async function submit(visible){
 if(busy||!current)return;editorAction++;const record=current;let stage='validate',dispatched=false,responseReceived=false,saved=false;lock(true);
 const trace=(outcome,extra={})=>publicationTrace(stage,outcome,{dispatched,responseReceived,...extra});
 try{
 record.title=$('#title').value;if(!navigator.onLine)throw publicationError('PUBLICATION_OFFLINE','Нет интернета. Подключитесь и повторите публикацию.');
 if(record.pendingVisible!==undefined&&record.pendingVisible!==visible)record.operation=null;record.operation??=crypto.randomUUID();record.pendingVisible=visible;validatePublication(record,visible);record.requestState='preparing';trace('started');
 stage='snapshot';const snapshot=await storedRecord(record);trace('ok');
 stage='multipart';const payload=publicationBody(snapshot,visible);trace('ok');
 stage='request-build';new Request(new URL('/api/works',window.location.href),{method:'POST',headers:payload.headers,body:payload.body,credentials:'same-origin',cache:'no-store'});trace('ok');
 stage='draft-save';record.requestState=snapshot.requestState='prepared';if(!await persist({quiet:true,recordSnapshot:snapshot}))throw publicationError('PUBLICATION_STORAGE','Не удалось сохранить черновик перед отправкой. Проверьте место и разрешение на хранение данных.');trace('ok');
 stage='dispatch';say('Отправляю пару…');const result=await api('/api/works',{method:'POST',...payload,onDispatch:()=>{dispatched=true;record.requestState='sending';trace('attempted')},onResponse:status=>{responseReceived=true;stage='response';trace('received',{status})}});
 saved=true;record.requestState='confirmed';trace('confirmed');current={...result.work};stage='cleanup';await tx('readwrite',s=>s.delete(record.id));lock(false);await home();say(result.message);await checkSite();
 }catch(e){
 if(saved){say('Работа сохранена в репозитории. Не удалось обновить список или убрать локальный черновик. Откройте список снова.');trace('cleanup-failed');}
 else{
 const local=!dispatched||e.requestDispatched===false&&e.code==='REQUEST_SETUP';record.requestState=local?'not-sent':e.unknown?'unconfirmed':'rejected';const errorStage=stage;
 const stored=await persist({quiet:true});const kept=stored?'Черновик сохранён на устройстве.':'Данные остаются только в открытой форме; не закрывайте страницу.';
 if(local){const messages={validate:'Не удалось проверить поля работы.',snapshot:'Не удалось подготовить снимки или скопировать данные черновика.',multipart:'Не удалось собрать фотографии для отправки.', 'request-build':'Браузер не смог подготовить запрос публикации.', 'draft-save':'Не удалось сохранить черновик перед отправкой.',dispatch:'Не удалось подготовить отправку запроса.'};say((e.publicMessage||messages[errorStage]||'Локальная ошибка подготовки публикации.')+' Работа не отправлена на сайт. '+kept+' Код проверки: '+(e.publicationCode||'PUBLICATION_'+errorStage.replace('-','_').toUpperCase())+'.')}
 else if(e.unknown){say(e.message+' Публикация не подтверждена. '+kept+' Повторите то же действие — операция сохранена, дубль не создастся.')}
 else say(e.message+' '+kept);
 publicationTrace(errorStage,'failed',{code:e.publicationCode||e.code||(local?'PUBLICATION_'+errorStage.replace('-','_').toUpperCase():undefined),status:e.status,exceptionName:e.name,dispatched:!local,responseReceived});
 }
 }finally{lock(false)}
}

$('#work-form').onsubmit=e=>{e.preventDefault();submit(true)};$('#hide').onclick=()=>{if(confirm('Снять работу с показа? Фото могут остаться в истории публичного репозитория.')){if(current.pendingVisible!==false)current.operation=null;submit(false)}};
async function checkSite(){try{const d=await api('/api/site-status');$('#site-status').textContent=d.message}catch(e){$('#site-status').textContent='Не удалось проверить сайт. Сохранённые изменения не потеряны.'}}$('#check-site').onclick=checkSite;
say('');openSession();

function connection(){const el=$('#network');if(el)el.textContent=navigator.onLine?'Для входа и публикации нужен интернет.':'Нет интернета. Публикация недоступна; не закрывайте страницу до сохранения черновика.'}window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();
