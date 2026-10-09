/* Связка «Бегуна Dark Side»: экраны, управление, лавка, ход времени.

   Движок считает, отрисовщик рисует, а этот файл сводит их вместе: слушает
   пальцы и клавиши, ведёт кошелёк, показывает панели.

   Сохранение — один ключ в хранилище браузера. Ничего никуда не отправляется:
   рекорд, монеты и покупки остаются на устройстве. */
import { Renderer } from './render3d.js';

(function () {
  'use strict';

  const Engine = window.RunnerEngine;
  const Shop = window.RunnerShop;
  const Places = window.RunnerPlaces;

  /* Тестовая ссылка владельца (30.09.2026): «…/runner/?тест». Его слова:
     «ты для меня делай так, чтобы я мог всё пробовать — любой костюм надеть,
     ничего не покупая; для меня отдельная ссылка, а эту оставляй как была».
     По ней открыто всё: трассы, наряды, снаряжение до предела, монет и
     кристаллов с запасом — и запись своя, обычная игра её не видит. */
  const ТЕСТ = (() => {
    try {
      const q = new URLSearchParams(location.search);
      return q.has('тест') || q.has('test');
    } catch (e) { return false; }
  })();

  const STORE_KEY = ТЕСТ ? 'darkside-runner-тест' : 'darkside-runner';

  const el = id => document.getElementById(id);

  const dom = {
    canvas: el('scene'),
    hud: el('hud'),
    distance: el('hud-distance'),
    coins: el('hud-coins'),
    gems: el('hud-gems'),
    lives: el('hud-lives'),
    chaseName: el('chase-name'),
    powers: el('powers'),
    toast: el('toast'),

    menu: el('screen-menu'),
    shop: el('screen-shop'),
    help: el('screen-help'),
    pause: el('screen-pause'),
    over: el('screen-over'),

    bestDistance: el('best-distance'),
    menuCoins: el('menu-coins'),
    menuGems: el('menu-gems'),
    shopCoins: el('shop-coins'),
    shopGems: el('shop-gems'),
    shopSkins: el('shop-skins'),
    shopUpgrades: el('shop-upgrades'),
    places: el('screen-places'),
    placesCoins: el('places-coins'),
    placesGems: el('places-gems'),
    placesTotal: el('places-total'),
    placesList: el('places-list'),

    rewards: el('screen-rewards'),
    rewardsList: el('rewards-list'),
    rewardsCoins: el('rewards-coins'),
    rewardsGems: el('rewards-gems'),
    rewardsBadge: el('rewards-badge'),
    shopItems: el('shop-items'),
    shopLooks: el('shop-looks'),
    hudItems: el('hud-items'),
    doubleButton: el('double-button'),

    overTitle: el('over-title'),
    overText: el('over-text'),
    overDistance: el('over-distance'),
    overCoins: el('over-coins'),
    overBest: el('over-best'),
    installButton: el('install-button'),
    continueButton: el('continue-button'),
    continueLabel: el('continue-label')
  };

  const sound = new window.RunnerSound.Sound();
  const renderer = new Renderer(dom.canvas);

  let save = load();

  /* Звук и музыка — по записи; выключатели в меню и на паузе. Музыка
     включается с первым касанием: раньше браузер звук не пускает. */
  sound.setEnabled(save.sound !== false);
  sound.место = Places.текущее(save, ТЕСТ).id;   // у трассы своя музыка и звуки (09.10.2026)
  sound.музыкаВкл = save.music !== false;
  for (const событие of ['pointerdown', 'keydown']) {
    document.addEventListener(событие, () => sound.играть(), { passive: true });
  }
  let world = null;
  let running = false;
  let paused = false;
  let lastFrame = 0;
  let toastTimer = 0;

  /* Сколько раз забег уже продолжали за ролик и что за него уже начислено.
     Без второго счётчика монеты за один и тот же участок пути шли бы в кошелёк
     заново после каждого продолжения. */
  let continues = 0;
  let paid = { reward: 0, gems: 0 };
  let caughtWorld = null;              // пойманный забег — стоит под экраном итога

  /* ---------- Хранилище ---------- */

  function load() {
    const base = {
      best: 0, coins: 0, gems: 0,
      skin: 'runner', owned: ['runner'],
      levels: { magnet: 0, shield: 0, dash: 0, wings: 0 },
      charm: false, sound: true, music: true, тема: 1, runs: 0,
      /* Местности (23.09.2026): `всего` — метры за все забеги вместе, по ним
         открываются новые трассы; `места` — купленные; `место` — выбранная. */
      всего: 0, место: 'кладбище', места: [],
      /* Вещи в духе Subway Surfers (09.10.2026): расходники штуками, покупки
         навсегда, сундуки, косметика, дар дня, задания, ролик раз в час. */
      вещи: { крышка: 0, фора: 0 }, куплено: [], сундуков: 0,
      красота: {}, красотаКуплено: [],
      дарДень: null, дарПодряд: 0, задания: null, роликМеню: 0
    };
    let запись = base;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        запись = Object.assign(base, data, {
          levels: Object.assign(base.levels, data.levels || {}),
          owned: Array.isArray(data.owned) && data.owned.length ? data.owned : base.owned,
          места: Array.isArray(data.места) ? data.места : base.места,
          вещи: Object.assign(base.вещи, data.вещи || {}),
          куплено: Array.isArray(data.куплено) ? data.куплено : base.куплено,
          красота: Object.assign({}, data.красота || {}),
          красотаКуплено: Array.isArray(data.красотаКуплено) ? data.красотаКуплено : base.красотаКуплено
        });
      }
    } catch (e) {
      запись = base;                    // испорченная запись не должна ломать игру
    }
    return ТЕСТ ? открытьВсё(запись) : запись;
  }

  /* Тестовый режим: всё куплено и прокачано, кошелёк полон. Выбор наряда
     и трассы при этом свой — его и надо пробовать. */
  function открытьВсё(запись) {
    запись.owned = Shop.SKINS.map(s => s.id);
    for (const up of Shop.UPGRADES) запись.levels[up.id] = up.max;
    запись.charm = true;
    запись.места = Places.МЕСТА.filter(м => м.цена).map(м => м.id);   // и «скоро» — посмотреть
    запись.вещи = { крышка: Math.max(запись.вещи.крышка || 0, 99), фора: Math.max(запись.вещи.фора || 0, 99) };
    запись.куплено = Shop.ВЕЩИ.filter(в => в.вид === 'навсегда').map(в => в.id);
    запись.красотаКуплено = Object.entries(Shop.КРАСОТА).flatMap(([ряд, список]) => список.map(к => ряд + ':' + к.id));
    запись.сундуков = Math.max(запись.сундуков || 0, 9);
    запись.coins = Math.max(запись.coins || 0, 999999);
    запись.gems = Math.max(запись.gems || 0, 99999);
    return запись;
  }

  function store() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* приватный режим */ }
  }

  /* ---------- Мелочи интерфейса ---------- */

  function toast(text, мс) {
    dom.toast.textContent = text;
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { dom.toast.hidden = true; }, мс || 1800);
  }

  function showScreen(which) {
    if (which !== 'over') {
      caughtWorld = null;
      document.body.classList.remove('bitten');
    }
    for (const key of ['menu', 'shop', 'places', 'help', 'pause', 'over', 'rewards']) {
      dom[key].hidden = key !== which;
    }
    dom.hud.hidden = which !== null;
    if (which === 'menu') refreshMenu();
  }

  function refreshMenu() {
    dom.bestDistance.textContent = save.best;
    dom.menuCoins.textContent = save.coins;
    dom.menuGems.textContent = save.gems;
    обновитьЗнак();
  }

  /* ---------- Вещи, награды, задания (09.10.2026) ---------- */

  const есть = id => (save.куплено || []).includes(id);

  /* Цвета косметики — в мир, его читает отрисовка. */
  function красотаМира() {
    const цвет = ряд => Shop.красота(save, ряд).цвет || null;
    return { след: цвет('след'), крылья: цвет('крылья'), свечение: цвет('свечение') };
  }

  /* Задания дня: новый день — новые три задания и пустой счёт. */
  function заданияСегодня() {
    const день = Shop.номерДня();
    if (!save.задания || save.задания.день !== день) {
      save.задания = { день, счёт: {}, сделано: [false, false, false], сундук: false };
      store();
    }
    return { день, список: Shop.заданияДня(день), з: save.задания };
  }

  /* Прибавить к счёту задания. «за забег» — лучший забег за день, «за день» — сумма. */
  function засчитать(id, n, заЗабег) {
    const { список, з } = заданияСегодня();
    if (заЗабег) з.счёт[id] = Math.max(з.счёт[id] || 0, n);
    else з.счёт[id] = (з.счёт[id] || 0) + n;
    список.forEach((зад, i) => {
      if (з.сделано[i] || зад.id !== id || (з.счёт[id] || 0) < зад.нужно) return;
      з.сделано[i] = true;
      save.coins += зад.награда.coins;
      save.gems += зад.награда.gems;
      toast(`Задание выполнено: +${число(зад.награда.coins)} монет, +${зад.награда.gems} кр.`, 2600);
      sound.gem();
    });
    if (!з.сундук && з.сделано.every(Boolean)) {
      з.сундук = true;
      save.сундуков = (save.сундуков || 0) + 1;
      toast('Все три задания — сундук из склепа твой!', 3000);
    }
  }

  /* Красная точка на «Наградах»: дар не забран, сундук не открыт, ролик готов. */
  function обновитьЗнак() {
    if (!dom.rewardsBadge) return;
    const дар = Shop.дарДня(save, Shop.номерДня());
    const ролик = Date.now() - (save.роликМеню || 0) >= ЧАС;
    dom.rewardsBadge.hidden = !(дар || (save.сундуков || 0) > 0 || ролик);
  }

  const ЧАС = 3600 * 1000;
  const РОЛИК_МЕНЮ = 200;

  function открытьСундук() {
    if ((save.сундуков || 0) <= 0) return;
    save.сундуков--;
    const приз = Shop.открытьСундук(Math.random);
    Shop.выдать(save, приз);
    store();
    if (приз.клад) sound.fanfare(); else sound.buy();
    toast(`${приз.клад ? 'Клад! ' : 'В сундуке: '}${Shop.подписьПриза(приз)}`, 3000);
  }

  function карточка(иконка, имя, о, класс) {
    const card = document.createElement('div');
    card.className = 'card' + (класс ? ' ' + класс : '');
    card.innerHTML = `${иконка}
      <div class="card-body"><div class="card-name">${имя}</div><div class="card-about">${о}</div></div>
      <div class="card-side"></div>`;
    return card;
  }

  function кнопка(текст, по, выкл) {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.type = 'button';
    btn.textContent = текст;
    btn.disabled = !!выкл;
    btn.addEventListener('click', по);
    return btn;
  }

  /* Значки сняты с самих вещей игры (render3d.js значокВещи, ЗНАЧКИ=1). */
  const значокВещи = id => `<img class="card-icon" src="${картинкаЛавки('лавка-вещь-' + id)}" alt="">`;

  function renderRewards() {
    dom.rewardsCoins.textContent = число(save.coins);
    dom.rewardsGems.textContent = число(save.gems);
    const список = dom.rewardsList;
    список.innerHTML = '';

    /* Дар дня. */
    const день = Shop.номерДня();
    const дар = Shop.дарДня(save, день);
    const подряд = дар ? дар.подряд : save.дарПодряд || 1;
    const приз = дар ? дар.приз : Shop.ДАРЫ[(save.дарПодряд || 1) % Shop.ДАРЫ.length];
    const кДар = карточка('<div class="swatch" style="background:radial-gradient(circle,#fbbf24,#7c2d12)"></div>',
      `Дар дня — ${подряд}-й день подряд`,
      дар ? `Сегодня: ${Shop.подписьПриза(приз)}. Седьмой день — сундук.` : `Забран. Завтра: ${Shop.подписьПриза(приз)}.`,
      дар ? '' : 'card-owned');
    кДар.querySelector('.card-side').appendChild(дар
      ? кнопка('Забрать', () => {
        Shop.выдать(save, дар.приз);
        save.дарДень = день;
        save.дарПодряд = дар.подряд;
        store(); sound.buy();
        toast(`Дар дня: ${Shop.подписьПриза(дар.приз)}`, 2600);
        renderRewards(); обновитьЗнак();
      })
      : Object.assign(document.createElement('span'), { className: 'pill pill-quiet', textContent: 'Завтра' }));
    список.appendChild(кДар);

    /* Задания. */
    const заг = document.createElement('div');
    заг.className = 'row-title';
    заг.textContent = 'Задания на сегодня — за все три сундук';
    список.appendChild(заг);
    const { список: задания, з } = заданияСегодня();
    задания.forEach((зад, i) => {
      const n = Math.min(зад.нужно, з.счёт[зад.id] || 0);
      const к = карточка('<div class="swatch" style="background:linear-gradient(135deg,#8b5cf6,#22d3ee)"></div>',
        зад.текст,
        `${число(n)} из ${число(зад.нужно)} · награда ${число(зад.награда.coins)} монет и ${зад.награда.gems} кр.` +
        `<div class="progress"><i style="width:${Math.round(n / зад.нужно * 100)}%"></i></div>`,
        з.сделано[i] ? 'card-owned' : '');
      к.querySelector('.card-side').appendChild(Object.assign(document.createElement('span'),
        { className: 'pill pill-quiet', textContent: з.сделано[i] ? 'Готово' : 'В деле' }));
      список.appendChild(к);
    });

    /* Ролик раз в час. */
    const осталось = ЧАС - (Date.now() - (save.роликМеню || 0));
    const кРолик = карточка('<div class="swatch" style="background:radial-gradient(circle,#f43f5e,#3b0712)"></div>',
      `Ролик — ${РОЛИК_МЕНЮ} монет`,
      осталось > 0 ? `Следующий через ${Math.ceil(осталось / 60000)} мин.` : 'Раз в час: посмотри ролик и забери монеты.');
    кРолик.querySelector('.card-side').appendChild(кнопка('Смотреть', async () => {
      if (Date.now() - (save.роликМеню || 0) < ЧАС) return;
      const ok = window.RunnerAds && await window.RunnerAds.show(1, 1);
      if (!ok) { toast('Ролик не досмотрен'); return; }
      save.роликМеню = Date.now();
      save.coins += РОЛИК_МЕНЮ;
      store(); sound.buy();
      toast(`+${РОЛИК_МЕНЮ} монет`);
      renderRewards(); обновитьЗнак();
    }, осталось > 0));
    список.appendChild(кРолик);

    /* Сундуки. */
    const n = save.сундуков || 0;
    const кСундук = карточка(значокВещи('сундук'), 'Сундуки из склепа',
      n ? `У тебя ${n} ${Shop.plural(n, 'сундук', 'сундука', 'сундуков')}.` : 'Сундуки дают задания, дар седьмого дня и лавка.');
    кСундук.querySelector('.card-side').appendChild(кнопка('Открыть', () => {
      открытьСундук(); renderRewards(); обновитьЗнак();
    }, !n));
    список.appendChild(кСундук);
  }

  /* Кнопки вещей на бегу: перерисовываются, только когда набор сменился. */
  let фораЗабега = false;
  function обновитьКнопкиВещей() {
    if (!world) return;
    const крышек = save.вещи.крышка || 0, фор = save.вещи.фора || 0;
    const можноКрышку = крышек > 0 && world.powers.крышка <= 0 && !world.over;
    const можноФору = фор > 0 && !фораЗабега && world.z < 120 && !world.over;
    const ключ = `${можноКрышку ? крышек : 0}|${можноФору ? фор : 0}`;
    if (dom.hudItems.dataset.key === ключ) return;
    dom.hudItems.dataset.key = ключ;
    dom.hudItems.innerHTML = '';
    if (можноФору) {
      const b = Object.assign(document.createElement('button'), { className: 'item-button item-button-фора', type: 'button' });
      b.innerHTML = `<img src="${картинкаЛавки('лавка-вещь-фора')}" alt="">Фора ×${фор}`;
      b.addEventListener('click', () => {
        if (фораЗабега || !world.включить('фора')) return;
        фораЗабега = true;
        save.вещи.фора--; store();
        toast('На катафалке!');
      });
      dom.hudItems.appendChild(b);
    }
    if (можноКрышку) {
      const b = Object.assign(document.createElement('button'), { className: 'item-button', type: 'button' });
      b.innerHTML = `<img src="${картинкаЛавки('лавка-вещь-крышка')}" alt="">Крышка ×${крышек}`;
      b.addEventListener('click', () => {
        if (!world.включить('крышка')) return;
        save.вещи.крышка--; store();
        засчитать('бонусы', 0);
      });
      dom.hudItems.appendChild(b);
    }
  }

  /* Лавка: вещи. */
  function renderItems() {
    dom.shopItems.innerHTML = '';
    for (const в of Shop.ВЕЩИ) {
      const навсегда = в.вид === 'навсегда';
      const куплено = навсегда && есть(в.id);
      const штук = в.вид === 'расход' ? (save.вещи[в.id] || 0) : в.id === 'сундук' ? (save.сундуков || 0) : 0;
      const к = карточка(значокВещи(в.id), в.name,
        в.about + (в.вид !== 'навсегда' ? `<div class="card-count">У тебя: ${штук}</div>` : ''),
        куплено ? 'card-owned' : '');
      const side = к.querySelector('.card-side');
      if (куплено) {
        side.innerHTML = '<span class="pill pill-quiet">Куплено</span>';
      } else {
        side.appendChild(ценник(в.cost));
        side.appendChild(кнопка('Купить', () => {
          const now = Shop.canAfford(save, в.cost);
          if (!now.ok) { sound.deny(); toast(now.reason); return; }
          Shop.pay(save, в.cost);
          if (навсегда) save.куплено.push(в.id);
          else if (в.id === 'сундук') { save.сундуков = (save.сундуков || 0) + 1; }
          else save.вещи[в.id] = (save.вещи[в.id] || 0) + 1;
          store(); sound.buy();
          if (в.id === 'сундук') открытьСундук();
          else toast(навсегда ? `${в.name} — твоё навсегда` : `${в.name}: теперь ${save.вещи[в.id]}`);
          renderShop();
        }, !Shop.canAfford(save, в.cost).ok));
        if (в.рубли) {
          const р = кнопка(`${число(в.рубли)} ₽`, () => { sound.deny(); toast('Купить за рубли можно будет в приложении'); });
          р.className = 'pill pill-quiet';
          side.appendChild(р);
        }
      }
      dom.shopItems.appendChild(к);
    }
  }

  /* Лавка: красота — след, крылья, свечение. */
  function renderLooks() {
    dom.shopLooks.innerHTML = '';
    const ряды = { след: 'След за бегуном', крылья: 'Крылья', свечение: 'Свечение' };
    for (const [ряд, заголовок] of Object.entries(ряды)) {
      const заг = document.createElement('div');
      заг.className = 'row-title';
      заг.textContent = заголовок;
      dom.shopLooks.appendChild(заг);
      const надето = Shop.красота(save, ряд).id;
      for (const к of Shop.КРАСОТА[ряд]) {
        const ключ = ряд + ':' + к.id;
        const своё = !к.cost.coins || (save.красотаКуплено || []).includes(ключ);
        const hex = к.цвет ? '#' + к.цвет.toString(16).padStart(6, '0') : null;
        const кар = карточка(`<div class="swatch" style="${hex ? `background:radial-gradient(circle,${hex},#0b0d14 72%);box-shadow:0 0 16px ${hex}55` : ''}"></div>`,
          к.name, hex ? 'Цвет виден на бегу.' : 'Как было.', надето === к.id ? 'card-active' : своё ? 'card-owned' : '');
        const side = кар.querySelector('.card-side');
        if (надето === к.id) side.innerHTML = '<span class="pill pill-quiet">Надето</span>';
        else if (своё) side.appendChild(кнопка('Надеть', () => {
          save.красота[ряд] = к.id; store(); sound.buy(); renderLooks();
        }));
        else {
          side.appendChild(ценник(к.cost));
          side.appendChild(кнопка('Купить', () => {
            const now = Shop.canAfford(save, к.cost);
            if (!now.ok) { sound.deny(); toast(now.reason); return; }
            Shop.pay(save, к.cost);
            save.красотаКуплено.push(ключ);
            save.красота[ряд] = к.id;
            store(); sound.buy();
            toast(`${к.name} — надето`);
            renderShop();
          }, !Shop.canAfford(save, к.cost).ok));
        }
        dom.shopLooks.appendChild(кар);
      }
    }
  }

  /* ---------- Забег ---------- */

  function startRun() {
    world = new Engine.World({
      seed: (Math.random() * 1e9) | 0,
      levels: save.levels,
      startShield: save.charm,
      место: Places.текущее(save, ТЕСТ).id,    // по какой трассе бежим: от неё и нечисть
      удвоитель: есть('удвоитель'),
      мышь: есть('мышь')
    });
    world.skin = Shop.skinById(save.skin);
    world.красота = красотаМира();
    world.мышьРядом = есть('мышь');
    фораЗабега = false;
    удвоеноЗаРолик = false;
    dom.hudItems.dataset.key = '';
    continues = 0;
    paid = { reward: 0, gems: 0, distance: 0 };
    running = true;
    paused = false;
    lastFrame = 0;
    showScreen(null);
    /* Первые забеги — с подсказкой по управлению: владелец сыграл с телефона
       и сказал, что не понимает, как прыгать (20.09.2026). Дальше подсказка
       не мешается: она показывается только первые три забега. */
    if (save.runs < 3) toast('Свайп вверх или касание — прыжок · вниз — подкат · вбок — дорожка', 5000);
    sound.wake();
    requestAnimationFrame(loop);
  }

  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (paused) { lastFrame = now; return; }

    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;

    const events = world.update(dt);
    handleEvents(events);
    renderer.draw(world, now / 1000, dt);
    updateHud();
    обновитьКнопкиВещей();
  }

  function handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'jump': sound.jump(); засчитать('прыжки', 1); break;
        case 'land': sound.land(); break;
        case 'slide': sound.slide(); засчитать('подкаты', 1); break;
        case 'coin': sound.coin(); break;
        case 'gem': sound.gem(); засчитать('кристаллы', 1); break;
        case 'power': sound.power(); if (e.kind !== 'крышка' && e.kind !== 'фора') засчитать('бонусы', 1); break;
        case 'board-break': sound.shieldBreak(); renderer.tremble(0.4); toast('Крышка гроба приняла удар'); break;
        case 'power-out': sound.powerOut(); break;
        case 'smash': sound.smash(); renderer.tremble(0.3); if (e.kind === 'zombie') засчитать('снести', 1); break;
        case 'shield-break': sound.shieldBreak(); renderer.tremble(0.4); break;
        case 'hit':
          e.kind === 'pit' ? sound.splash() : sound.hit();
          renderer.tremble(0.9);
          /* Счёт ошибок говорится вслух: черепа гаснут наверху, но в этот миг
             игрок смотрит на бегуна, а не на показания. */
          if (e.lives > 0) {
            toast(e.lives === 1
              ? 'Последняя ошибка!'
              : `Ещё ${e.lives} ${Shop.plural(e.lives, 'ошибка', 'ошибки', 'ошибок')}`);
          }
          break;
        case 'stand': sound.land(); break;
        case 'doomed':
          sound.smash();                 // рык за спиной; «поймали» прозвучит на экране итога
          /* Крик — когда клыки входят в шею: Дракула хватает бегуна
             с 0,5 до 1,2 с сцены укуса (render3d.js, камераУкуса). */
          sound.scream(0.75);
          renderer.tremble(1);
          toast('Он тебя достал');
          document.body.classList.add('bitten');   // края кадра наливаются кровью
          break;
        case 'over': finishRun(e); break;
      }
    }
  }

  function updateHud() {
    dom.distance.textContent = world.distance;
    dom.coins.textContent = world.coins;
    dom.gems.textContent = world.gems;
    dom.chaseName.textContent = world.hunter.name;

    /* Черепа перерисовываются только при потере: разметка HUD не должна
       пересобираться каждый кадр. */
    if (dom.lives.dataset.left !== String(world.lives)) {
      dom.lives.dataset.left = world.lives;
      dom.lives.innerHTML = Array.from({ length: Engine.LIVES }, (_, i) =>
        `<i class="${i < world.lives ? '' : 'spent'}"></i>`).join('');
    }

    /* Значки действующих находок. Перерисовываем только когда набор сменился —
       иначе браузер каждый кадр пересобирает разметку. */
    const names = { magnet: 'Магнит', shield: 'Щит', dash: 'Рывок', wings: 'Крылья', крышка: 'Крышка', фора: 'Катафалк' };
    const active = Object.keys(world.powers).filter(k => world.powers[k] > 0);
    const key = active.join(',');
    if (key !== dom.powers.dataset.key) {
      dom.powers.dataset.key = key;
      dom.powers.innerHTML = active
        .map(k => `<span class="power-chip power-${k}"><i></i>${names[k]}</span>`)
        .join('');
    }
  }

  /* Сколько роликов стоит следующее продолжение: первый раз один, второй два,
     дальше по три. */
  function adsForContinue() {
    return Math.min(3, continues + 1);
  }

  function finishRun(e) {
    running = false;
    save.runs++;
    /* Экран итога ложится поверх застывшей сцены укуса, как в Subway Surfers
       контролёр держит пойманного за спиной окна «Продолжить?». Без этого за
       экраном сразу шёл показательный забег, и укуса никто не видел. */
    caughtWorld = e.reason === 'quit' ? null : world;

    /* В кошелёк идёт только то, что не зачли при прошлом продолжении. */
    const reward = world.reward - paid.reward;
    const gems = world.gems - paid.gems;
    save.coins += reward;
    save.gems += gems;
    paid = { reward: world.reward, gems: world.gems };

    const best = e.distance > save.best;
    if (best) save.best = e.distance;

    /* Задания: метры и монеты — за этот забег, забеги — за день. */
    засчитать('метры', e.distance, true);
    засчитать('монеты', world.coins, true);
    if (!continues) засчитать('забеги', 1);

    /* Метры идут в общий счёт — он показан на экране трасс. Трассы по нему
       больше не открываются (29.09.2026), только покупаются. Считаем только
       то, что не зачли при прошлом продолжении этого же забега. */
    save.всего = (save.всего || 0) + Math.max(0, e.distance - (paid.distance || 0));
    paid.distance = e.distance;
    store();

    const quit = e.reason === 'quit';
    dom.overTitle.textContent = quit ? 'Забег окончен' : 'Тебя догнали';
    dom.overText.textContent = quit
      ? 'Ты остановился сам — собранное осталось при тебе.'
      : `${world.hunter.name} оказался быстрее.`;
    dom.overDistance.textContent = e.distance;
    dom.overCoins.textContent = world.reward;
    dom.overBest.hidden = !best;

    /* Продолжить можно только после погони: если бегун остановился сам,
       возвращать его на трассу не за что. */
    const canContinue = !quit && window.RunnerAds && window.RunnerAds.available();
    dom.continueButton.hidden = !canContinue;
    if (canContinue) {
      const count = adsForContinue();
      dom.continueLabel.textContent = count === 1
        ? 'Продолжить за ролик'
        : `Продолжить за ${count} ${Shop.plural(count, 'ролик', 'ролика', 'роликов')}`;
    }

    /* Удвоить монеты забега за ролик — раз за забег, если есть что удваивать. */
    dom.doubleButton.hidden = удвоеноЗаРолик || world.reward <= 0 || !(window.RunnerAds && window.RunnerAds.available());
    dom.doubleButton.textContent = `Удвоить монеты за ролик (+${число(world.reward)})`;
    dom.hudItems.innerHTML = '';
    dom.hudItems.dataset.key = '';

    if (best) sound.fanfare(); else sound.caught();
    showScreen('over');
  }

  let удвоеноЗаРолик = false;
  async function удвоитьЗаРолик() {
    if (!world || удвоеноЗаРолик) return;
    dom.doubleButton.disabled = true;
    const ok = await window.RunnerAds.show(1, 1);
    dom.doubleButton.disabled = false;
    if (!ok) { toast('Ролик не досмотрен'); return; }
    удвоеноЗаРолик = true;
    save.coins += world.reward;
    store(); sound.buy();
    toast(`+${число(world.reward)} монет`);
    dom.doubleButton.hidden = true;
  }

  /* Продолжение: ролики, потом бегун поднимается там же, где его догнали. */
  async function continueRun() {
    if (!world || !world.over) return;
    const count = adsForContinue();
    dom.continueButton.disabled = true;
    const watched = await window.RunnerAds.showSeries(count);
    dom.continueButton.disabled = false;
    if (!watched) {
      toast('Продолжения не будет: ролик не досмотрен');
      return;
    }
    continues++;
    world.revive();
    running = true;
    paused = false;
    lastFrame = 0;
    showScreen(null);
    sound.power();
    requestAnimationFrame(loop);
  }

  function pauseRun(on) {
    if (!running) return;
    paused = on;
    dom.pause.hidden = !on;
    dom.hud.hidden = on;
  }

  /* ---------- Управление ----------

     Клавиши для компьютера, свайпы для телефона. Свайп засчитывается по первому
     же движению за порог, а не по отпусканию пальца: иначе игра ощущается вязкой. */

  window.addEventListener('keydown', event => {
    if (event.repeat) return;
    const map = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
      ArrowDown: 'slide', KeyS: 'slide'
    };
    if (event.code === 'Escape') {
      if (running) pauseRun(!paused);
      return;
    }
    const action = map[event.code];
    if (!action) return;
    event.preventDefault();
    if (running && !paused) world.input(action);
  });

  let touch = null;
  const SWIPE = 26;

  dom.canvas.addEventListener('touchstart', event => {
    const t = event.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY, used: false };
  }, { passive: true });

  dom.canvas.addEventListener('touchmove', event => {
    if (!touch || touch.used || !running || paused) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) return;
    touch.used = true;
    if (Math.abs(dx) > Math.abs(dy)) world.input(dx > 0 ? 'right' : 'left');
    else world.input(dy > 0 ? 'slide' : 'jump');
  }, { passive: true });

  dom.canvas.addEventListener('touchend', event => {
    if (!touch || touch.used || !running || paused) { touch = null; return; }
    const t = event.changedTouches[0];
    /* Короткое касание без движения — тоже прыжок: так играют одной рукой. */
    if (Math.abs(t.clientX - touch.x) < SWIPE && Math.abs(t.clientY - touch.y) < SWIPE) {
      world.input('jump');
    }
    touch = null;
  }, { passive: true });

  /* Мышь на компьютере: клик по полю — прыжок. */
  dom.canvas.addEventListener('mousedown', () => {
    if (running && !paused) world.input('jump');
  });

  /* ---------- Лавка ---------- */

  /* Картинка из склада игры. В собранной странице все картинки лежат внутри
     неё (ТЕКСТУРЫ), при работе с папкой — обычными файлами. */
  const картинкаЛавки = имя =>
    (typeof ТЕКСТУРЫ !== 'undefined' && ТЕКСТУРЫ[имя]) ? ТЕКСТУРЫ[имя] : `models/текстуры/${имя}.webp`;

  /* Значки снаряжения — те же, что сыплются на дороге. */
  const ЗНАЧКИ = {
    magnet: 'значок-магнит', shield: 'значок-щит', dash: 'значок-рывок',
    wings: 'значок-крылья', startShield: 'значок-щит'
  };

  /* Число с пробелами по-русски: 20 000, а не 20000. */
  const число = n => Number(n || 0).toLocaleString('ru-RU');

  /* Ценник из двух частей — монеты и кристаллы (с 29.09.2026 всё в лавке и
     трассы стоят того и другого сразу). Недостающая часть — красным, чтобы
     было видно, чего именно не хватает. */
  function ценник(cost) {
    const el = document.createElement('div');
    el.className = 'price';
    const хватаетМонет = (save.coins || 0) >= cost.coins;
    const хватаетКристаллов = (save.gems || 0) >= cost.gems;
    el.innerHTML =
      `<i class="dot dot-coin"></i><span${хватаетМонет ? '' : ' class="price-short"'}>${число(cost.coins)}</span>` +
      `<i class="dot dot-gem"></i><span${хватаетКристаллов ? '' : ' class="price-short"'}>${число(cost.gems)}</span>`;
    return el;
  }

  function renderShop() {
    dom.shopCoins.textContent = save.coins;
    dom.shopGems.textContent = save.gems;
    renderSkins();
    renderUpgrades();
    renderItems();
    renderLooks();
  }

  function renderSkins() {
    dom.shopSkins.innerHTML = '';
    for (const skin of Shop.SKINS) {
      const owned = save.owned.includes(skin.id);
      const active = save.skin === skin.id;

      const card = document.createElement('div');
      card.className = 'card' + (active ? ' card-active' : owned ? ' card-owned' : '');
      /* Владелец 23.09.2026: «в лавке должен быть прям изображение наряда,
         а не просто подпись». Портреты сняты с самой игры инструментом
         tools/снимки-нарядов.js — что видно на карточке, то и побежит. */
      card.innerHTML = `
        <img class="card-portrait" src="${картинкаЛавки('лавка-' + skin.id)}" alt="">
        <div class="card-body">
          <div class="card-name">${skin.name}</div>
          <div class="card-about">${skin.about}</div>
        </div>
        <div class="card-side"></div>`;

      const side = card.querySelector('.card-side');
      if (active) {
        side.innerHTML = '<span class="pill pill-quiet">Надето</span>';
      } else if (owned) {
        const btn = document.createElement('button');
        btn.className = 'pill';
        btn.type = 'button';
        btn.textContent = 'Надеть';
        btn.addEventListener('click', () => {
          save.skin = skin.id;
          store();
          sound.buy();
          renderSkins();
        });
        side.appendChild(btn);
      } else {
        const check = Shop.canAfford(save, skin.cost);
        const price = ценник(skin.cost);
        const btn = document.createElement('button');
        btn.className = 'pill';
        btn.type = 'button';
        btn.textContent = 'Купить';
        btn.disabled = !check.ok;
        btn.addEventListener('click', () => buySkin(skin));
        side.appendChild(price);
        side.appendChild(btn);
      }
      dom.shopSkins.appendChild(card);
    }
  }

  /* ---------- Трассы ---------- */

  function renderPlaces() {
    dom.placesCoins.textContent = save.coins;
    dom.placesGems.textContent = save.gems;
    dom.placesTotal.textContent = save.всего || 0;
    dom.placesList.innerHTML = '';

    for (const м of Places.МЕСТА) {
      const открыта = Places.открыто(save, м);
      const выбрана = (save.место || 'кладбище') === м.id;

      const card = document.createElement('div');
      card.className = 'card' + (выбрана && открыта && (!м.скоро || ТЕСТ) ? ' card-active'
        : открыта ? ' card-owned' : '');
      card.innerHTML = `
        <img class="card-portrait" src="${картинкаЛавки('трасса-' + м.id)}" alt="">
        <div class="card-body">
          <div class="card-name">${м.имя}</div>
          <div class="card-about">${м.о}</div>
        </div>
        <div class="card-side"></div>`;

      const side = card.querySelector('.card-side');
      if (м.скоро && !ТЕСТ) {
        /* Цену показываем и у той, что ещё не готова: пусть копят. */
        if (м.цена) side.appendChild(ценник(м.цена));
        side.insertAdjacentHTML('beforeend', '<span class="pill pill-quiet">Скоро</span>');
      } else if (выбрана && открыта) {
        side.innerHTML = '<span class="pill pill-quiet">Выбрана</span>';
      } else if (открыта) {
        const btn = document.createElement('button');
        btn.className = 'pill';
        btn.type = 'button';
        btn.textContent = 'Бежать тут';
        btn.addEventListener('click', () => {
          save.место = м.id;
          store();
          sound.buy();
          sound.сменитьМесто(Places.текущее(save, ТЕСТ).id);
          renderPlaces();
        });
        side.appendChild(btn);
      } else {
        /* Закрыта: открыть за монеты с кристаллами или за рубли. Пробежанные
           метры трассу больше не открывают (29.09.2026, слово владельца). */
        const check = Shop.canAfford(save, м.цена);
        const btn = document.createElement('button');
        btn.className = 'pill';
        btn.type = 'button';
        btn.textContent = 'Открыть';
        btn.disabled = !check.ok;
        btn.addEventListener('click', () => buyPlace(м));
        side.appendChild(ценник(м.цена));
        side.appendChild(btn);
        if (м.рубли) {
          /* За рубли платят только в приложении: на сайте нет оплаты. Цену
             показываем, чтобы было видно, что так можно, — и честно говорим где. */
          const рубли = document.createElement('button');
          рубли.className = 'pill pill-quiet';
          рубли.type = 'button';
          рубли.textContent = `${число(м.рубли)} ₽`;
          рубли.addEventListener('click', () => {
            sound.deny();
            toast('Купить за рубли можно будет в приложении');
          });
          side.appendChild(рубли);
        }
      }
      dom.placesList.appendChild(card);
    }
  }

  function buyPlace(м) {
    const check = Shop.canAfford(save, м.цена);
    if (!check.ok) { sound.deny(); toast(check.reason); return; }
    Shop.pay(save, м.цена);
    save.места = (save.места || []).concat(м.id);
    save.место = м.id;
    store();
    sound.buy();
    sound.сменитьМесто(Places.текущее(save, ТЕСТ).id);
    toast(`${м.имя} открыт — теперь бежим здесь`);
    renderPlaces();
  }

  function buySkin(skin) {
    const check = Shop.canAfford(save, skin.cost);
    if (!check.ok) { sound.deny(); toast(check.reason); return; }
    Shop.pay(save, skin.cost);
    save.owned.push(skin.id);
    save.skin = skin.id;
    store();
    sound.buy();
    toast(`${skin.name} — теперь твоё обличье`);
    renderShop();
  }

  function renderUpgrades() {
    dom.shopUpgrades.innerHTML = '';

    for (const up of Shop.UPGRADES) {
      const level = save.levels[up.id] || 0;
      const maxed = level >= up.max;
      const cost = Shop.upgradeCost(level);
      const check = Shop.canAfford(save, cost);

      const card = document.createElement('div');
      card.className = 'card' + (maxed ? ' card-owned' : '');
      card.innerHTML = `
        <img class="card-icon" src="${картинкаЛавки(ЗНАЧКИ[up.id])}" alt="">
        <div class="card-body">
          <div class="card-name">${up.name}</div>
          <div class="card-about">${up.about}</div>
          <div class="levels">${
            Array.from({ length: up.max }, (_, i) =>
              `<span class="level-dot${i < level ? ' level-dot-on' : ''}"></span>`).join('')
          }</div>
        </div>
        <div class="card-side"></div>`;

      const side = card.querySelector('.card-side');
      if (maxed) {
        side.innerHTML = '<span class="pill pill-quiet">Предел</span>';
      } else {
        const priceEl = ценник(cost);
        const btn = document.createElement('button');
        btn.className = 'pill';
        btn.type = 'button';
        btn.textContent = level ? 'Улучшить' : 'Купить';
        btn.disabled = !check.ok;
        btn.addEventListener('click', () => {
          const now = Shop.canAfford(save, cost);
          if (!now.ok) { sound.deny(); toast(now.reason); return; }
          Shop.pay(save, cost);
          save.levels[up.id] = level + 1;
          store();
          sound.buy();
          toast(`${up.name} — уровень ${level + 1}`);
          renderShop();
        });
        side.appendChild(priceEl);
        side.appendChild(btn);
      }
      dom.shopUpgrades.appendChild(card);
    }

    /* Ладанка — разовая покупка, поэтому карточка своя. */
    const charm = Shop.CHARM;
    const card = document.createElement('div');
    card.className = 'card' + (save.charm ? ' card-owned' : '');
    card.innerHTML = `
      <img class="card-icon" src="${картинкаЛавки(ЗНАЧКИ[charm.id])}" alt="">
      <div class="card-body">
        <div class="card-name">${charm.name}</div>
        <div class="card-about">${charm.about}</div>
      </div>
      <div class="card-side"></div>`;
    const side = card.querySelector('.card-side');
    if (save.charm) {
      side.innerHTML = '<span class="pill pill-quiet">Куплено</span>';
    } else {
      const check = Shop.canAfford(save, charm.cost);
      const priceEl = ценник(charm.cost);
      const btn = document.createElement('button');
      btn.className = 'pill';
      btn.type = 'button';
      btn.textContent = 'Купить';
      btn.disabled = !check.ok;
      btn.addEventListener('click', () => {
        const now = Shop.canAfford(save, charm.cost);
        if (!now.ok) { sound.deny(); toast(now.reason); return; }
        Shop.pay(save, charm.cost);
        save.charm = true;
        store();
        sound.buy();
        toast('Ладанка при тебе: забег начнётся со щитом');
        renderShop();
      });
      side.appendChild(priceEl);
      side.appendChild(btn);
    }
    dom.shopUpgrades.appendChild(card);
  }

  /* ---------- Кнопки ---------- */

  el('play-button').addEventListener('click', startRun);
  el('continue-button').addEventListener('click', continueRun);
  el('double-button').addEventListener('click', удвоитьЗаРолик);
  el('rewards-button').addEventListener('click', () => { renderRewards(); showScreen('rewards'); });
  el('rewards-back').addEventListener('click', () => showScreen('menu'));
  el('again-button').addEventListener('click', startRun);
  el('menu-button').addEventListener('click', () => showScreen('menu'));
  el('help-button').addEventListener('click', () => showScreen('help'));
  el('help-back').addEventListener('click', () => showScreen('menu'));
  el('shop-back').addEventListener('click', () => showScreen('menu'));
  el('places-back').addEventListener('click', () => showScreen('menu'));
  el('places-button').addEventListener('click', () => {
    renderPlaces();
    showScreen('places');
  });

  el('shop-button').addEventListener('click', () => {
    renderShop();
    showScreen('shop');
  });

  el('pause-button').addEventListener('click', () => pauseRun(true));
  el('resume-button').addEventListener('click', () => pauseRun(false));
  el('quit-button').addEventListener('click', () => {
    /* Досрочный уход — забег не пропадает: собранное зачисляется. */
    paused = false;
    if (world && !world.over) world.finish('quit');
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tab')) other.classList.remove('tab-active');
      tab.classList.add('tab-active');
      const вкладка = tab.dataset.tab;
      dom.shopSkins.hidden = вкладка !== 'skins';
      dom.shopUpgrades.hidden = вкладка !== 'upgrades';
      dom.shopItems.hidden = вкладка !== 'items';
      dom.shopLooks.hidden = вкладка !== 'looks';
    });
  }

  /* Свернули вкладку — забег ждёт, а не идёт вслепую. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running && !paused) pauseRun(true);
    sound.уснуть(document.hidden);      // и музыка не играет в свёрнутой вкладке
  });

  /* ---------- Музыка и звуки ---------- */

  function обновитьЗвук() {
    for (const кн of document.querySelectorAll('[data-звук="музыка"]')) {
      кн.textContent = save.music !== false ? 'Музыка: вкл' : 'Музыка: выкл';
    }
    for (const кн of document.querySelectorAll('[data-звук="звуки"]')) {
      кн.textContent = save.sound !== false ? 'Звуки: вкл' : 'Звуки: выкл';
    }
  }

  for (const кн of document.querySelectorAll('[data-звук]')) {
    кн.addEventListener('click', () => {
      const что = кн.dataset.звук;
      if (что === 'музыка') {
        save.music = save.music === false;
        sound.setMusic(save.music);
      } else if (что === 'звуки') {
        save.sound = save.sound === false;
        sound.setEnabled(save.sound);
        if (save.sound) sound.buy();
      }
      store();
      обновитьЗвук();
    });
  }
  обновитьЗвук();

  if (ТЕСТ) {
    const подпись = document.querySelector('#screen-menu .subtitle');
    if (подпись) подпись.textContent = 'Тестовый режим: всё открыто, покупать ничего не надо';
  }

  window.addEventListener('resize', () => renderer.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 120));

  /* ---------- Заставка ----------
     Пока игрок в меню, за спиной идёт настоящий забег без участия человека:
     сразу видно, что это за игра. */

  function idleScene() {
    if (!idleWorld) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - idleLast) / 1000 || 0.016);
    idleLast = now;
    if (!running && caughtWorld) {
      renderer.draw(caughtWorld, now / 1000, dt);   // укус под экраном итога
    } else if (!running) {
      const action = Engine.planAction(idleWorld);
      if (action) idleWorld.input(action);
      idleWorld.update(dt);
      if (idleWorld.over || idleWorld.z > 4000) newIdleWorld();
      renderer.draw(idleWorld, now / 1000, dt);
    }
    requestAnimationFrame(idleScene);
  }

  let idleWorld = null;
  let idleLast = 0;

  function newIdleWorld() {
    idleWorld = new Engine.World({ seed: (Math.random() * 1e9) | 0, место: Places.текущее(save, ТЕСТ).id });
    idleWorld.skin = Shop.skinById(save.skin);
    idleWorld.красота = красотаМира();
    idleWorld.мышьРядом = есть('мышь');
    idleLast = performance.now();
  }

  /* Пока модели едут, показываем заставку загрузки: пустой чёрный экран
     читался бы как поломка. Заставка с забегом стартует, когда всё готово. */
  showScreen('menu');
  renderer.ready.then(() => {
    document.getElementById('loading').hidden = true;
    newIdleWorld();
    requestAnimationFrame(idleScene);
  });

  /* Наружу — для установщика приложения и проверок в браузере. */
  window.RunnerApp = {
    start: startRun,
    toast,
    renderer: () => renderer,
    save: () => save,
    world: () => world,
    installButton: dom.installButton
  };
})();
