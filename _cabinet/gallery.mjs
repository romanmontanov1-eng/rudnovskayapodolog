export const CATALOG='assets/data/works.json';
export const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function render(html,works,limit=Infinity){
 const cards=works.filter(w=>w.visible).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,limit).map(w=>`<article class="work-case" data-work-id="${escape(w.id)}" data-revision="${w.revision}"><div class="work-pair">${['before','after'].map((s,i)=>`<figure><figcaption>${i?'После':'До'}</figcaption><button type="button" class="work-photo" data-lightbox-src="${escape(w[s])}" data-lightbox-alt="${escape(w.title)}: ${i?'после':'до'}" aria-label="Увеличить фото: ${i?'После':'До'}"><img src="${escape(w[s])}" alt="${escape(w.title)}: ${i?'после':'до'}" loading="lazy" decoding="async"></button></figure>`).join('')}</div><h2>${escape(w.title)}</h2></article>`).join('\n');
 if(!html.includes('<!-- WORKS:START -->')||!html.includes('<!-- WORKS:END -->'))throw new Error('Нет маркеров галереи. Сначала обновите сайт.');
 return html.replace(/<!-- WORKS:START -->[\s\S]*?<!-- WORKS:END -->/,`<!-- WORKS:START -->\n${cards}\n<!-- WORKS:END -->`);
}
export function validateCatalog(c){if(c.version!==1||!Array.isArray(c.works)||new Set(c.works.map(w=>w.id)).size!==c.works.length)throw new Error('Некорректный список работ');return c}
