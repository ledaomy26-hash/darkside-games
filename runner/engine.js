/* Движок «Бегуна Dark Side»: мир, физика, генерация трассы, столкновения.

   Здесь нет ни отрисовки, ни обращений к странице — только счёт. Благодаря
   этому весь забег воспроизводится в Node и проверяется тестами.

   Оси мира, в метрах:
   - z — вперёд, вдоль трассы. Растёт по мере бега, это же и есть дистанция;
   - x — поперёк. Три дорожки с центрами -LANE_W, 0, +LANE_W;
   - y — вверх. 0 — мостовая, крыша повозки — её высота.

   Время идёт фиксированными шагами по STEP секунд: при одном и том же зерне
   и одних и тех же нажатиях забег повторяется в точности, сколько бы кадров
   в секунду ни выдавало устройство.

   Трасса рождается кусками по мере приближения и всегда проходима: в каждой
   связке препятствий остаётся дорожка, которую можно пройти вовремя сделанным
   прыжком, подкатом или сменой дорожки. Это не обещание, а проверка —
   tests/track.js прогоняет по трассе бота, который играет безошибочно. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RunnerEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Размеры мира ---------- */

  const LANE_W = 1.75;                  // расстояние между центрами дорожек
  const LANES = [-1, 0, 1];

  const STEP = 1 / 120;                 // шаг счёта: мельче кадра, крупнее не нужно
  const MAX_FRAME = 0.05;               // просадка кадра не должна телепортировать бегуна

  const BODY_W = 0.72;                  // ширина бегуна
  const BODY_H = 1.70;                  // рост стоя
  const SLIDE_H = 0.82;                 // рост в подкате

  /* ---------- Бег ---------- */

  const SPEED_START = 12.5;
  const SPEED_MAX = 27;
  const SPEED_PER_METER = 1 / 110;      // +1 м/с каждые 110 метров

  const LANE_SPEED = 15.0;              // как быстро бегун переползает на соседнюю дорожку
  /* Прыжок поднимает примерно на 1,6 м. Раньше было 1,4 — и вся нечисть на
     дороге вынужденно сидела ростом в метр, иначе перепрыгнуть её было бы
     нельзя. С метровым мертвецом рядом с бегуном в 1,70 дорога выглядела
     заставленной пеньками. Толчок и высота нечисти подняты вместе, запас
     над макушкой остался прежним — около трети метра. */
  const JUMP_V = 8.8;
  const GRAVITY = -24;
  const FAST_FALL = -46;                // «вниз» в воздухе роняет бегуна быстрее
  const SLIDE_TIME = 0.55;
  const INPUT_BUFFER = 0.13;            // нажатие чуть раньше времени не пропадает
  const COYOTE = 0.08;                  // прыжок прощается сразу после схода с крыши

  /* ---------- Погоня ---------- */

  /* Три удара — и всё. Правило простое нарочно: игрок должен считать свои
     ошибки в уме, а не гадать по полоске, сколько ещё осталось. Раньше погоня
     копилась и понемногу отпускала, и на вопрос «сколько я ещё выдержу»
     ответа не было ни у кого.

     Теперь тварь идёт ровно по числу падений: каждое подпускает её на треть
     полосы, третье — она достаёт. Пока бегун лежит, она подступает вплотную
     и после подъёма откатывается назад: видно, чего стоила ошибка. */
  const LIVES = 3;                      // столько раз можно врезаться за забег
  const CHASE_BASE = 0.2;               // тварь маячит позади и без единой ошибки
  const CHASE_CLOSE = 0.34;             // и подступает, пока бегун лежит
  const CHASE_EASE = 0.45;              // за столько погоня приходит к своему месту

  const FALL_DOWN = 0.5;                // бегун валится с ног
  const FALL_UP = 0.55;                 // и поднимается обратно
  const FALL_SPEED = 0.3;               // ход, пока он на земле
  const FALL_GRACE = 0.4;               // и запас после подъёма, чтобы не упасть снова
  /* После третьего падения Дракула успевает дойти, схватить и укусить —
     сцена укуса (render3d.js) идёт эти 2,6 с, потом экран итога. До 19.09.2026
     было 1,4 с: тварь только доходила, и забег обрывался. */
  const CAUGHT_HOLD = 2.6;

  const STUMBLE_TIME = 0.45;            // поднялся — и первые полсекунды не бежит, а ковыляет
  const STUMBLE_SPEED = 0.62;           // теряя часть хода

  /* ---------- Бонусы ---------- */

  const POWER_BASE = { magnet: 8, shield: 12, dash: 4.5, wings: 6 };
  const POWER_PER_LEVEL = 1.5;          // каждый уровень в лавке добавляет столько секунд
  const DASH_SPEED = 1.55;
  const DASH_RAMP = 0.35;               // за столько рывок разгоняет и настолько же отпускает
  const WINGS_Y = 3.4;
  const WINGS_LANDING = 1.0;            // последнюю секунду крылья плавно опускают бегуна
  const WINGS_HOLD = 5.0;               // и ждут свободного места, но не дольше этого
  const WINGS_GRACE = 0.6;              // столько после посадки нечисть ещё не берёт

  /* Продолжение забега на том же месте: тварь отброшена, участок впереди
     расчищен, и первые секунды бегуна не берут — иначе он очнётся вплотную
     к тому же надгробию и погибнет второй раз, не успев ничего нажать. */
  const REVIVE_CLEAR = 26;
  const REVIVE_GRACE = 2.5;

  /* ---------- Вещи из лавки в духе Subway Surfers (09.10.2026) ----------

     Владелец: «ставим покупки в духе Subway Surfers». Крышка гроба — как доска:
     включается кнопкой на бегу, держится полминуты и принимает на себя один
     удар. Фора на катафалке — как «Head Start»: в первые секунды забега
     уносит вперёд втрое быстрее, неуязвимо, с магнитом; сносит всё на пути.
     После форы участок впереди расчищен, как после продолжения. */
  const КРЫШКА_ВРЕМЯ = 30;
  const ФОРА_ВРЕМЯ = 9;
  const ФОРА_СКОРОСТЬ = 3.0;            // во столько раз быстрее обычного бега
  /* Летучая мышь-спутник подбирает монеты с соседней дорожки: до центра
     соседней 1,75 м — берёт всё, что ближе 2,4 м по ширине, но только монеты
     у земли, не кристаллы и не находки (за ними — самому). */
  const МЫШЬ_ДОСТАЁТ = 2.4;
  /* Магнит тянет монеты издалека и через дорожки: владелец сказал, что
     видно только сбор, а самого притяжения нет (20.09.2026). Дальность
     выросла, а полёт монет к бегуну рисует render3d (drawPickups). */
  const MAGNET_RANGE = 7.5;

  /* ---------- Что стоит на кладбищенской дороге ----------

     grave   надгробие: перепрыгнуть
     web     паутина между склепами: подкатиться
     crypt   склеп во всю дорожку: только объехать
     hearse  катафалк: объехать или запрыгнуть на крышу и бежать по ней
     zombie  мертвец: перепрыгнуть или объехать
     pit     яма с ядовитой жижей: перепрыгнуть, крыши у неё нет

     Мертвец стоит на месте, а шатается и переступает только на картинке.
     Это не лень, а расчёт: пока препятствие неподвижно, момент прыжка считается
     точно. Стоило мертвецу побрести и остановиться на своей отметке — встреча
     наступала позже прогноза, и безошибочная игра врезалась на излёте прыжка.
     Поле speed оставлено для будущей нечисти, которая и вправду полетит. */

  const OBSTACLES = {
    /* С 20.09.2026 надгробие выше и шире: «красивые, но мелкие, не особо
       видно». Прыжок поднимает на 1,61 м — запас остаётся. */
    grave:  { len: 1.2, h: 1.25, roof: false },
    web:    { len: 1.1, h: 3.20, roof: false, bottom: 1.15 },
    crypt:  { len: 1.6, h: 2.40, roof: false },
    hearse: { len: 9.0, h: 1.05, roof: true },
    /* С 20.09.2026 твари в рост и выше: владелец попросил сделать их крупными
       и качественными, а перепрыгивать не давать — только объезжать. Высота
       2,3 м больше прыжка (1,61 м), и планировщик сам перестаёт прыгать. */
    zombie: { len: 1.1, h: 2.30, roof: false },
    pit:    { len: 3.4, h: 0,    roof: false, pit: true }
  };

  /* Яма растягивается вместе со скоростью, но всегда короче прыжка: на разгоне
     он даёт около шести метров, на пределе — семнадцать. */
  const PIT_MIN = 2.6;
  const PIT_MAX = 4.6;
  const PIT_DEPTH = 0.38;               // выше этой отметки жижа уже не достаёт

  /* Ямы бывают трёх видов. Для счёта они одинаковы — их перепрыгивают, — и
     различаются только обликом. Поэтому вид выбирается здесь, а не в отрисовке:
     он должен быть частью трассы и повторяться при одном и том же зерне. */
  const PIT_KINDS = ['acid', 'spikes', 'grave'];

  /* Нечисть на дороге тоже разного рода, и по той же причине: одинаковые
     мертвецы через километр приедаются. Для счёта все они равны — любого
     перепрыгивают или объезжают, — а вид выбирается здесь, чтобы держаться
     зерна и повторяться на одной и той же трассе. */
  /* С 20.09.2026 среди них и Дракула: летящая модель с картинки владельца
     стоит на дороге и парит — «поставь его просто на пути, оббежать можно
     только слева или справа». Бегущего Дракулу для погони делаем отдельно. */
  /* С 27.09.2026 ещё колдун и мумия — модели с картинок владельца из очереди.
     Вампира на дороге больше нет: своей модели у него не было, и он стоял
     мультяшной фигурой из набора KayKit. Владелец: «убирай из игры
     мультяшного персонажа, чтобы на трассе стояли наши персонажи». */
  /* С 29.09.2026 ещё паук и жнец — твари подземелья из очереди. */
  /* С 04.10.2026 ещё адская гончая и мертвец-рудокоп (подземелье), каменный
     голем и ожившие доспехи (замок) — из очереди 01–04.10. */
  /* С 05.10.2026 ещё ожившая статуя ангела (замок). */
  /* С 09.10.2026 ещё дама в белом, горгулья, палач и шут (замок). */
  const MONSTER_KINDS = ['zombie', 'skeleton', 'werewolf', 'dracula', 'warlock', 'mummy', 'spider', 'reaper',
    'hound', 'miner', 'golem', 'armor', 'statue', 'lady', 'gargoyle', 'executioner', 'jester'];

  /* У каждой трассы своя нечисть (владелец 29.09.2026). Кладбище — зомби,
     скелет с мечом, оборотень, вампир и колдун; вампир у нас — это Дракула
     в плаще, что парит на дороге (в коде 'dracula'), а тот, что гонится,
     — граф без плаща. Подземелье — мумия, огромный паук, жнец, адская
     гончая, мертвец-рудокоп; из них подключены мумия, паук и жнец,
     гончей и рудокопа пока нет.
     Замку — голем и свои (ещё не сделаны). Трасса без своего списка берёт
     кладбищенский. */
  const ТВАРИ_МЕСТ = {
    кладбище: ['zombie', 'skeleton', 'werewolf', 'dracula', 'warlock'],
    подземелье: ['mummy', 'spider', 'reaper', 'hound', 'miner'],
    /* Замок (04.10.2026): голем и доспехи — первые свои; вампир (Дракула
       в плаще) у себя дома; с 05.10 — статуя ангела; с 09.10 — дама в белом,
       горгулья, палач, шут. */
    замок: ['golem', 'armor', 'statue', 'dracula', 'lady', 'gargoyle', 'executioner', 'jester']
  };

  function твариМеста(место) {
    return ТВАРИ_МЕСТ[место] || ТВАРИ_МЕСТ.кладбище;
  }

  /* ---------- Кто гонится ----------

     Каждый забег преследователя видно за спиной, и с дистанцией он сменяется
     на более родовитого. На счёт это не влияет — влияет на то, кого бояться. */

  /* С 19.09.2026 гонится один Дракула — так решил владелец: «твари ходят по
     трассе и мешают, а за бегуном гонится сам Дракула». Прежде по дистанции
     сменялись упырь, оборотень, вампир, и Дракула выходил только с 4200 м —
     до него доживал редкий забег. Упырь, оборотень и вампир теперь стоят
     на дороге препятствиями. */
  const HUNTERS = [
    { id: 'dracula',  name: 'Дракула',   from: 0 }
  ];

  function hunterAt(distance) {
    let found = HUNTERS[0];
    for (const h of HUNTERS) if (distance >= h.from) found = h;
    return found;
  }

  const COIN_VALUE = 1;

  /* ---------- Случай с зерном ----------
     mulberry32: короткий, быстрый и одинаковый на любой машине. */

  function makeRandom(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function speedAt(z) {
    return Math.min(SPEED_MAX, SPEED_START + z * SPEED_PER_METER);
  }

  /* ---------- Генератор трассы ----------

     Трасса строится связками. Связка — это несколько препятствий на одном
     отрезке пути. Правило одно и оно нерушимо: хотя бы одна дорожка связки
     остаётся проходимой, и на неё хватает времени перестроиться. */

  class Track {
    constructor(seed, место) {
      this.rnd = makeRandom(seed);
      this.твари = твариМеста(место);   // кто стоит на дороге этой трассы
      this.obstacles = [];
      this.pickups = [];
      this.builtTo = 40;                // первые сорок метров пустые: бегун разгоняется
      this.lastSafeLane = 0;
    }

    /* Достроить трассу до указанной отметки. */
    buildTo(z) {
      while (this.builtTo < z) this.addGroup();
    }

    addGroup() {
      const z = this.builtTo;
      const speed = speedAt(z);
      const rnd = this.rnd;

      /* Расстояние до следующей связки: столько, сколько нужно, чтобы увидеть,
         решить, перестроиться и приземлиться после прыжка. Прыжок длится
         около двух третей секунды, поэтому запас считается от скорости. */
      /* Промежуток между рядами больше длины прыжка: при 27 м/с бегун летит
         около 24 м, а прежний промежуток начинался с 24 — он перепрыгивал
         один ряд и падал прямо на следующий (20.09.2026, зерно 45). */
      /* Чем дальше, тем сложнее — до 10 км, а не до 2 (09.10.2026, владелец:
         «в начале трассы их немного, но чем дальше бежишь, тем должно быть
         их больше и сложнее; твари и препятствия должны быть пропорциональны
         друг другу»). Прежде плотность упиралась в потолок на 2 км, и дальше
         трасса не менялась; тварь была одним видом из шести — 7 тварей на
         45 прочих препятствий на километр. Теперь растут: доля тварей среди
         преград, число занятых дорожек, препятствия на свободной дорожке,
         перестроения и частота связок. Нижняя граница промежутка — та же:
         она держит проходимость (длина прыжка от скорости). */
      const k = Math.min(1, z / 10000);
      const gap = Math.max(20, speed * 1.25) * (0.85 + rnd() * 0.5 * (1 - 0.6 * k));

      /* Свободная дорожка — соседняя с прошлой или та же: за один промежуток
         бегун успевает сместиться на одну, но не через всю трассу. Дальше
         по трассе она чаще перескакивает — больше перестроений. */
      const shift = rnd() < 0.55 - 0.25 * k ? 0 : (rnd() < 0.5 ? -1 : 1);
      let safe = this.lastSafeLane + shift;
      if (safe < -1) safe = 0;
      if (safe > 1) safe = 0;

      const density = Math.min(0.95, 0.35 + z / 5000);   // дальше — теснее
      const долятварей = 0.3 + 0.37 * k;                  // 30 % в начале, две трети к 10 км
      const kinds = ['grave', 'web', 'crypt', 'hearse', 'pit'];
      const passable = ['grave', 'web', 'pit'];          // берутся действием, не объездом
      let longest = 0;

      for (const lane of LANES) {
        if (lane === safe) {
          /* На свободной дорожке допустимо препятствие с выходом: прыжок
             или подкат. Так бег остаётся живым, а трасса — проходимой. */
          if (rnd() < 0.45 + 0.35 * k) {
            const kind = passable[Math.floor(rnd() * passable.length)];
            longest = Math.max(longest, this.place(z, lane, kind));
          }
          continue;
        }
        if (rnd() > density) continue;
        const kind = rnd() < долятварей ? 'zombie' : kinds[Math.floor(rnd() * kinds.length)];
        longest = Math.max(longest, this.place(z, lane, kind));
      }

      this.addPickups(z, safe, longest);
      this.lastSafeLane = safe;
      this.builtTo = z + gap + longest;
    }

    /* Ставит препятствие и возвращает его длину: по ней считается, где начнётся
       следующая связка. */
    place(z, lane, kind) {
      const spec = OBSTACLES[kind];
      const len = spec.pit
        ? Math.min(PIT_MAX, Math.max(PIT_MIN, speedAt(z) * 0.17))
        : spec.len;
      this.obstacles.push({
        kind, lane, z, len,
        variant: spec.pit ? PIT_KINDS[Math.floor(this.rnd() * PIT_KINDS.length)]
          : (kind === 'zombie' ? this.твари[Math.floor(this.rnd() * this.твари.length)] : null),
        h: spec.h,
        bottom: spec.bottom || 0,
        roof: !!spec.roof,
        pit: !!spec.pit,
        speed: spec.speed ? spec.speed : 0,
        offset: 0                        // сдвиг живой нечисти и снесённых рывком
      });
      return len;
    }

    /* Монеты идут дорожкой, а над низким завалом выгибаются дугой — так видно,
       где прыгать, без единой подсказки на экране. */
    addPickups(z, safeLane, longest) {
      const rnd = this.rnd;
      if (rnd() < 0.22) return;

      const lane = rnd() < 0.75 ? safeLane : LANES[Math.floor(rnd() * 3)];
      const count = 5 + Math.floor(rnd() * 5);
      const startZ = z + longest + 2.5;
      const arc = rnd() < 0.35;

      /* Дуга выкладывается ровно по траектории прыжка на этой скорости,
         на высоте середины тела. Прежняя дуга была задана в метрах раз и
         навсегда, а длина прыжка растёт со скоростью: на быстром беге бегун
         перелетал её и монеты оставались позади (владелец, 21.09.2026:
         «прыгаешь — не успеваешь монетки хватать»). */
      const скорость = speedAt(startZ);
      const вПолёте = 2 * JUMP_V / -GRAVITY;          // 0,73 с
      const шаг = arc ? Math.max(1.3, (скорость * вПолёте) / (count - 1)) : 1.6;
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0;
        const время = t * вПолёте;
        const высота = arc
          ? JUMP_V * время + GRAVITY * время * время / 2 + BODY_H / 2
          : 0.85;
        this.pickups.push({
          kind: 'coin', lane,
          z: startZ + i * шаг,
          y: высота,
          taken: false
        });
      }

      if (rnd() < 0.06) {
        this.pickups.push({ kind: 'gem', lane, z: startZ + count * 1.6 + 2, y: 1.0, taken: false });
      }
      if (rnd() < 0.10) {
        const powers = ['magnet', 'shield', 'dash', 'wings'];
        this.pickups.push({
          kind: powers[Math.floor(rnd() * powers.length)],
          lane, z: startZ + count * 1.6 + 4, y: 1.1, taken: false
        });
      }
    }

    /* ---------- Воздушная дорожка монет ----------

       Что было не так. Дорожка выкладывалась заново в десяти метрах впереди
       и длиной в девять десятых пути, посчитанного по текущей скорости, —
       пятьдесят шесть метров. А бегун за полёт проходит метров тридцать семь:
       взлёт занимает время, и последнюю секунду он снижается. Разница висела
       в воздухе, когда он уже бежал по земле. При этом монеты, лежавшие
       на дороге под ним, так и оставались лежать — забрать их с высоты нельзя,
       и бонус получался наказанием: летишь и смотришь, как добро уплывает.

       Как теперь. Дорожка не выкладывается рядом с земной, а поднимает её:
       монеты, лежащие на пути полёта, переезжают на ту высоту, на которой
       бегун окажется в этом месте. Взлёт и посадка — наклонные, поэтому
       на подъёме монеты идут снизу вверх, а к посадке спускаются вместе
       с бегуном. Пустые промежутки достраиваются, и дорожка виляет между
       дорожками, чтобы в воздухе было чем заняться.

       Считается всё от настоящей дальности полёта, а не от девяти десятых
       наугад: сколько бегун пролетит, столько монет и будет. */
    liftCoins(fromZ, speed, flight, height) {
      const дальность = speed * flight;
      const конец = fromZ + дальность;
      const спускС = конец - speed * WINGS_LANDING;   // отсюда бегун снижается

      /* Высота монет обязана повторять высоту бегуна, а не идти своей прямой.

         Бегун набирает высоту не равномерно: `y += (target - y) * dt * 7` —
         это кривая, за первые полметра он уже на трети высоты, за два метра
         на девяти десятых. Прямая наклонная дорожка отставала от него, монеты
         оказывались на метр ниже, чем он летел, и в проверку сбора не попадали:
         поднялись — а всё равно не берутся. Поэтому здесь та же кривая с той же
         крутизной, что и в полёте. */
      const крутизна = 7 / Math.max(1, speed);      // на метр пути, а не на секунду
      const высотаНа = z => {
        if (z <= fromZ || z >= конец) return 0;
        const вверх = 1 - Math.exp(-(z - fromZ) * крутизна);
        const вниз = z <= спускС ? 1 : Math.exp(-(z - спускС) * крутизна);
        return height * Math.max(0, Math.min(вверх, вниз));
      };

      /* Волна поперёк пути: без неё дорожка выглядит натянутой струной. */
      const волна = z => Math.sin(z * 0.4) * 0.28;

      /* ---------- Маршрут полёта ----------

         Сначала прокладывается сам маршрут — отрезками по восемь-пятнадцать
         метров, каждый на своей дорожке, с обязательным переходом вбок между
         ними. Всё остальное — и поднятые с земли монеты, и новые — ложится
         на этот маршрут.

         Прежде было наоборот: монеты подхватывали дорожку у тех, что лежали
         на земле, и счётчик перехода сбрасывался на каждой поднятой. Из
         тридцати двух монет двадцать шесть оказывались на одной полосе —
         летишь по прямой и ждёшь посадки. */
      const rnd = this.rnd;
      const отрезки = [];
      {
        let z = fromZ;
        let lane = LANES[Math.floor(rnd() * 3)];
        while (z < конец) {
          /* Отрезок — по скорости, а не в метрах наугад: на быстром беге
             (с 20.09.2026) прежние 8–15 м мелькали, и монеты не успевали
             собираться — проверка полёта поймала. */
          const длина = speed * 0.75 + rnd() * speed * 0.45;
          отрезки.push({ доZ: z + длина, lane });
          z += длина;
          const вбок = rnd() < 0.5 ? -1 : 1;
          const следующая = lane + вбок;
          lane = следующая < -1 || следующая > 1 ? lane - вбок : следующая;
        }
      }
      const дорожкаНа = z => {
        for (const о of отрезки) if (z <= о.доZ) return о.lane;
        return отрезки.length ? отрезки[отрезки.length - 1].lane : 0;
      };

      /* Поднимаем то, что уже лежит на дороге, и переносим на маршрут. Бонусы
         не трогаем: за ними игрок ныряет сам, и висящий в воздухе оберег
         только запутает. */
      const занято = [];
      for (const p of this.pickups) {
        if (p.taken || p.sky) continue;
        if (p.kind !== 'coin' && p.kind !== 'gem') continue;
        if (p.z < fromZ || p.z > конец) continue;
        const h = высотаНа(p.z);
        if (h < 0.12) continue;            // у самой земли поднимать нечего
        p.lane = дорожкаНа(p.z);
        p.y = h + волна(p.z);
        p.sky = true;
        занято.push(p.z);
      }
      занято.sort((a, b) => a - b);

      /* И достраиваем пустые места. */
      const шаг = 1.7;
      let i = 0;
      for (let z = fromZ + 1.2; z < конец - 0.5; z += шаг) {
        while (i < занято.length && занято[i] < z - шаг * 0.9) i++;
        if (i < занято.length && Math.abs(занято[i] - z) < шаг * 0.9) continue;

        const h = высотаНа(z);
        if (h < 0.12) continue;
        this.pickups.push({
          kind: 'coin', lane: дорожкаНа(z), z, y: h + волна(z), sky: true, taken: false
        });
      }

      /* Кристалл в награду — на середине полёта, где высота полная. */
      if (rnd() < 0.6) {
        const серединаZ = fromZ + дальность / 2;
        this.pickups.push({
          kind: 'gem', lane: дорожкаНа(серединаZ), z: серединаZ,
          y: высотаНа(серединаZ) + волна(серединаZ), sky: true, taken: false
        });
      }
    }

    /* Пока крылья ждут свободного места над препятствием (holdWings, до
       WINGS_HOLD), бегун висит наверху, а дорожка монет рассчитана на
       обычный полёт и уже кончилась — летишь пустым. С 09.10.2026 трасса
       к дальним метрам плотнее, и ждать приходится чаще (проверка полёта,
       зерно 13: 18 м без монет перед посадкой). Монеты досыпаются впереди
       по дорожке бегуна, на высоте полёта, шагом как у воздушной дорожки. */
    досыпатьНебо(z, speed, lane) {
      let край = z + speed * 0.5;
      for (const p of this.pickups) {
        if (!p.sky || p.taken || p.z <= z) continue;
        /* Монеты посадки по расчёту уже спускаются, а бегун ещё висит
           наверху и пролетел бы над ними, — поднимаем их к нему. */
        p.y = Math.max(p.y, WINGS_Y + Math.sin(p.z * 0.4) * 0.28);
        if (p.z > край) край = p.z;
      }
      for (let zz = край + 1.7; zz < z + speed * 0.9; zz += 1.7) {
        this.pickups.push({
          kind: 'coin', lane, z: zz, y: WINGS_Y + Math.sin(zz * 0.4) * 0.28, sky: true, taken: false
        });
      }
    }

    /* Ожидание кончилось, бегун идёт вниз по кривой y·e^(−7t) (applyVertical) —
       монеты впереди опускаются по ней же. Дошедшие до высоты бега ложатся
       на землю обычными: их берут уже после посадки, а в воздухе над
       бегуном ничего не висит. */
    опуститьНебо(z0, speed, y0) {
      const крутизна = 7 / Math.max(1, speed);
      for (const p of this.pickups) {
        if (!p.sky || p.taken || p.z <= z0) continue;
        const h = y0 * Math.exp(-(p.z - z0) * крутизна);
        if (h <= 0.85) { p.y = 0.85; p.sky = false; } else p.y = Math.min(p.y, h);
      }
    }

    /* Препятствия в окне пути — для столкновений и для отрисовки. */
    near(fromZ, toZ) {
      const out = [];
      for (const o of this.obstacles) {
        const z0 = o.z + o.offset;
        if (z0 + o.len >= fromZ && z0 <= toZ) out.push(o);
      }
      return out;
    }

    nearPickups(fromZ, toZ) {
      const out = [];
      for (const p of this.pickups) {
        if (!p.taken && p.z >= fromZ && p.z <= toZ) out.push(p);
      }
      return out;
    }

    /* Прибрать за спиной: пройденное больше не понадобится. */
    forget(beforeZ) {
      this.obstacles = this.obstacles.filter(o => o.z + o.offset + o.len > beforeZ);
      this.pickups = this.pickups.filter(p => !p.taken && p.z > beforeZ);
    }
  }

  /* ---------- Мир ---------- */

  class World {
    constructor(options) {
      const opts = options || {};
      this.seed = opts.seed || 1;
      this.levels = Object.assign({ magnet: 0, shield: 0, dash: 0, wings: 0 }, opts.levels);
      this.startShield = !!opts.startShield;
      this.удвоитель = !!opts.удвоитель;   // монеты ×2 навсегда (лавка)
      this.мышь = !!opts.мышь;             // спутник подбирает монеты с соседних дорожек
      this.место = opts.место || 'кладбище';   // по какой трассе бежим: от неё зависит нечисть
      this.reset();
    }

    reset() {
      this.track = new Track(this.seed, this.место);
      this.time = 0;
      this.z = 0;
      this.lane = 0;
      this.x = 0;
      this.y = 0;
      this.vy = 0;
      this.ground = 0;
      this.onGround = true;
      this.airTime = 0;
      this.airSpeed = SPEED_START;      // скорость, с которой бегун оторвался от земли
      this.boost = 1;                   // разгон рывка, нарастает и спадает плавно
      this.wingsHold = 0;               // сколько крылья уже ждут свободного места
      this.wingsLanding = false;        // снижение началось — назад вверх уже почти не поворачивать
      this.grace = 0;                   // короткая неприкосновенность после посадки
      this.sliding = 0;
      this.stumble = 0;
      this.fallen = 0;                  // сколько ещё лежать и подниматься
      this.doomed = false;              // третье падение: подниматься уже незачем
      this.caught = 0;                  // и сколько твари идти до затылка
      this.chase = CHASE_BASE;
      this.over = false;
      this.coins = 0;
      this.gems = 0;
      this.hits = 0;
      this.powers = { magnet: 0, shield: 0, dash: 0, wings: 0, крышка: 0, фора: 0 };
      this.events = [];
      this.buffer = { lane: 0, jump: 0, slide: 0 };
      if (this.startShield) this.powers.shield = this.powerTime('shield');
      this.track.buildTo(260);
    }

    /* Занята ли дорожка впереди на столько-то метров. */
    pathBusy(distance) {
      const lane = this.occupiedLane;
      for (const o of this.track.obstacles) {
        if (o.lane !== lane) continue;
        const z0 = o.z + o.offset;
        /* Считается и то, внутри чего бегун сейчас летит: на крыльях он может
           проноситься сквозь склеп, и гасить их именно там нельзя. */
        if (z0 + o.len > this.z && z0 < this.z + distance) return true;
      }
      return false;
    }

    /* Крылья не гаснут над препятствием: садиться туда, где негде оттолкнуться,
       значит обречь бегуна на удар, которого он не мог избежать. Держат не
       дольше WINGS_HOLD, иначе бонус растянулся бы на весь плотный участок. */
    holdWings(dt) {
      if (this.powers.wings > WINGS_LANDING) return false;
      if (this.wingsHold >= WINGS_HOLD) return false;
      if (!this.pathBusy(this.speed * 1.2)) return false;
      this.wingsHold += dt;
      return true;
    }

    /* Воздушная дорожка на полёт. Скорость — средняя за полёт, а не текущая:
       взятые на рывке крылья (скорость ×1,55) прежде давали дорожку на всю
       скорость рывка, рывок гас раньше полёта, и хвост монет висел в воздухе
       за точкой посадки (проверка полёта на 40 трассах, 09.10.2026). */
    поднятьМонеты(flight) {
      const рывок = Math.min(this.powers.dash, flight);
      const средняя = speedAt(this.z) * (DASH_SPEED * рывок + (flight - рывок)) / flight;
      this.track.liftCoins(this.z, рывок > 0 ? средняя : this.speed, flight, WINGS_Y);
    }

    powerTime(kind) {
      return POWER_BASE[kind] + POWER_PER_LEVEL * (this.levels[kind] || 0);
    }

    get groundSpeed() {
      const base = speedAt(this.z) * this.boost;
      /* Упавший не встаёт мгновенно на полном ходу: сперва он почти стоит,
         потом ковыляет и лишь затем разбегается. Именно эта потеря хода и
         подпускает тварь — не отдельный счётчик, а само падение. */
      if (this.caught > 0) return base * 0.1;
      if (this.fallen > 0) return base * FALL_SPEED;
      return this.stumble > 0 ? base * STUMBLE_SPEED : base;
    }

    /* Сколько ошибок ещё прощается. */
    get lives() {
      return Math.max(0, LIVES - this.hits);
    }

    /* Что показывать отрисовке: бегун валится, поднимается или бежит. */
    get fallPhase() {
      if (this.doomed) return 'down';
      if (this.fallen <= 0) return null;
      return this.fallen > FALL_UP ? 'down' : 'up';
    }

    /* В воздухе скорость не меняется: с какой оттолкнулся, с такой и летишь.
       Иначе рывок, кончившийся посреди прыжка, укорачивает полёт — и бегун
       падает в яму, которую по всем расчётам перелетал. На крыльях правило
       не действует: там полёт и есть способ передвижения. */
    get speed() {
      if (this.powers.wings > 0) return this.groundSpeed;
      return this.onGround ? this.groundSpeed : this.airSpeed;
    }

    get bodyHeight() {
      return this.sliding > 0 ? SLIDE_H : BODY_H;
    }

    get invulnerable() {
      return this.powers.dash > 0 || this.powers.wings > 0 || this.powers.фора > 0;
    }

    /* Вещь из лавки пущена в ход (кнопка на бегу). Сколько их у игрока —
       считает приложение; движок только включает действие. */
    включить(вещь) {
      if (this.over || this.doomed) return false;
      if (вещь === 'крышка') {
        if (this.powers.крышка > 0) return false;
        this.powers.крышка = КРЫШКА_ВРЕМЯ;
      } else if (вещь === 'фора') {
        if (this.powers.фора > 0) return false;
        this.powers.фора = ФОРА_ВРЕМЯ;
        this.powers.magnet = Math.max(this.powers.magnet, ФОРА_ВРЕМЯ);
      } else return false;
      this.events.push({ type: 'power', kind: вещь });
      return true;
    }

    /* Ввод копится в буфер: нажатие, сделанное чуть раньше нужного мгновения,
       срабатывает, когда мгновение наступит. Без этого игра кажется тугой. */
    input(action) {
      /* Лежачий не управляется: пока бегун поднимается, нажатия пропадают.
         Иначе накопленный за падение прыжок срабатывал сразу после подъёма —
         в тот самый миг, когда игрок уже смотрел на следующее препятствие. */
      if (this.fallen > 0 || this.doomed) return;
      if (action === 'left') this.buffer.lane = -1;
      else if (action === 'right') this.buffer.lane = 1;
      else if (action === 'jump') this.buffer.jump = INPUT_BUFFER;
      else if (action === 'slide') this.buffer.slide = INPUT_BUFFER;
    }

    update(dt) {
      if (this.over) return this.events;
      this.events = [];
      let left = Math.min(dt, MAX_FRAME);
      while (left > 0) {
        const step = Math.min(STEP, left);
        this.tick(step);
        left -= step;
        if (this.over) break;
      }
      return this.events;
    }

    tick(dt) {
      this.time += dt;

      for (const kind of Object.keys(this.powers)) {
        if (this.powers[kind] <= 0) continue;
        if (kind === 'wings' && this.holdWings(dt)) {
          /* Досыпать — только пока он наверху: ожидание бывает и на снижении
             у самой земли, и монеты в трёх метрах над ним там ни к чему. */
          if (this.y > WINGS_Y - 0.3) {
            this.track.досыпатьНебо(this.z, this.speed, this.lane);
            this.ждётМеста = true;
          }
          continue;
        }
        /* Дождался — снижается: досыпанные впереди монеты опускаются вместе с ним. */
        if (kind === 'wings' && this.ждётМеста) {
          this.ждётМеста = false;
          this.track.опуститьНебо(this.z, this.speed, this.y);
        }
        this.powers[kind] = Math.max(0, this.powers[kind] - dt);
        if (this.powers[kind] === 0) {
          if (kind === 'wings') this.grace = WINGS_GRACE;
          if (kind === 'фора') this.расчистить();
          this.events.push({ type: 'power-out', kind });
        }
      }
      if (this.stumble > 0) this.stumble = Math.max(0, this.stumble - dt);
      if (this.grace > 0) this.grace = Math.max(0, this.grace - dt);

      /* Падение и подъём. Пока идёт этот счёт, бегун не слушается и не бежит,
         зато и спрашивать с него нельзя: grace держит его невредимым, иначе
         лежачий подобрал бы второе надгробие, не успев подняться. */
      if (this.fallen > 0 && !this.doomed) {
        this.fallen = Math.max(0, this.fallen - dt);
        if (this.fallen === 0) {
          this.stumble = STUMBLE_TIME;
          this.grace = Math.max(this.grace, FALL_GRACE);
          this.events.push({ type: 'stand', lives: this.lives });
        }
      }

      /* Третье падение: подниматься уже не с чего, тварь доходит сама. */
      if (this.doomed) {
        this.caught = Math.max(0, this.caught - dt);
        if (this.caught === 0) this.finish('caught');
      }

      /* Рывок не включается и не гаснет мгновенно. Резкий скачок скорости
         обрывал прыжок на полпути: бегун отталкивался по одному расчёту,
         а летел уже по другому. */
      const wanted = this.powers.фора > 0 ? ФОРА_СКОРОСТЬ : this.powers.dash > 0 ? DASH_SPEED : 1;
      this.boost += (wanted - this.boost) * Math.min(1, dt / DASH_RAMP);
      if (this.buffer.jump > 0) this.buffer.jump -= dt;
      if (this.buffer.slide > 0) this.buffer.slide -= dt;

      this.applyLane(dt);
      this.applyVertical(dt);

      this.z += this.speed * dt;
      this.track.buildTo(this.z + 260);
      this.advanceWalkers(dt);

      this.collide();
      this.collect();

      /* Где тварь. Место считается от числа падений, а не копится само:
         полоса делится на три, и по ней всегда видно, сколько ошибок осталось.
         Пока бегун на земле, тварь подступает ближе положенного — и отходит
         обратно, когда он снова бежит. */
      const base = Math.min(1, CHASE_BASE + (1 - CHASE_BASE) * (this.hits / LIVES));
      const target = this.doomed ? 1 : Math.min(0.97, base + (this.fallen > 0 ? CHASE_CLOSE : 0));
      this.chase += (target - this.chase) * Math.min(1, dt / CHASE_EASE);

      if (this.z - 40 > 0) this.track.forget(this.z - 40);
    }

    applyLane(dt) {
      if (this.buffer.lane !== 0) {
        const next = this.lane + this.buffer.lane;
        if (next >= -1 && next <= 1) {
          this.lane = next;
          this.events.push({ type: 'lane', lane: this.lane });
        }
        this.buffer.lane = 0;
      }
      const target = this.lane * LANE_W;
      const move = LANE_SPEED * dt;
      if (Math.abs(target - this.x) <= move) this.x = target;
      else this.x += Math.sign(target - this.x) * move;
    }

    applyVertical(dt) {
      /* Прыжок прерывает крылья на снижении. Без этого права бегун беспомощен
         ровно тогда, когда беспомощным быть нельзя: бонус гаснет над ямой,
         а оттолкнуться нечем. */
      if (this.powers.wings > 0 && this.buffer.jump > 0 && this.y <= 1.5) {
        this.powers.wings = 0;
        this.wingsHold = WINGS_HOLD;
        this.vy = JUMP_V;                 // не срыв, а полноценный толчок
        this.onGround = false;
        this.airTime = COYOTE;
        this.airSpeed = this.groundSpeed;
        this.buffer.jump = 0;
        this.events.push({ type: 'power-out', kind: 'wings' });
        this.events.push({ type: 'jump' });
      }

      if (this.powers.wings > 0) {
        /* Крылья не обрываются в воздухе: последнюю секунду бегун снижается сам.
           Иначе падение с трёх метров приходилось ровно на край ямы, и оттолкнуться
           он уже не успевал — гибель, которой нельзя было избежать. */
        /* Снижаться начинаем не по часам, а когда есть куда сесть. Решение
           не переигрывается на полпути: прежде бегун шёл вниз, замечал
           препятствие на дальнем краю обзора и снова взмывал вверх. На
           быстром беге (с 20.09.2026 старт 12,5 м/с) это повторялось по
           нескольку раз за полёт, полёт затягивался, и монеты кончались
           задолго до посадки. Начав снижение, он возвращается наверх, только
           если препятствие совсем близко. */
        const обзор = this.wingsLanding ? this.speed * 0.5 : this.speed * 1.2;
        const waiting = this.wingsHold < WINGS_HOLD && this.pathBusy(обзор);
        const target = (this.powers.wings > WINGS_LANDING || waiting) ? WINGS_Y : 0;
        if (target === 0) this.wingsLanding = true;
        else if (this.y > WINGS_Y - 0.2) this.wingsLanding = false;
        this.y += (target - this.y) * Math.min(1, dt * 7);
        this.vy = 0;
        this.sliding = 0;

        /* Коснулся земли — крылья своё отработали, и бегун снова распоряжается
           собой. Пока бонус формально не кончился, он не мог ни прыгнуть, ни
           подкатиться: висел в паре сантиметров над мостовой и ждал удара. */
        if (target === 0 && this.y <= 0.08) {
          this.powers.wings = 0;
          this.grace = WINGS_GRACE;
          this.y = 0;
          this.onGround = true;
          this.airTime = 0;
          this.airSpeed = this.groundSpeed;
          this.events.push({ type: 'power-out', kind: 'wings' });
        } else {
          this.onGround = false;
        }
        return;
      }

      this.ground = this.groundAt();

      /* Подкат живёт своим сроком, но прыжком его можно оборвать. */
      if (this.sliding > 0) this.sliding = Math.max(0, this.sliding - dt);

      const canJump = this.onGround || this.airTime < COYOTE;
      if (this.buffer.jump > 0 && canJump) {
        this.vy = JUMP_V;
        this.sliding = 0;
        this.onGround = false;
        this.buffer.jump = 0;
        this.airTime = COYOTE;          // поблажка тратится прыжком: второго в воздухе нет
        this.events.push({ type: 'jump' });
      }

      if (this.buffer.slide > 0) {
        this.buffer.slide = 0;
        if (this.onGround) {
          this.sliding = SLIDE_TIME;
          this.events.push({ type: 'slide' });
        } else {
          this.vy = Math.min(this.vy, 0) + FAST_FALL * 0.12;   // рывок к земле
        }
      }

      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;

      if (this.y <= this.ground) {
        if (!this.onGround && this.vy < -1) this.events.push({ type: 'land' });
        this.y = this.ground;
        this.vy = 0;
        this.onGround = true;
        this.airTime = 0;
      } else {
        this.onGround = false;
        this.airTime += dt;
      }

      if (this.onGround) this.airSpeed = this.groundSpeed;
    }

    /* На какой дорожке бегун находится на самом деле. Пока он не пересёк
       середину промежутка, он ещё на прежней: перестроение не даёт мгновенной
       неуязвимости, уходить от склепа нужно заранее. */
    get occupiedLane() {
      const lane = Math.round(this.x / LANE_W);
      return lane < -1 ? -1 : (lane > 1 ? 1 : lane);
    }

    /* Высота поверхности под бегуном: мостовая или крыша катафалка. */
    groundAt() {
      const front = this.z;
      const lane = this.occupiedLane;
      for (const o of this.track.obstacles) {
        if (!o.roof || o.lane !== lane) continue;
        const z0 = o.z + o.offset;
        if (front >= z0 && front <= z0 + o.len) {
          /* Встать на крышу можно, только если бегун уже выше неё. */
          if (this.y >= o.h - 0.12) return o.h;
        }
      }
      return 0;
    }

    advanceWalkers(dt) {
      for (const o of this.track.obstacles) {
        if (o.speed <= 0) continue;
        if (o.offset <= 0) continue;                   // дошёл до своего места и встал
        o.offset = Math.max(0, o.offset - speedAt(o.z) * o.speed * dt);
      }
    }

    /* Столкновения. Бегун — прямоугольник по x и y, точка по z: шаг счёта
       мелкий, сквозь препятствие не проскочить. */
    collide() {
      const top = this.y + this.bodyHeight;
      const lane = this.occupiedLane;

      for (const o of this.track.obstacles) {
        if (o.lane !== lane) continue;
        const z0 = o.z + o.offset;
        if (this.z < z0 || this.z > z0 + o.len) continue;

        if (o.pit) {
          /* Яма: беда не в том, что во что-то врезался, а в том, что не летел. */
          if (this.y > PIT_DEPTH) continue;
        } else if (o.bottom) {
          /* Паутина: под ней проходишь подкатом. */
          if (top <= o.bottom) continue;
        } else if (this.y >= o.h - 0.05) {
          /* Надгробие и мертвец перепрыгиваются, крыша катафалка учтена
             в groundAt — значит сюда попадает только удар в борт. */
          continue;
        }

        this.hit(o);
        return;
      }
    }

    hit(obstacle) {
      /* Мгновение после посадки на крыльях: бегун ещё не успел разобраться,
         где очутился, и спрашивать с него рано. */
      if (this.grace > 0) return;
      if (this.invulnerable) {
        /* Катафалк форы сносит всё, что не яма. */
        if (this.powers.фора > 0 && !obstacle.pit) {
          obstacle.offset = -1e6;
          this.events.push({ type: 'smash', kind: obstacle.kind });
          return;
        }
        if (this.powers.dash > 0 && obstacle.kind === 'zombie') {
          /* Рывок сносит мертвецов, а не спотыкается о них. */
          obstacle.offset = -1e6;
          this.events.push({ type: 'smash', kind: obstacle.kind });
        }
        return;
      }
      /* Крышка гроба принимает удар первой — щит остаётся про запас. */
      if (this.powers.крышка > 0) {
        this.powers.крышка = 0;
        obstacle.offset = -1e6;
        this.grace = Math.max(this.grace, 0.6);
        this.events.push({ type: 'board-break' });
        return;
      }
      if (this.powers.shield > 0) {
        this.powers.shield = 0;
        obstacle.offset = -1e6;
        this.events.push({ type: 'shield-break' });
        return;
      }

      this.hits++;
      obstacle.offset = -1e6;             // убрать с пути, чтобы не бить дважды

      /* Удар сбивает с ног, где бы бегун ни был: прыжок обрывается, подкат
         кончается, набранные нажатия пропадают. */
      this.fallen = FALL_DOWN + FALL_UP;
      this.stumble = 0;
      this.sliding = 0;
      this.buffer = { lane: 0, jump: 0, slide: 0 };
      this.y = this.ground;
      this.vy = 0;
      this.onGround = true;
      this.airTime = 0;
      this.airSpeed = this.groundSpeed;
      /* Лежачего не бьют: пока он на земле и первый миг после подъёма,
         остальные препятствия проходят сквозь него. */
      this.grace = FALL_DOWN + FALL_UP + FALL_GRACE;

      this.events.push({ type: 'hit', kind: obstacle.kind, hits: this.hits, lives: this.lives });

      if (this.hits >= LIVES) {
        this.doomed = true;
        this.caught = CAUGHT_HOLD;
        this.events.push({ type: 'doomed' });
      }
    }

    collect() {
      const reach = this.powers.magnet > 0 ? MAGNET_RANGE : 0.95;
      /* В полёте берут шире по высоте: бегун идёт по своей кривой, монеты
         по своей, и на взлёте с посадкой они расходятся на метр — при жёстких
         1,35 м половина воздушной дорожки пролетала мимо рук. */
      /* На бегу рука достаёт невысоко: поднятые над дорогой монеты берутся
         только в прыжке (владелец, 20.09.2026: «бежишь — и всё равно
         собираешь, тогда зачем они подняты»). Было 1,35 — дуга собиралась
         целиком с земли. */
      const reachY = this.powers.magnet > 0 ? 3.2 : (this.powers.wings > 0 ? 3.0 : 0.6);

      for (const p of this.track.pickups) {
        if (p.taken) continue;
        if (p.z < this.z - 1.2 || p.z > this.z + 1.6) continue;
        const dx = Math.abs(this.x - p.lane * LANE_W);
        const dy = Math.abs((this.y + this.bodyHeight / 2) - p.y);
        /* Мышь берёт монеты у земли с соседней дорожки. */
        const мышью = this.мышь && p.kind === 'coin' && !p.sky && dx > reach && dx <= МЫШЬ_ДОСТАЁТ && p.y < 1.4;
        if (!мышью && (dx > reach || dy > reachY)) continue;

        p.taken = true;
        if (p.kind === 'coin') {
          this.coins += COIN_VALUE * (this.удвоитель ? 2 : 1);
          this.events.push({ type: 'coin', total: this.coins, мышь: мышью, lane: p.lane, z: p.z });
        } else if (p.kind === 'gem') {
          this.gems++;
          this.events.push({ type: 'gem', total: this.gems });
        } else {
          if (p.kind === 'wings') {
            this.wingsHold = 0;
            this.wingsLanding = false;
            this.поднятьМонеты(this.powerTime('wings'));
          }
          this.powers[p.kind] = this.powerTime(p.kind);
          this.events.push({ type: 'power', kind: p.kind });
        }
      }
    }

    /* Участок впереди чист: после форы бегун опускается на обычный ход
       посреди плотной трассы, и первая же связка в упор его бы сбила. */
    расчистить() {
      const from = this.z - 2, to = this.z + REVIVE_CLEAR;
      this.track.obstacles = this.track.obstacles.filter(o => {
        const z0 = o.z + o.offset;
        return z0 + o.len < from || z0 > to;
      });
      this.grace = Math.max(this.grace, 1.0);
    }

    /* Поднять бегуна там же, где его догнали. */
    revive() {
      this.over = false;
      this.reason = null;
      this.chase = CHASE_BASE;
      this.stumble = 0;
      this.fallen = 0;
      this.doomed = false;
      this.caught = 0;
      this.grace = REVIVE_GRACE;
      this.hits = 0;
      this.y = 0;
      this.vy = 0;
      this.sliding = 0;
      this.onGround = true;
      this.airTime = 0;
      this.airSpeed = this.groundSpeed;

      const from = this.z - 6;
      const to = this.z + REVIVE_CLEAR;
      this.track.obstacles = this.track.obstacles.filter(o => {
        const z0 = o.z + o.offset;
        return z0 + o.len < from || z0 > to;
      });
      this.events.push({ type: 'revive' });
      return this.events;
    }

    finish(reason) {
      if (this.over) return;
      this.over = true;
      this.reason = reason;
      this.events.push({ type: 'over', reason, distance: this.distance, coins: this.coins });
    }

    get distance() {
      return Math.floor(this.z);
    }

    /* Кто дышит в спину прямо сейчас. */
    get hunter() {
      return hunterAt(this.z);
    }

    /* Итог забега: монеты за дистанцию начисляются сверх собранных. */
    get reward() {
      return this.coins + Math.floor(this.distance / 25);
    }
  }

  /* ---------- Безошибочный бот ----------

     Нужен проверкам: если он врезался, значит трасса непроходима. Заодно им
     удобно гонять баланс — насколько далеко уезжает идеальная игра. */

  const PASSABLE = { grave: true, web: true, pit: true };

  /* Сколько времени прыгун проводит выше отметки h: корни уравнения полёта
     y(t) = JUMP_V·t − |G|·t²/2. Между этими двумя мгновениями препятствие
     такой высоты проходит под ногами. */
  function jumpWindow(h) {
    const g = -GRAVITY;
    const disc = JUMP_V * JUMP_V - 2 * g * h;
    if (disc <= 0) return null;                    // так высоко не прыгнуть
    const root = Math.sqrt(disc);
    return [(JUMP_V - root) / g, (JUMP_V + root) / g];
  }

  function planAction(world) {
    const speed = world.speed;
    /* Обзор шире прежнего (было speed * 0.95): на предельной скорости
       27 м/с это меньше секунды, и после объезда высокой твари бот не успевал
       ни прыгнуть, ни свернуть (20.09.2026). */
    const horizon = Math.max(16, speed * 1.3);

    /* Ближайшее препятствие на дорожке — то, чей дальний край ещё впереди. */
    const firstOn = lane => {
      let best = null;
      for (const o of world.track.obstacles) {
        if (o.lane !== lane) continue;
        const z0 = o.z + o.offset;
        if (z0 + o.len < world.z + 0.2) continue;
        if (z0 > world.z + horizon) continue;
        if (!best || z0 < best.z0) best = { o, z0 };
      }
      return best;
    };

    /* Время до встречи считается по сближению: мертвец идёт навстречу, поэтому
       сходятся быстрее, чем бежит один бегун, и прыгать надо раньше. */
    const closing = o => speed + (o.speed ? speedAt(o.z) * o.speed : 0);
    const timeTo = t => (t.z0 - world.z) / closing(t.o);

    /* На крыльях бегун неуязвим, и прыгать оттуда незачем — это было бы
       падение с трёх метров. Но одно дело в полёте есть: выбрать дорожку,
       на которую садиться. Сядешь на занятую — окажешься перед паутиной
       без разбега, а подкатиться уже не успеешь. */
    if (world.powers.wings > 0 && world.y > 1.5) {
      const mine = firstOn(world.lane);
      const mineTime = mine ? timeTo(mine) : Infinity;
      if (mineTime >= 1.4) return null;
      let best = null;
      for (const d of [-1, 1]) {
        const lane = world.lane + d;
        if (lane < -1 || lane > 1) continue;
        const next = firstOn(lane);
        const time = next ? timeTo(next) : Infinity;
        if (!best || time > best.time) best = { d, time };
      }
      if (best && best.time > mineTime + 0.4) return best.d < 0 ? 'left' : 'right';
      return null;
    }

    const here = firstOn(world.lane);
    if (!here) return null;

    const kind = here.o.kind;
    const t = timeTo(here);

    /* Мгновение отрыва. Перелететь надо не край, а всё препятствие целиком:
       к времени подъёма прибавляется время, за которое бегун его пересечёт. */
    const jumpAt = clearance => {
      const win = jumpWindow(clearance);
      if (!win) return null;
      const cross = here.o.len / closing(here.o);
      const latest = win[1] - cross - 0.05;         // позже уже не перелететь
      if (latest <= win[0]) return win[0];
      /* Толкаться в середину окна, а не в самый край: край не оставляет запаса
         ни на кадр задержки, ни на просевшую частоту. */
      return win[0] + (latest - win[0]) * 0.55;
    };

    if (kind === 'grave' || kind === 'zombie') {
      const moment = jumpAt(here.o.h + 0.06);
      if (moment !== null) {
        if (t <= moment) return 'jump';
        return null;
      }
      /* Такую высоту не перепрыгнуть (с 20.09.2026 твари в рост и выше) —
         значит, объезжаем: решение принимается ниже, вместе со склепами. */
    }
    if (kind === 'pit') {
      /* Над ямой мало взлететь — нужно продержаться в воздухе всю её длину. */
      const moment = jumpAt(PIT_DEPTH + 0.05);
      if (moment !== null && t <= moment) return 'jump';
      return null;
    }
    if (kind === 'web') {
      if (!world.onGround) return 'slide';         // в воздухе это рывок к земле
      if (t <= 0.40) return 'slide';
      return null;
    }

    /* Склеп и катафалк объезжаются. Из двух соседних дорожек выбирается та,
       где до ближайшей помехи больше времени, а помеха, которую можно взять
       прыжком или подкатом, считается лучше глухой стены. */
    const options = [];
    for (const d of [-1, 1]) {
      const lane = world.lane + d;
      if (lane < -1 || lane > 1) continue;
      const next = firstOn(lane);
      const time = next ? timeTo(next) : Infinity;
      const nextKind = next ? next.o.kind : null;
      options.push({ d, time, kind: nextKind, score: PASSABLE[nextKind] ? time + 2 : time });
    }
    options.sort((a, b) => b.score - a.score);
    const pick = options[0];

    /* Уходить заранее, если есть куда, и уходить в любом случае, когда стена
       уже близко: соседняя дорожка с помехой всё равно лучше глухого склепа. */
    if (pick && (t <= 0.3 || (t <= 0.7 && pick.score > 0.45))) {
      return pick.d < 0 ? 'left' : 'right';
    }
    /* Обе соседние заняты — остаётся крыша катафалка. Её не перелетают,
       на неё запрыгивают, поэтому важно только мгновение входа. */
    if (kind === 'hearse') {
      const win = jumpWindow(here.o.h + 0.08);
      if (win && t <= win[1] - 0.05) return 'jump';
    }
    return null;
  }

  return {
    World, Track, planAction, makeRandom, speedAt, hunterAt,
    LANE_W, LANES, STEP, OBSTACLES, HUNTERS, REVIVE_CLEAR, REVIVE_GRACE, LIVES,
    BODY_W, BODY_H, SLIDE_H, PIT_DEPTH, PIT_KINDS, MONSTER_KINDS, ТВАРИ_МЕСТ, твариМеста,
    SPEED_START, SPEED_MAX, JUMP_V, GRAVITY, WINGS_Y,
    POWER_BASE, POWER_PER_LEVEL, КРЫШКА_ВРЕМЯ, ФОРА_ВРЕМЯ, ФОРА_СКОРОСТЬ, МЫШЬ_ДОСТАЁТ
  };
});
