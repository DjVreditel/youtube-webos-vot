import yandexSign from './yandex-sign.png';
import menuSign from './menu-sliders.png';

/** Both mod menus live in YouTube's transport controls and share their visibility. */
export function installTranslationButton(
  openTranslation: () => void
): () => void {
  let buttons: HTMLButtonElement[] = [];
  const slots: HTMLSpanElement[] = [];
  const icons: HTMLImageElement[] = [];
  let mountedHost: Element | null = null;
  let observer: MutationObserver | null = null;
  let settingsFocus: HTMLElement | null = null;
  let settings: HTMLElement | null = null;
  const alignWithSettings = () => {
    if (!settings || !settingsFocus || !buttons.length) return;
    const nativeIcon = settings.querySelector('yt-icon') as HTMLElement | null;
    const nativeBox = settingsFocus.getBoundingClientRect();
    const iconBox = nativeIcon?.getBoundingClientRect();
    // Hidden/rebuilding controls have no geometry yet. Retry on the next mount.
    if (nativeBox.width <= 0 || nativeBox.height <= 0) return;
    const layout = window.getComputedStyle(settings);
    const glyphSize =
      iconBox && iconBox.width > 0 && iconBox.height > 0
        ? Math.min(iconBox.width, iconBox.height)
        : Math.min(nativeBox.width, nativeBox.height) * 0.5;
    // Only zero-height slots take part in YouTube's inline row. Absolute hit
    // targets cannot enlarge the pill through the HTML button's baseline.
    buttons.forEach((button, index) => {
      const slot = slots[index]!;
      slot.style.width = button.style.width = `${nativeBox.width}px`;
      slot.style.marginLeft = layout.marginLeft;
      slot.style.marginRight = layout.marginRight;
      button.style.height = `${nativeBox.height}px`;
      const image = button.firstElementChild as HTMLElement;
      image.style.width = image.style.height = `${glyphSize}px`;
      image.style.marginLeft = image.style.marginTop = `${-glyphSize / 2}px`;
    });
    // Read the reference after all widths are applied, including on remount.
    const reference =
      nativeIcon && iconBox && iconBox.height > 0
        ? nativeIcon.getBoundingClientRect()
        : settingsFocus.getBoundingClientRect();
    buttons.forEach((button) => {
      const box = button.getBoundingClientRect();
      const difference =
        reference.top + reference.height / 2 - box.top - box.height / 2;
      if (Math.abs(difference) > 0.25) {
        button.style.top = `${(parseFloat(button.style.top) || 0) + difference}px`;
      }
    });
  };
  const focusable = (element: Element | null): HTMLElement | null =>
    element &&
    ((element.querySelector(
      'ytlr-button, yt-button-container, button, [tabindex]'
    ) || element) as HTMLElement);
  const restoreNativeFocus = () => {
    if (settingsFocus && document.body.contains(settingsFocus))
      settingsFocus.focus();
  };
  const activate = (index: number) => {
    // YouTube's focus manager does not know our custom buttons. Menus must
    // remember a native control as their return target, including D-pad entry.
    restoreNativeFocus();
    if (index === 0) openTranslation();
    else
      (
        window as Window & { ytaf_showOptionsPanel?: (show: boolean) => void }
      ).ytaf_showOptionsPanel?.(true);
  };
  const onKey = (event: KeyboardEvent) => {
    if (!buttons.length || !document.body.contains(buttons[0]!)) return;
    const active = document.activeElement;
    const index = buttons.indexOf(active as HTMLButtonElement);
    let next: HTMLElement | null = null;
    if (
      event.keyCode === 37 &&
      settingsFocus &&
      (active === settingsFocus || settingsFocus.contains(active))
    ) {
      next = buttons[buttons.length - 1]!;
    } else if (index >= 0) {
      if (event.keyCode === 13) {
        event.preventDefault();
        event.stopImmediatePropagation();
        activate(index);
        return;
      }
      if ((event.keyCode === 38 || event.keyCode === 40) && settingsFocus) {
        // Forward vertical navigation from a native target. A hidden custom
        // focused button would otherwise strand YouTube's D-pad navigation.
        event.preventDefault();
        event.stopImmediatePropagation();
        restoreNativeFocus();
        const forwarded = new KeyboardEvent('keydown', {
          key: event.keyCode === 38 ? 'ArrowUp' : 'ArrowDown',
          keyCode: event.keyCode,
          bubbles: true,
          cancelable: true
        });
        Object.defineProperty(forwarded, '__ytafSynthetic', { value: true });
        settingsFocus.dispatchEvent(forwarded);
        return;
      }
      if (event.keyCode === 39) next = buttons[index + 1] || settingsFocus;
      else if (event.keyCode === 37)
        next =
          buttons[index - 1] ||
          focusable(slots[0]!.previousElementSibling) ||
          settingsFocus;
    }
    if (next) {
      event.preventDefault();
      event.stopImmediatePropagation();
      next.focus();
    }
  };
  const intact = (host: Element | null) =>
    !!host &&
    document.body.contains(host) &&
    buttons.length === 2 &&
    buttons.every(
      (button, index) =>
        host.contains(slots[index]!) &&
        button.parentNode === slots[index] &&
        icons[index]?.parentNode === button
    ) &&
    !!settings &&
    host.contains(settings) &&
    !!settingsFocus &&
    settings.contains(settingsFocus);
  const observe = () =>
    observer?.observe(document.body, { childList: true, subtree: true });
  const mount = () => {
    const controls = document.querySelector(
      'yt-focus-container[idomkey="controls"]'
    );
    const actions = document.querySelector('ytlr-player-actions-container');
    const host = actions || controls;
    if (!host || !document.body.contains(host)) return;
    if (intact(host)) {
      alignWithSettings();
      return;
    }
    // Incremental DOM drops unknown children when YouTube redraws on focus.
    // Reattach the same buttons/images in the mutation microtask, before paint,
    // instead of leaving them absent until the one-second fallback timer.
    observer?.disconnect();
    try {
      const candidates = host.querySelectorAll('[aria-label], [title]');
      settings = null;
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i]!;
        const label =
          candidate.getAttribute('aria-label') ||
          candidate.getAttribute('title') ||
          '';
        if (/^(настройки|settings)$/i.test(label.trim())) {
          settings = (candidate.closest(
            'ytlr-button-renderer, ytlr-settings-button'
          ) || candidate) as HTMLElement;
          break;
        }
      }
      settingsFocus = focusable(settings);
      if (!buttons.length) {
        buttons = ['Перевод', 'Меню VOT'].map((label, index) => {
          const slot = document.createElement('span');
          slot.className = 'ytaf-vot-control-slot';
          slots.push(slot);
          const button = document.createElement('button');
          button.type = 'button';
          button.tabIndex = 0;
          button.className = `ytaf-vot-controls-button${index ? ' ytaf-app-controls-button' : ''}`;
          button.title = label;
          button.setAttribute(
            'aria-label',
            index ? 'Настройки приложения VOT' : 'Настройки перевода'
          );
          const image = document.createElement('img');
          image.src = index ? menuSign : yandexSign;
          image.alt = '';
          image.className = 'ytaf-vot-control-logo';
          image.setAttribute('aria-hidden', 'true');
          icons.push(image);
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            activate(index);
          });
          return button;
        });
      }
      buttons.forEach((button, index) => {
        const slot = slots[index]!;
        if (icons[index]!.parentNode !== button)
          button.appendChild(icons[index]!);
        if (button.parentNode !== slot) slot.appendChild(button);
        if (settings?.parentNode && host.contains(settings))
          settings.parentNode.insertBefore(slot, settings);
        else host.appendChild(slot);
      });
      mountedHost = host;
      alignWithSettings();
    } finally {
      observe();
    }
  };
  observer = new MutationObserver(() => {
    if (!intact(mountedHost)) mount();
  });
  observe();
  mount();
  const timer = setInterval(mount, 1000);
  window.addEventListener('ytaf-page-update', mount);
  window.addEventListener('resize', alignWithSettings);
  window.addEventListener('ytaf-options-closed', restoreNativeFocus);
  window.addEventListener('keydown', onKey, true);
  return () => {
    clearInterval(timer);
    observer?.disconnect();
    window.removeEventListener('ytaf-page-update', mount);
    window.removeEventListener('resize', alignWithSettings);
    window.removeEventListener('ytaf-options-closed', restoreNativeFocus);
    window.removeEventListener('keydown', onKey, true);
    slots.forEach((slot) => slot.remove());
  };
}
