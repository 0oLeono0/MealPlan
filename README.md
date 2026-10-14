# MealPlan — каркас S1-03

Минимальное React/TypeScript-приложение. Меню, генератор, Rational, каталог,
IndexedDB и полноценные экраны ещё не реализованы. Кнопка на стартовой странице
проверяет настоящий module Worker и доступность BigInt; она ничего не сохраняет.

## Окружение и чистый запуск

Нужны **Node 24.21.0 / npm 11.19.0**, npm поставляется с этим Node.
Версии закреплены в `.node-version`, `.nvmrc`, `package.json`; `.npmrc` и
preinstall отклоняют другое окружение. Системные 24.12.0 / 11.6.2 не подходят.

С nvm-windows: `nvm install 24.21.0`, затем `nvm use 24.21.0`.
С nvm на Linux/macOS: `nvm install`, затем `nvm use` в корне проекта.
Проверьте `node --version` и `npm --version` перед установкой.

Без менеджера на Windows можно использовать отдельный официальный ZIP, не
меняя системную установку (команды PowerShell):

```powershell
$mealplanRuntime = Join-Path $env:LOCALAPPDATA 'MealPlanRuntime'
New-Item -ItemType Directory -Force $mealplanRuntime | Out-Null
Invoke-WebRequest https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip -OutFile "$mealplanRuntime/node.zip"
Invoke-WebRequest https://nodejs.org/dist/v24.21.0/SHASUMS256.txt -OutFile "$mealplanRuntime/SHASUMS256.txt"
$mealplanHash = (Get-FileHash "$mealplanRuntime/node.zip" -Algorithm SHA256).Hash.ToLower()
$mealplanChecksum = Get-Content "$mealplanRuntime/SHASUMS256.txt" | Where-Object { $_ -match ' node-v24.21.0-win-x64.zip$' }
if (-not $mealplanChecksum.StartsWith($mealplanHash)) { throw 'Node checksum mismatch' }
Expand-Archive "$mealplanRuntime/node.zip" -DestinationPath $mealplanRuntime -Force
$env:PATH = "$mealplanRuntime/node-v24.21.0-win-x64;$env:PATH"
node --version
npm.cmd --version
```

В отдельном чистом каталоге нужны файлы этого каркаса, включая `package-lock.json`,
без `node_modules` и `dist`. Документы для запуска не требуются.

```powershell
npm.cmd ci
npm.cmd run dev
```

Откройте адрес Vite из терминала (обычно `http://127.0.0.1:5173`). На Linux/macOS
используйте `npm` вместо `npm.cmd`. Прямые зависимости имеют точные версии;
транзитивные закреплены lockfile. Для воспроизведения используйте `npm ci`.
Пользовательский `.gitignore` с правилом `Documents` сохранён без изменений.
В этом checkout генерируемые `node_modules/`, `dist/`, `playwright-report/`,
`test-results/` исключены локально через `.git/info/exclude`; в другом checkout
добавьте эти исключения локально или согласованно в свой `.gitignore`.

## Проверки и сборка

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:unit
npm.cmd run build
npm.cmd run preview
```

`typecheck` отдельно проверяет DOM, WebWorker, Node-конфигурации и unit-тесты.
Все контексты strict, без смешения DOM/WebWorker и автоматического подключения
Node-types в приложение. Playwright имеет отдельный smoke-контекст с Node и DOM:
его типы и функции `page.evaluate` описывают оба окружения. Сборка также вызывает
typecheck; Vite его не заменяет.

Для браузерного smoke на поддерживаемой ОС (Ubuntu 24.04 или Windows 11+):

```powershell
npx.cmd playwright install chromium firefox webkit
npm.cmd run build
npm.cmd run test:smoke
```

На Linux CI используется `npx playwright install --with-deps chromium firefox webkit`.
Тест запускает preview собранного выпуска. Проверяет экран, цвет Tailwind,
размер кнопки, отсутствие горизонтального скролла, брейкпоинты 767/768 и 1199/1200,
реальный Worker, повтор и возврат в idle после перезагрузки.

Ручной сценарий: на ширинах 360/768/1280 открыть страницу, увидеть зелёную кнопку,
нажать «Проверить Worker», дождаться «Worker готов · BigInt доступен», повторить,
обновить страницу. После обновления проверка не запускается сама. Ошибка связи
показывается текстом и разрешает повтор. Консоль не должна содержать ошибок.

CI: `.github/workflows/ci.yml`, Ubuntu 24.04, выбранный Node, `npm ci`, четыре
обязательные команды и smoke в Chromium/Firefox/WebKit. Публикации нет: S1-24.
Для размещения S1-24 задаёт `MEALPLAN_BASE` по фактическому репозиторию; сейчас
ресурсы и Worker имеют относительные URL, base `./`.

## Границы модулей и совместимость

- `src/ui/` — React и Tailwind; цвета, шрифты, отступы и радиусы в `tailwind.config.js`, брейкпоинты 768/1200.
- `src/application/` — контроллер диагностической команды и чистый reducer.
- `src/domain/` — место чистой доменной логики будущих задач.
- `src/api/` — место адаптера статического каталога, далее Firestore.
- `src/worker/` — отдельный Dedicated module Worker; будущие поиск и пересчёт.
- `src/codec/` — проверка технического handshake; предметный codec ещё впереди.
- `src/repository/` — место IndexedDB-адаптера, без фиктивного сохранения.

В Vite явно заданы JS targets `es2020`, `safari15`, CSS target `safari15`,
Worker format `es`. Worker использует общий build.target Vite и статическую
конструкцию `new Worker(new URL(..., import.meta.url), { type: 'module' })`.
Web API автоматически не полифиллятся. Каркас не требует structuredClone,
randomUUID, Web Locks, BroadcastChannel, persist или performance.timeOrigin.
Tailwind 3.4 сохранён ради Safari 15; v4 требует Safari 16.4+.

## Проверка зависимостей и ограничения

Перед установкой 13.10.2026 повторно прочитаны версии/engines/peers 17 пакетов
из официального npm registry; выбранные версии существуют и совместимы по
метаданным. Node ZIP проверен по официальному SHA-256. Lockfile создан через
`npm install --package-lock-only --ignore-scripts`, затем выполнен `npm audit`.

Audit обнаружил **7 сообщений: 5 high, 2 moderate** в сборочной цепочке Tailwind:
braces → chokidar/micromatch/fast-glob → tailwindcss и
postcss-selector-parser → postcss-nested/tailwindcss.
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) не имеет
опубликованного исправления; braces 3.0.4 и Tailwind 3.4.20 отсутствуют.
[selector-parser advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)
исправлен в 7.1.6, но Tailwind 3 и postcss-nested 6 требуют major 6.
Автоматический `audit fix --force` предлагает Tailwind 4 и нарушает Safari 15.
Непроверенные major-overrides не внесены. Сборка читает доверенные локальные
исходники; пользовательский ввод в эти парсеры не передаётся. Это ограничивает
поверхность, но не закрывает audit.

Решение лида от **14.10.2026**: S1-03 принята; риск **S1-R06 открыт** и временно
принят только для сборки доверенных исходников. Пересмотр — перед размещением
S1-24 и в любом случае не позднее **16.10.2026**; после срока требуется новое
решение. Изменение зависимостей или появление недоверенного CSS/шаблонов требует
досрочного пересмотра. Лёня готовит свежий audit и проверенный вариант исправления,
лид принимает решение о закрытии/продлении. Исключение не разрешает force fix,
непроверенные major overrides и не означает прохождение CI/Safari.

Фактические результаты прогонов и остальные непроверенные части записаны в
[отчёте S1-03](S1-03_REPORT.md). WebKit не является проверкой реального iOS Safari.
