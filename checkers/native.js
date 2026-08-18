/* Поведение внутри установленного Android-приложения.
   В обычном браузере файл ничего не делает. */

(() => {
  'use strict';

  const bridge = window.Capacitor;
  const isNative = !!(bridge && typeof bridge.isNativePlatform === 'function' && bridge.isNativePlatform());
  if (!isNative) return;

  const plugins = bridge.Plugins || {};
  const { App, StatusBar, SplashScreen } = plugins;

  // ---------- Реклама за вознаграждение ----------

  /* Плагин отвечает объектом { rewarded: true|false }.
     credits.js понимает оба вида ответа, здесь просто пробрасываем. */
  const Ads = plugins.DarkSideAds;
  if (Ads && typeof Ads.showRewarded === 'function') {
    window.DarkSideAdsNative = {
      showRewarded: () => Ads.showRewarded()
    };
    // Интерфейс рисуется раньше, чем сюда доходит очередь — сообщаем, что реклама есть
    window.dispatchEvent(new Event('darkside-ads-ready'));
  }


  // Мост может вернуть и промис, и обычное значение — молча переживаем оба случая
  const safe = (fn) => {
    try {
      const result = fn();
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return result;
    } catch (err) {
      return null;
    }
  };

  // ---------- Системные панели ----------

  if (StatusBar) {
    safe(() => StatusBar.setStyle({ style: 'DARK' }));
    safe(() => StatusBar.setBackgroundColor({ color: '#06070b' }));
  }

  // Заставку убираем, когда доска уже отрисована, — без мигания пустым экраном
  if (SplashScreen) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => safe(() => SplashScreen.hide()));
    });
  }

  // ---------- Кнопка «Назад» ----------

  const toast = document.createElement('div');
  toast.className = 'native-toast';
  toast.textContent = 'Нажмите «Назад» ещё раз, чтобы выйти';
  toast.hidden = true;
  document.body.appendChild(toast);

  let toastTimer = 0;
  let exitArmed = false;

  const armExit = () => {
    exitArmed = true;
    toast.hidden = false;
    // Двум кадрам нужен показ до появления класса, иначе не будет плавности
    requestAnimationFrame(() => toast.classList.add('visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      exitArmed = false;
      toast.classList.remove('visible');
      setTimeout(() => { toast.hidden = true; }, 250);
    }, 2000);
  };

  const isOpen = (id) => {
    const node = document.getElementById(id);
    return node && node.classList.contains('open') ? node : null;
  };

  if (App) {
    const pressEscape = () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    safe(() => App.addListener('backButton', () => {
      // Мастер подключения: закрывается тем же путём, что и по Escape
      if (isOpen('netOverlay')) {
        pressEscape();
        return;
      }

      const other = isOpen('installOverlay') || isOpen('endOverlay');
      if (other) {
        other.classList.remove('open');
        return;
      }

      // Начатый ход: «Назад» отменяет выбор шашки или недоигранную цепочку боя
      if (document.querySelector('.square.selected')) {
        pressEscape();
        return;
      }

      // Из главного экрана выходим только по второму нажатию —
      // иначе партия закрывается одним случайным касанием
      if (exitArmed) {
        clearTimeout(toastTimer);
        safe(() => App.exitApp());
        return;
      }
      armExit();
    }));
  }
})();
