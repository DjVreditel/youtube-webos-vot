# vot-mod — Voice Over Translation для youtube-webos

Мод добавляет озвучку от Яндекса в приложение [youtube-webos](https://github.com/webosbrew/youtube-webos) для LG SmartTV (webOS).

Папка `vot-mod/` лежит в корне проекта youtube-webos и не пересекается с файлами
апстрима: все свои исходники — здесь, в дерево `../src/` они попадают только при
запуске патчера.

```
youtube-webos/         ← корень проекта (git: master = апстрим + этот каталог)
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
2. Патчит `../src/userScript.ts` — добавляет импорт полифилла и вызов `initVot()`
3. Патчит `../src/config.js` — добавляет VOT-настройки
4. Патчит `../src/player_api/manager.ts` и `yt-api.ts` — событие `noVideo` и поля аудиодорожек
5. Патчит `../src/ui.js` — красная кнопка открывает панель VOT (обрабатывается там же, где зелёная кнопка настроек; добавлены доп. коды красной кнопки: 398, 114, 166, 108 и fallback на `keyCode`)
6. Заменяет иконки/сплэш/фон в `../assets/` файлами из `vot-mod/assets/`
7. Патчит `../assets/appinfo.json` (id → `youtube.djvreditel.v4`, title → `YouTube VOT`), а также `package.json` и `tools/deploy.js` под новый app ID
8. Патчит `package.json` — переключает менеджер пакетов с pnpm на npm (апстрим жёстко требует pnpm через `devEngines`, что ломает `npm run build`)
9. `npm install` → `npm run build` → `npm run package` в корне — собирает `.ipk`

Все патчи идемпотентны (маркер `// @vot-mod`) — повторный запуск безопасен.

Другие режимы:

```bash
npm run patch           # только патч, без сборки (--patch-only)
npm run restore         # откатить патчи: git checkout + удалить скопированные файлы (--restore)
```

## Деплой на ТВ

В корне проекта:

```bash
npm run deploy && npm run launch
```

> ТВ должно быть включено, в режиме разработчика, IP прописан в настройках webOS CLI.

---

## Обновление апстрима

Репозиторий настроен по схеме vendor-branch: `master` — это история
[webosbrew/youtube-webos](https://github.com/webosbrew/youtube-webos) плюс коммит
с `vot-mod/`. Когда выходит новая версия (например `v0.5.4`):

```bash
# 1. Откатить патчи из рабочего дерева
cd vot-mod && npm run restore && cd ..

# 2. Подтянуть и влить новую версию
git fetch upstream --tags
git merge v0.5.4

# 3. Пере-применить мод и собрать
cd vot-mod && npm run package
```

Если патчер выдал `WARNING: ... pattern not found` — апстрим изменил патчуемый
файл, нужно поправить соответствующий regex/паттерн в `patch.cjs`.

> `../src/` после патча — генерируемое состояние. Всё своё редактировать только в `vot-mod/src/`.

---

## Что добавляется в конфиг

Патчер добавляет в `src/config.js` следующие настройки:

| Ключ                   | По умолчанию | Описание                                        |
| ---------------------- | ------------ | ----------------------------------------------- |
| `enableVot`            | `true`       | Автозапуск перевода при открытии видео          |
| `votFromLang`          | `auto`       | Язык оригинала                                  |
| `votToLang`            | `ru`         | Язык перевода                                   |
| `votTranslationVolume` | `0.9`        | Громкость озвучки (0–1)                         |
| `votOriginalVolume`    | `0.15`       | Громкость оригинала при активном переводе (0–1) |

---

## Управление на ТВ

| Кнопка         | Действие                      |
| -------------- | ----------------------------- |
| **RED**        | Открыть / закрыть панель VOT  |
| **ESC / Back** | Закрыть панель                |
| **↑↓←→**       | Навигация по элементам панели |
| **OK**         | Нажать кнопку                 |

---

## Структура

```
vot-mod/
├── patch.cjs                 # Патчер (--patch-only, --restore)
├── package.json
├── tsconfig.json             # TS-конфиг для typecheck в изоляции
├── assets/                   # Иконки/сплэш/фон — копируются поверх ../assets/
└── src/
    ├── config.d.ts           # Stub-тип для изолированной typecheck
    ├── player_api.d.ts       # Stub-тип для изолированной typecheck
    ├── abort-controller-polyfill.ts
    └── vot/
        ├── client.ts         # API Яндекс + Innertube
        ├── index.ts          # Точка входа
        ├── translation.ts    # Аудио движок
        ├── types.ts
        ├── ui.ts             # Панель управления + перехват RED
        └── vot.css
```
