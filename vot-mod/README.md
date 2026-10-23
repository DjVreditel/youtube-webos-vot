# vot-mod — Voice Over Translation для youtube-webos

Мод добавляет озвучку от Яндекса в приложение YouTube для LG SmartTV (webOS).
Основа — форк [foxi69/youtube-webos](https://github.com/foxi69/youtube-webos)
(построен на [NicholasBly/youtube-webos](https://github.com/NicholasBly/youtube-webos)),
в нём есть отдельная сборка для старых ТВ (webOS 3–6) и много оптимизаций.
Версия на базе [webosbrew/youtube-webos](https://github.com/webosbrew/youtube-webos)
осталась в ветке `webosbrew-upstream`.

Папка `vot-mod/` лежит в корне проекта и не пересекается с файлами апстрима:
все свои исходники — здесь, в дерево `../src/` они попадают только при запуске
патчера.

```
youtube-webos-vot/     ← корень проекта (git: main = foxi69 + этот каталог)
├── vot-mod/
│   ├── patch.cjs      # Патчер
│   └── src/           # Исходники мода
├── src/               # Апстрим (патчится генерацией, в git не коммитится)
├── package.json
└── ...
```

---

## Сборка

В папке `vot-mod/`:

```bash
npm run package         # = node patch.cjs
```

Команда выполняет последовательно:

1. Копирует файлы мода (`vot-mod/src/`) в `../src/`
2. Патчит `../src/userScript.js` — добавляет импорт полифилла и вызов `initVot()`
3. Патчит `../src/config.js` — добавляет VOT-настройки и действие пульта `vot_panel`
   («Open/Close VOT Panel»), назначает его на красную кнопку по умолчанию
4. Патчит `../src/ui.js` — обработка действия `vot_panel` в системе кнопок апстрима,
   заголовок настроек «YouTube VOT»; `../src/ui.css` — тема VOT (розовая) вместо
   оранжевой темы апстрима; логотипы `vot-mod/src/icons/` заменяют апстримные
5. Оптимизации для старых ТВ:
   - `../src/launch.js` — на Chromium < 79 (webOS ≤ 5) YouTube больше не
     принуждается к режиму полной анимации и сам включает облегчённый режим
     (`limited-memory`), как задумано для слабых устройств
   - `../src/math-letters.js` — на webOS ≤ 4 отключает лишний
     `MutationObserver` на весь `<body>`
6. Добавляет сплэш и фон VOT из `vot-mod/assets/` (иконка приложения — оригинальная иконка YouTube)
7. Патчит `../assets/appinfo.json`: title → `YouTube VOT`, vendor, версия, `allowCrossDomain`;
   в `../package.json` — версию и ссылки на этот репозиторий.
   ID остаётся оригинальным `youtube.leanback.v4` (кнопка YouTube на пульте, каст с
   телефона и голосовой поиск открывают именно его). Версия = версия из
   `vot-mod/package.json` с мажором +100 (1.1.0 → 101.1.0), как в апстриме webosbrew:
   иначе LG Content Store может «обновить» приложение официальным YouTube
8. Копирует `vot-mod/project/README.md` и `CHANGELOG.md` в корень — README репозитория
   принадлежит проекту и не теряется при слиянии апстрима (при конфликте берите любую
   сторону и перезапустите патчер)
9. `npm ci` → `npm run build` → `npm run package` в корне — собирает
   `dist/youtube.leanback.v4_<версия+100>_all.ipk` (легаси-сборка, для webOS 3+) и пишет
   `repo.json` и `vot-mod/repo.json` (манифест Homebrew Channel)

Все патчи идемпотентны (маркер `// @vot-mod`) — повторный запуск безопасен.

Другие режимы:

```bash
npm run patch           # только патч, без сборки (--patch-only)
npm run restore         # откатить патчи: git checkout + удалить скопированные файлы (--restore)
npm test                # юнит-тесты логики синхронизации звука (node --test, без ТВ)
```

Логика решений синхронизации (выбор чанка при перемотке/скипе сегментов,
гейтинг дрейф-коррекции) вынесена в чистый модуль `src/vot/sync-core.js` и
покрыта тестами `tests/sync-core.test.mjs` — прогоняйте `npm test` после
любых правок звукового движка.

Тесты foxi69 (в том числе smoke-тест бандла в эмуляции Chromium 38) — в корне:
`npm test` после `npm run patch`.

## Установка и обновления через Homebrew Channel

На ТВ с Homebrew Channel: Settings → Add repository →

```
https://raw.githubusercontent.com/DjVreditel/youtube-webos-vot/main/vot-mod/repo.json
```

или короткая ссылка `https://tinyurl.com/ytvot-tv`. После этого YouTube VOT появится
в каталоге Homebrew Channel, а новые версии будут предлагаться как обновление.
Перед установкой удалите другие YouTube-приложения: все они делят хранилище
youtube.com, и удаление любого из них стирает вход в аккаунт и настройки.

### Выпуск новой версии

1. Поднять `version` в `vot-mod/package.json` (Homebrew Channel предлагает
   обновление только при росте версии).
2. `cd vot-mod && npm run package` — собирает `dist/youtube.leanback.v4_<версия+100>_all.ipk`
   и пересчитывает `vot-mod/repo.json` (версия, ссылка на релиз, sha256).
3. Закоммитить `vot-mod/` и запушить.
4. Создать GitHub Release с тегом `v<версия>` и приложить `.ipk` из `dist/`.

## Деплой на ТВ

В корне проекта:

```bash
npm run deploy && npm run launch
```

> ТВ должно быть включено, в режиме разработчика или с root, устройство
> прописано в webOS CLI (`ares-setup-device`).

---

## Обновление апстрима

`main` — это история [foxi69/youtube-webos](https://github.com/foxi69/youtube-webos)
плюс `vot-mod/`. Когда там появляются изменения:

```bash
# 1. Откатить патчи из рабочего дерева
cd vot-mod && npm run restore && cd ..

# 2. Подтянуть и влить новую версию
git fetch foxi69
git merge foxi69/main

# 3. Пере-применить мод и собрать
cd vot-mod && npm run package
```

Конфликты слияния в файлах проекта разрешаются так:

- `README.md`, `CHANGELOG.md`, `repo.json` — взять любую сторону, патчер на шаге 3
  перезапишет их версиями проекта;
- файлы, удалённые из проекта (`repo-webos22.json`, `.github/ISSUE_TEMPLATE/`,
  `.github/release-notes.md`, `.github/dependabot.yml`, релизные workflow апстрима,
  `tools/fork-watch.py`, `tools/release-notes.sh`) — оставить удалёнными (`git rm`).

Если патчер выдал `WARNING: ... anchor not found` — апстрим изменил патчуемый
файл, нужно поправить соответствующий якорь в `patch.cjs`.

> `../src/` после патча — генерируемое состояние. Всё своё редактировать только в `vot-mod/src/`.

---

## Что добавляется в конфиг

Патчер добавляет в `src/config.js` следующие настройки:

| Ключ                   | По умолчанию | Описание                                                                                                                                     |
| ---------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `enableVot`            | `true`       | Автозапуск перевода при открытии видео                                                                                                       |
| `votFromLang`          | `auto`       | Язык оригинала                                                                                                                               |
| `votToLang`            | `ru`         | Язык перевода                                                                                                                                |
| `votTranslationVolume` | `0.9`        | Громкость озвучки (0–1)                                                                                                                      |
| `votOriginalVolume`    | `0.15`       | Громкость оригинала при активном переводе (0–1)                                                                                              |
| `votLivelyVoice`       | `false`      | «Живой голос» (только en→ru; для реальной работы нужен токен Яндекс-аккаунта — см. ниже; без токена автоматический откат на обычную озвучку) |
| `votAccountToken`      | `''`         | Токен Яндекс-аккаунта (вшивается патчером из `vot-mod/account-token.txt`)                                                                    |

Отключение анимаций, кодек, качество превью и прочие настройки производительности —
в зелёном меню foxi69 (вкладки Player / Interface).

### Живой голос: как включить по-настоящему

Сервер Яндекса отдаёт «живой голос» только авторизованным запросам
(`Authorization: OAuth <токен>`). Чтобы мод отправлял их:

1. На ПК в расширении VOT (Tampermonkey) войдите в Яндекс-аккаунт
   (Настройки → Аккаунт).
2. Там же откройте диалог токена (поле «Yandex token») и скопируйте его.
3. Сохраните токен в файл `vot-mod/account-token.txt` (одна строка).
   Файл в `.gitignore` — в git он не попадёт.
4. Пересоберите: `cd vot-mod && npm run package` — патчер вошьёт токен
   в сборку, и при включённом «Live voice» запросы пойдут авторизованными.

Без файла с токеном включённый Live voice подождёт ~1,5 минуты и
автоматически откатится на обычную озвучку.

---

## Управление на ТВ

| Кнопка         | Действие                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| **RED**        | Открыть / закрыть панель VOT (переназначается: зелёное меню → Shortcuts) |
| **ESC / Back** | Закрыть панель                                                           |
| **↑↓←→**       | Навигация по элементам панели                                            |
| **OK**         | Нажать кнопку                                                            |

---

## Структура

```
vot-mod/
├── patch.cjs                 # Патчер (--patch-only, --restore)
├── package.json
├── tsconfig.json             # TS-конфиг для typecheck в изоляции
├── assets/                   # Сплэш и фон VOT — копируются в ../assets/
└── src/
    ├── config.d.ts           # Stub-тип для изолированной typecheck
    ├── abort-controller-polyfill.ts
    └── vot/
        ├── client.ts         # API Яндекс + Innertube
        ├── index.ts          # Точка входа
        ├── player.ts         # События плеера YouTube (newVideo / noVideo)
        ├── translation.ts    # Аудио движок
        ├── types.ts
        ├── ui.ts             # Панель управления
        └── vot.css
```
