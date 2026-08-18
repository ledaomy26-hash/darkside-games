/* Установка приложения и офлайн-режим.
   Держится отдельно от игры: если что-то здесь не поддерживается браузером,
   шахматы продолжают работать как обычная страница. */

(() => {
  'use strict';

  const installBtn = document.getElementById('installApp');
  const overlay = document.getElementById('installOverlay');
  const overlayText = document.getElementById('installText');
  const overlayClose = document.getElementById('installClose');

  // ---------- Нативное приложение ----------

  // Внутри Android-приложения файлы игры и так лежат на устройстве: кэш
  // service worker'а здесь только мешал бы обновлению вместе с новой версией
  const isNativeApp = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform());

  if (isNativeApp) {
    if (installBtn) installBtn.hidden = true;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((list) => list.forEach((reg) => reg.unregister()))
        .catch(() => {});
    }
    return;
  }

  // ---------- Service worker ----------

  // На file:// service worker недоступен — игра просто работает без офлайн-кэша
  const canUseServiceWorker = 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  if (canUseServiceWorker) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });

    // Новая версия игры приехала — подхватываем её при следующем открытии
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  // ---------- Кнопка «Установить» ----------

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIos = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPad с iPadOS 13+ представляется как Mac, отличаем по тачскрину
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const showOverlay = (text) => {
    if (!overlay || !overlayText) return;
    overlayText.textContent = text;
    overlay.classList.add('open');
  };

  if (overlayClose && overlay) {
    overlayClose.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.classList.remove('open');
    });
  }

  let deferredPrompt = null;

  // Chrome, Edge, Android: браузер сам сообщает, что установка возможна
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });

  // Safari на iPhone и iPad ставит приложение только вручную — подсказываем как
  if (installBtn && isIos() && !isStandalone()) {
    installBtn.hidden = false;
  }

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (outcome === 'accepted') installBtn.hidden = true;
        return;
      }

      showOverlay(isIos()
        ? 'Нажмите «Поделиться» внизу экрана, затем «На экран „Домой“» — игра появится отдельной иконкой и будет открываться без интернета.'
        : 'Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».');
    });
  }

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installBtn) installBtn.hidden = true;
  });

  if (isStandalone() && installBtn) installBtn.hidden = true;
})();
