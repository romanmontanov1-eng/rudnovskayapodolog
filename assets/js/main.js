const menu=document.querySelector('[data-menu]');
const nav=document.querySelector('[data-nav]');
if(menu&&nav){
  const closeMenu=()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Открыть меню')};
  menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню')});
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('open')){closeMenu();menu.focus()}});
}

const els=[...document.querySelectorAll('.reveal')];
if('IntersectionObserver'in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');io.unobserve(e.target)}}),{threshold:.08});
  els.forEach(e=>io.observe(e));
}else els.forEach(e=>e.classList.add('is-visible'));

const lightbox=document.querySelector('[data-lightbox]');
if(lightbox){
  const img=lightbox.querySelector('img');
  const closeButton=lightbox.querySelector('.lightbox__close');
  let opener=null;
  const close=()=>{
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
    img.removeAttribute('src');
    if(opener) opener.focus();
  };
  document.querySelectorAll('[data-lightbox-src]').forEach(b=>b.addEventListener('click',()=>{
    opener=b;
    img.src=b.dataset.lightboxSrc;
    img.alt=b.dataset.lightboxAlt||'';
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    closeButton.focus();
  }));
  closeButton.addEventListener('click',close);
  lightbox.addEventListener('click',e=>{if(e.target===lightbox)close()});
  document.addEventListener('keydown',e=>{
    if(!lightbox.classList.contains('open')) return;
    if(e.key==='Escape') close();
    if(e.key==='Tab'){e.preventDefault();closeButton.focus()}
  });
}

// MAX contact is available by phone number.
document.querySelectorAll('[data-max-copy]').forEach(button => {
 button.addEventListener('click', async () => {
  const status = button.parentElement.querySelector('.copy-status');
  try {
   if (!navigator.clipboard) throw new Error('Clipboard unavailable');
   await navigator.clipboard.writeText('+79295400667');
   status.textContent = 'Номер скопирован. Откройте MAX и найдите контакт по номеру.';
  } catch (_) {
   status.textContent = 'Скопируйте номер вручную: +7 929 540-06-67';
  }
 });
});
