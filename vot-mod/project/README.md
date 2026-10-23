<p align="center">
  <img src="vot-mod/project/images/logo.png" alt="YouTube VOT" width="120">
</p>

<h1 align="center">YouTube VOT для LG webOS</h1>

<p align="center">
  YouTube без рекламы с закадровым переводом видео (Voice Over Translation) для телевизоров LG.
</p>

---

## Что умеет

- **Закадровый перевод (VOT).** Озвучка от Яндекса поверх оригинала: автоматически
  или по кнопке, выбор языков, отдельная громкость перевода и оригинала,
  «живой голос» (en→ru) после входа в Яндекс-аккаунт по QR-коду.
- **Без рекламы.** Реклама в видео, баннеры, промо-плитки и оверлеи с QR-кодами.
- **SponsorBlock.** Пропуск спонсорских вставок, интро, концовок и других сегментов.
- **Кнопки пульта.** Цветные кнопки и цифры назначаются на любые действия.
- **Быстрее на старых ТВ.** Отдельная сборка для webOS 3–6; на webOS 5 и старше
  YouTube работает в своём облегчённом режиме, лишние фоновые процессы отключены.
- **Как настоящий YouTube.** ID приложения — `youtube.leanback.v4`: кнопка YouTube на
  пульте, трансляция с телефона и голосовой поиск открывают именно его.

## Установка

Нужен ТВ LG с webOS 3 или новее и [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel).

> Перед установкой удалите другие YouTube-приложения (официальное или модификации).
> Все они хранят данные youtube.com в одном месте, и удаление любого из них стирает
> вход в аккаунт и настройки у остальных.

**Через Homebrew Channel (с обновлениями по воздуху):** Settings → Add repository →

```
https://tinyurl.com/ytvot-tv
```

или полная ссылка:

```
https://raw.githubusercontent.com/DjVreditel/youtube-webos-vot/main/repo.json
```

Приложение появится в каталоге Homebrew Channel, новые версии придут как обновление.

**Вручную:** скачайте `.ipk` со страницы [Releases](https://github.com/DjVreditel/youtube-webos-vot/releases)
и установите через [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) или
`ares-install youtube.leanback.v4_<версия>_all.ipk`.

## Управление

| Кнопка   | Действие                                  |
| -------- | ----------------------------------------- |
| 🟥 Красная | Панель перевода VOT                        |
| 🟩 Зелёная | Настройки приложения                       |
| 🟦 Синяя   | SponsorBlock: пропуск / переход к хайлайту |

Все кнопки переназначаются: Настройки → Shortcuts.

## Сборка из исходников

```bash
git clone https://github.com/DjVreditel/youtube-webos-vot.git
cd youtube-webos-vot/vot-mod
npm run package        # готовый .ipk появится в dist/
```

Подробности о сборке, патчере и выпуске версий — в [vot-mod/README.md](vot-mod/README.md).

## Лицензия

GPL-3.0. Основано на открытых проектах youtube-webos (webosbrew и его форки).
