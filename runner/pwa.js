/* Установка приложения и офлайн-режим.

   Держится отдельно от игры: если браузер чего-то из этого не умеет, бегун
   всё равно бежит — просто как обычная страница. */
(() => {
  'use strict';

  const installBtn = document.getElementById('install-button');

  const say = (text) => {
    if (window.RunnerApp && window.RunnerApp.toast) window.RunnerApp.toast(text);
  };

  /* Внутри Android-приложения файлы и так лежат на устройстве: кэш service
     worker'а там только мешал бы обновляться вместе с новой сборкой. */
  const isNativeApp = !!(window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
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

  /* На file:// service worker недоступен — игра просто работает без кэша. */
  const canUseServiceWorker = 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  if (canUseServiceWorker) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });

    /* Перезагружаемся только когда приехала НОВАЯ версия. При самой первой
       установке service worker тоже перехватывает управление — и страница
       перезагружалась прямо посреди начатого забега. */
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
  }

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIos = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });

  /* Safari на iPhone и iPad ставит приложение только вручную — подсказываем. */
  if (installBtn && isIos() && !isStandalone()) installBtn.hidden = false;

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (outcome === 'accepted') installBtn.hidden = true;
        return;
      }
      say(isIos()
        ? 'Поделиться → На экран «Домой»'
        : 'Меню браузера → «Установить приложение»');
    });
  }

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installBtn) installBtn.hidden = true;
  });

  if (isStandalone() && installBtn) installBtn.hidden = true;
})();
