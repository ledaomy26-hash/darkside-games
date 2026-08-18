/* Кредиты на отмену хода и реклама за вознаграждение.
   Кредиты тратятся только в партии против компьютера: вдвоём за одним
   устройством игроки договариваются сами, а в игре по сети отмена запрещена. */
(function () {
  'use strict';

  const KEY = 'darkside.checkers.credits';

  const START = 5;      // выдаётся при первом запуске
  const UNDO_COST = 1;  // сколько стоит одна отмена хода
  const AD_REWARD = 3;  // сколько даёт просмотренный ролик
  const DAILY_GIFT = 2; // подарок за первый вход в новый день

  // ---------- Хранилище ----------

  const today = () => new Date().toISOString().slice(0, 10);

  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (err) {
      saved = null; // повреждённая запись — начинаем заново, игру это ломать не должно
    }
    if (!saved || typeof saved.amount !== 'number') {
      return { amount: START, lastGift: today(), premium: false };
    }
    return {
      amount: Math.max(0, Math.floor(saved.amount)),
      lastGift: typeof saved.lastGift === 'string' ? saved.lastGift : '',
      premium: saved.premium === true
    };
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      /* приватный режим браузера — играть это не мешает */
    }
  }

  const state = load();
  const listeners = [];

  function changed() {
    save();
    listeners.forEach((fn) => {
      try { fn(state.amount); } catch (err) { /* один сломанный слушатель не должен ронять остальные */ }
    });
  }

  // ---------- Ежедневный подарок ----------

  function claimDailyGift() {
    if (state.premium) return 0;
    const day = today();
    if (state.lastGift === day) return 0;
    state.lastGift = day;
    state.amount += DAILY_GIFT;
    changed();
    return DAILY_GIFT;
  }

  // ---------- Публичное ----------

  const Credits = {
    UNDO_COST,
    AD_REWARD,
    DAILY_GIFT,

    get amount() { return state.amount; },
    get premium() { return state.premium; },

    /* Премиум снимает и рекламу, и плату за отмену хода.
       Включается покупкой «убрать рекламу», когда она появится в магазине. */
    setPremium(on) {
      state.premium = on === true;
      changed();
    },

    /* Хватает ли на отмену хода. При премиуме — всегда да. */
    canUndo() {
      return state.premium || state.amount >= UNDO_COST;
    },

    /* Списать за отмену. Возвращает false, если не хватило. */
    spendUndo() {
      if (state.premium) return true;
      if (state.amount < UNDO_COST) return false;
      state.amount -= UNDO_COST;
      changed();
      return true;
    },

    add(n) {
      const value = Math.max(0, Math.floor(n || 0));
      if (!value) return;
      state.amount += value;
      changed();
    },

    claimDailyGift,

    /* Подписка на изменения — для счётчика на экране */
    onChange(fn) {
      if (typeof fn === 'function') listeners.push(fn);
    }
  };

  // ---------- Реклама ----------

  /* Мост в нативную рекламу. Внутри приложения его подменяет плагин,
     в браузере ролика нет и показывать нечего. */
  const Ads = {
    available() {
      const bridge = window.DarkSideAdsNative;
      return !!(bridge && typeof bridge.showRewarded === 'function');
    },

    /* Показать ролик. Возвращает промис: true — досмотрел, false — закрыл раньше.
       Начисление кредитов здесь же, чтобы вызывающий код об этом не думал. */
    showRewarded() {
      if (!Ads.available()) return Promise.resolve(false);
      return Promise.resolve()
        .then(() => window.DarkSideAdsNative.showRewarded())
        .then((result) => {
          const rewarded = result === true || (result && result.rewarded === true);
          if (rewarded) Credits.add(AD_REWARD);
          return rewarded;
        })
        .catch(() => false); // сеть отвалилась или блока нет — игрок не должен видеть ошибку
    }
  };

  window.CheckersCredits = Credits;
  window.CheckersAds = Ads;
})();
