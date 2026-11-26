# Причина GITHUB_NETWORK и исправление

## Точная причина в серверном коде

В main `GitRepository` сохранял глобальный `fetch` как свойство экземпляра:

```js
constructor(env, fetcher = fetch) { this.fetcher = fetcher; }
// ...
await this.fetcher(url, options);
```

В runtime Cloudflare workerd вызов этого встроенного метода с `this`, равным экземпляру GitRepository, выбрасывает `TypeError: Illegal invocation: function called with incorrect this reference`. Запрос ещё не отправлен, поэтому HTTP-статуса GitHub у этой ошибки нет. Общий catch терял исходную причину и выдавал GITHUB_NETWORK. В Node fake-fetch тестах этого ограничения нет, поэтому прежние проверки не ловили дефект.

Первопричина воспроизведена в настоящем workerd через официальный Miniflare: старый вызов даёт Illegal invocation, обёртка `(...args) => globalThis.fetch(...args)` достигает изолированного upstream и получает 200. Регрессия сохранена в tests/workerd-fetch-receiver.cjs и отчёте tests/reports/workerd-fetch-receiver.json. Реальные токены для воспроизведения не требуются.

## Что проверено относительно GitHub

URL `https://api.github.com/repos/romanmontanov1-eng/rudnovskayapodolog/git/ref/heads/main` с User-Agent olga-works, Accept application/vnd.github+json и X-GitHub-Api-Version 2022-11-28 фактически возвращает 200. На момент проверки main указывает на 90b5f3e57c257a3c76e3ff5554648af336ac0578. Имя репозитория, ветка main и набор публичных API-заголовков корректны.

Реальный GITHUB_TOKEN в Cloudflare не читался. Его действительность и права невозможно подтвердить без запроса, использующего именно этот секрет. Неверный токен обычно даёт HTTP 401, отказ прав/лимит — 403/429, недоступная ветка/репозиторий — 404; это отличаются от исключения до fetch. Текущее исключение воспроизводится независимо от токена и прав. Для публикации fine-grained токен должен иметь Contents read/write только к этому репозиторию; для чтения достаточно Contents read. Секреты вводятся только в настройках Cloudflare.

## Изменения

- Глобальный fetch вызывается обёрткой с правильным получателем. Настройки login, cookie, Origin и LOGIN_LIMITER не изменялись.
- Сохраняется User-Agent, явно задаётся версия API. Редиректы обрабатываются в режиме manual и не следуются автоматически: токен не пересылается на неожиданный адрес. workerd не поддерживает redirect:error, поэтому используется совместимый manual.
- Имя репозитория и ветка проверяются до построения запроса, ветка кодируется в URL ref. С токена убираются только внешние пробелы при копировании; внутренние пробелы/переводы строк, не-ASCII и кавычки вызывают отдельную GITHUB_TOKEN_FORMAT до обращения в сеть. Пароль не изменяется.
- Каждый GitHub вызов логирует только event, requestId, method, категорию endpoint, фиксированный host, durationMs, githubStatus и безопасные githubRequestId/rateLimitRemaining.
- При исключении до ответа githubStatus=null и ограниченная классификация реальной причины: illegal_invocation, invalid_header, dns, tls, timeout, connection или fetch_exception. Записываются только разрешённые имена/коды исключений. Сырой message, stack, headers и тело upstream никогда не выводятся: они могут содержать секрет.
- HTTP-ошибки логируют фактический статус GitHub; 401/403/404/429 не называются сетевым исключением. Идентификатор входящего запроса связывает GitHub-логи с ответом API кабинета.

Пример безопасной записи:

```json
{"event":"github_request","requestId":"...","method":"GET","endpoint":"ref","host":"api.github.com","durationMs":2,"githubStatus":null,"reason":"illegal_invocation","exceptionName":"TypeError"}
```

## Проверки

23 Node-проверки (5 новых GitHub + 18 прежних) проходят. В том числе: правильный получатель fetch, URL и заголовки, 302 без перехода, HTTP 401/403/404/429/500, ошибки заголовка, DNS, невозможность утечки фиктивного токена в логах, отказ некорректной конфигурации.

Полная workerd-интеграция tests/workerd-github.cjs использует настоящий встроенный fetch и изолированную модель GitHub API, а не подменённую JavaScript-функцию fetch. Проверены 57 API-запросов: загрузка 6 работ, создание пары, переименование, замена только «До», снятие с показа, повтор запроса без дубля. Выполнены 4 атомарных коммита; после снятия — 6 карточек в галерее и 2 на главной. Результат в tests/reports/workerd-github.json. Настоящие секреты не использовались и production не изменялся.

Для runtime-проверок нужен официальный Miniflare: `node _cabinet/tests/workerd-fetch-receiver.cjs` и `node _cabinet/tests/workerd-github.cjs`. При установке в отдельный каталог можно передать MINIFLARE_MODULE. Эти тесты не входят в обычный glob *.test.mjs и запускаются отдельно. Обычные тесты — `npm test`.

Деплой стандартный: `node _cabinet/build.mjs`, `npx wrangler deploy --config _cabinet/wrangler.toml`. После деплоя проверить GET /api/works с реальной сессией. В логах первого GitHub-запроса ожидается githubStatus=200; если секрет/права не настроены, теперь будет виден точный HTTP-статус и безопасный код. Реальная публикация на сайте должна выполняться только с выбранной Ольгой парой. Авторизация, UI, CSS и публичные страницы этим PR не меняются.
