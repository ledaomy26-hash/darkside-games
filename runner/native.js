/* Поведение внутри установленного Android-приложения (23.10.2026).
   В обычном браузере файл ничего не делает: на сайте остаются заглушка ролика
   и надпись «купить за рубли можно в приложении».

   Внутри приложения:
   - ролик за продолжение, «удвоить за ролик» и ролик раз в час — настоящая
     реклама РСЯ (плагин DarkSideAds, тот же, что у шахмат и шашек);
   - покупки за рубли — RuStore Pay (плагин DarkSidePay), window.RunnerPay;
   - кнопка «Назад»: на бегу — пауза, в разделе — назад в меню, в меню —
     выход только по второму нажатию. */

(() => {
  'use strict';

  const bridge = window.Capacitor;
  const isNative = !!(bridge && typeof bridge.isNativePlatform === 'function' && bridge.isNativePlatform());
  if (!isNative) return;

  const plugins = bridge.Plugins || {};
  const { App, StatusBar, SplashScreen } = plugins;

  /* Мост может вернуть и промис, и обычное значение — молча переживаем оба. */
  const safe = (fn) => {
    try {
      const result = fn();
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return result;
    } catch (err) {
      return null;
    }
  };

  // ---------- Реклама за вознаграждение ----------

  /* ads.js держит договор «покажи ролик — скажи, досмотрели ли». Здесь его
     show() подменяется настоящим роликом; showSeries и вся механика
     продолжения остаются прежними. */
  const Ads = plugins.DarkSideAds;
  if (Ads && typeof Ads.showRewarded === 'function' && window.RunnerAds) {
    window.RunnerAds.provider = 'yandex';
    window.RunnerAds.show = async () => {
      try {
        const r = await Ads.showRewarded();
        return !!(r && r.rewarded);
      } catch (err) {
        return false;
      }
    };
  }

  // ---------- Покупки за рубли (RuStore Pay) ----------

  /* Игра спрашивает window.RunnerPay: есть ли оплата, купить товар, какие
     товары уже куплены (восстановление после переустановки). Номера товаров —
     те же, что заведены в RuStore Консоли → «Монетизация». */
  const Pay = plugins.DarkSidePay;
  if (Pay && typeof Pay.purchase === 'function') {
    window.RunnerPay = {
      available: async () => {
        try { const r = await Pay.available(); return !!(r && r.available); } catch (err) { return false; }
      },
      buy: async (productId) => {
        try {
          const r = await Pay.purchase({ productId });
          return { ok: !!(r && r.ok), cancelled: !!(r && r.cancelled), message: (r && r.message) || '' };
        } catch (err) {
          return { ok: false, cancelled: false, message: String(err && err.message || err) };
        }
      },
      owned: async () => {
        try { const r = await Pay.owned(); return (r && r.products) || []; } catch (err) { return []; }
      }
    };
    window.dispatchEvent(new Event('runner-pay-ready'));
  }

  // ---------- Системные панели ----------

  if (StatusBar) {
    safe(() => StatusBar.setStyle({ style: 'DARK' }));
    safe(() => StatusBar.setBackgroundColor({ color: '#06070b' }));
  }

  /* Системную заставку убираем сразу: дальше свой экран загрузки с картинкой. */
  if (SplashScreen) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => safe(() => SplashScreen.hide()));
    });
  }

  // ---------- Кнопка «Назад» ----------

  const shown = (id) => {
    const node = document.getElementById(id);
    return node && !node.hidden ? node : null;
  };
  const press = (id) => {
    const node = document.getElementById(id);
    if (node) node.click();
  };

  let exitArmed = false;
  let exitTimer = 0;
  const say = (text) => {
    if (window.RunnerApp && window.RunnerApp.toast) window.RunnerApp.toast(text, 2000);
  };

  if (App) {
    safe(() => App.addListener('backButton', () => {
      if (shown('ad-overlay')) { press('ad-cancel'); return; }
      if (shown('screen-shop')) { press('shop-back'); return; }
      if (shown('screen-places')) { press('places-back'); return; }
      if (shown('screen-help')) { press('help-back'); return; }
      if (shown('screen-rewards')) { press('rewards-back'); return; }
      if (shown('screen-pause')) { press('resume-button'); return; }
      if (shown('screen-over')) { press('menu-button'); return; }
      if (shown('hud')) { press('pause-button'); return; }

      /* Главное меню: выходим только по второму нажатию. */
      if (exitArmed) {
        clearTimeout(exitTimer);
        safe(() => App.exitApp());
        return;
      }
      exitArmed = true;
      say('Нажмите «Назад» ещё раз, чтобы выйти');
      exitTimer = setTimeout(() => { exitArmed = false; }, 2000);
    }));
  }
})();
