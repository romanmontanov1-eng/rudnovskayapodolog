# Рудновская Ольга Алексеевна — production site

Статический сайт на HTML/CSS/JS. Build step не требуется.

## Страницы
- `index.html` — главная
- `services.html` — услуги
- `about.html` — образование, документы, премия
- `prices.html` — полный актуальный прайс
- `contacts.html` — контакты и кабинет

## Локальный просмотр
Из корня проекта:

```bash
python -m http.server 8000 --bind 0.0.0.0
```

На компьютере: `http://localhost:8000`.
Для проверки с телефона откройте `http://<IPv4-компьютера>:8000` в той же локальной сети.

## GitHub
Загрузить содержимое этой папки в корень репозитория. `index.html` должен оставаться в корне. Секретов, build-зависимостей и `node_modules` проект не использует.

## Netlify
- Build command: **не нужен**
- Publish directory: **корень проекта** (`.`), где расположен `index.html`
- Production URL, прописанный в canonical/OG/sitemap: `https://snazzy-trifle-292e00.netlify.app/`

Если production-домен будет изменён, перед релизом заменить домен в canonical/`og:url`, `robots.txt` и `sitemap.xml`.

## После deploy
Открыть production URL и вручную проверить все 5 страниц, mobile menu, телефон, WhatsApp, изображения, документы и цены. Успешный deploy сам по себе не заменяет post-deploy проверку.
