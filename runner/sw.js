/* Service worker «Бегуна Dark Side».
   Держит игру в кэше, чтобы она открывалась без интернета — а ей интернет и
   не нужен вовсе: ни счёта на сервере, ни чужих картинок.

   Меняете игру и хотите, чтобы обновление приехало ко всем гарантированно, —
   поднимите номер версии в CACHE. */

const CACHE = 'dark-side-runner-v34';   // v34 — 10.10.2026: рисованные значки вещей и красоты, цены выше, новая мышь
//   // v33 — 09.10.2026: у каждого наряда свой плюс
//   // v32 — 09.10.2026: вещи в духе Subway Surfers — крышка гроба, фора, сундук, мышь, удвоитель, награды, задания, красота
//   // v31 — 09.10.2026: у каждой трассы своя музыка и звуки места (CC0)
//   // v30 — 09.10.2026: дама в белом, горгулья, палач, шут в замке; тварей больше к дальним метрам; надгробия скол и обелиск
//   // v29 — 05.10.2026: ожившая статуя ангела в замке
//   // v28 — 04.10.2026: гончая, рудокоп, голем, доспехи; разные своды в подземелье и замке; твари тянутся к бегуну (кости.js)
// прежде: 'dark-side-runner-v27';   // v27 — 30.09.2026: музыка и крик, тестовая ссылка ?тест, глаза зомби и оборотня утоплены, своя обочина подземелья и замка, задники тоннеля и зала

const SHELL = [
  './',
  './index.html',
  './style.css',
  './engine.js',
  './render3d.js',
  './кладбище.js',
  './кости.js',
  './силуэты.js',
  './vendor/three.module.js',
  './vendor/SkeletonUtils.js',
  './vendor/GLTFLoader.js',
  './vendor/BufferGeometryUtils.js',
  './sound.js',
  './shop.js',
  './ads.js',
  './app.js',
  './pwa.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',

  /* ---------- Трёхмерные модели ----------

     Список собран по тому, что игра действительно грузит: без офлайна
     кладбище встанет голой дорогой. Меняли набор моделей — правьте и здесь,
     и версию кэша выше.

     Персонажи: девять фигур KayKit и две твари Quaternius, у каждой картинка
     внутри файла. Кладбище: полсотни предметов, у всех одна общая картинка-
     палитра — потому весь набор и весит полтора мегабайта. */

  './models/персонажи/Barbarian.glb',
  './models/персонажи/Knight.glb',
  './models/персонажи/Mage.glb',
  './models/персонажи/Rogue.glb',
  './models/персонажи/Rogue_Hooded.glb',
  './models/персонажи/Skeleton_Mage.glb',
  './models/персонажи/Skeleton_Minion.glb',
  './models/персонажи/Skeleton_Rogue.glb',
  './models/персонажи/Dracula.glb',
  './models/персонажи/Runner.glb',
  './models/персонажи/Skeleton_Warrior.glb',
  './models/персонажи/Wolf.glb',
  './models/персонажи/Zombie.glb',

  './models/кладбище/arch.bin',
  './models/кладбище/arch.gltf',
  './models/кладбище/arch_gate.bin',
  './models/кладбище/arch_gate.gltf',
  './models/кладбище/bench.bin',
  './models/кладбище/bench.gltf',
  './models/кладбище/bench_decorated.bin',
  './models/кладбище/bench_decorated.gltf',
  './models/кладбище/bone_A.bin',
  './models/кладбище/bone_A.gltf',
  './models/кладбище/bone_B.bin',
  './models/кладбище/bone_B.gltf',
  './models/кладбище/candle_triple.bin',
  './models/кладбище/candle_triple.gltf',
  './models/кладбище/coffin.bin',
  './models/кладбище/coffin.gltf',
  './models/кладбище/coffin_decorated.bin',
  './models/кладбище/coffin_decorated.gltf',
  './models/кладбище/crypt.bin',
  './models/кладбище/crypt.gltf',
  './models/кладбище/fence.bin',
  './models/кладбище/fence.gltf',
  './models/кладбище/fence_broken.bin',
  './models/кладбище/fence_broken.gltf',
  './models/кладбище/fence_gate.bin',
  './models/кладбище/fence_gate.gltf',
  './models/кладбище/fence_pillar.bin',
  './models/кладбище/fence_pillar.gltf',
  './models/кладбище/fence_pillar_broken.bin',
  './models/кладбище/fence_pillar_broken.gltf',
  './models/кладбище/fence_seperate.bin',
  './models/кладбище/fence_seperate.gltf',
  './models/кладбище/fence_seperate_broken.bin',
  './models/кладбище/fence_seperate_broken.gltf',
  './models/кладбище/floor_dirt_grave.bin',
  './models/кладбище/floor_dirt_grave.gltf',
  './models/кладбище/grave_A.bin',
  './models/кладбище/grave_A.gltf',
  './models/кладбище/grave_A_destroyed.bin',
  './models/кладбище/grave_A_destroyed.gltf',
  './models/кладбище/grave_B.bin',
  './models/кладбище/grave_B.gltf',
  './models/кладбище/gravemarker_A.bin',
  './models/кладбище/gravemarker_A.gltf',
  './models/кладбище/gravemarker_B.bin',
  './models/кладбище/gravemarker_B.gltf',
  './models/кладбище/gravestone.bin',
  './models/кладбище/gravestone.gltf',
  './models/кладбище/halloweenbits_texture.png',
  './models/кладбище/lantern_hanging.bin',
  './models/кладбище/lantern_hanging.gltf',
  './models/кладбище/lantern_standing.bin',
  './models/кладбище/lantern_standing.gltf',
  './models/кладбище/path_A.bin',
  './models/кладбище/path_A.gltf',
  './models/кладбище/path_B.bin',
  './models/кладбище/path_B.gltf',
  './models/кладбище/pillar.bin',
  './models/кладбище/pillar.gltf',
  './models/кладбище/plaque.bin',
  './models/кладбище/plaque.gltf',
  './models/кладбище/plaque_candles.bin',
  './models/кладбище/plaque_candles.gltf',
  './models/кладбище/post.bin',
  './models/кладбище/post.gltf',
  './models/кладбище/post_lantern.bin',
  './models/кладбище/post_lantern.gltf',
  './models/кладбище/post_skull.bin',
  './models/кладбище/post_skull.gltf',
  './models/кладбище/pumpkin_orange.bin',
  './models/кладбище/pumpkin_orange.gltf',
  './models/кладбище/pumpkin_orange_jackolantern.bin',
  './models/кладбище/pumpkin_orange_jackolantern.gltf',
  './models/кладбище/pumpkin_yellow_jackolantern.bin',
  './models/кладбище/pumpkin_yellow_jackolantern.gltf',
  './models/кладбище/ribcage.bin',
  './models/кладбище/ribcage.gltf',
  './models/кладбище/shrine.bin',
  './models/кладбище/shrine.gltf',
  './models/кладбище/shrine_candles.bin',
  './models/кладбище/shrine_candles.gltf',
  './models/кладбище/skull.bin',
  './models/кладбище/skull.gltf',
  './models/кладбище/skull_candle.bin',
  './models/кладбище/skull_candle.gltf',
  './models/кладбище/tree_dead_large.bin',
  './models/кладбище/tree_dead_large.gltf',
  './models/кладбище/tree_dead_large_decorated.bin',
  './models/кладбище/tree_dead_large_decorated.gltf',
  './models/кладбище/tree_dead_medium.bin',
  './models/кладбище/tree_dead_medium.gltf',
  './models/кладбище/tree_dead_small.bin',
  './models/кладбище/tree_dead_small.gltf',
  './models/кладбище/tree_pine_orange_large.bin',
  './models/кладбище/tree_pine_orange_large.gltf',
  './models/кладбище/tree_pine_orange_medium.bin',
  './models/кладбище/tree_pine_orange_medium.gltf',
  './models/кладбище/tree_pine_yellow_large.bin',
  './models/кладбище/tree_pine_yellow_large.gltf',
  './models/кладбище/tree_pine_yellow_medium.bin',
  './models/кладбище/tree_pine_yellow_medium.gltf',

  './models/готика/barrier_column.glb',
  './models/готика/column.glb',
  './models/готика/pillar_decorated.glb',
  './models/готика/rubble_half.glb',
  './models/готика/rubble_large.glb',
  './models/готика/stairs.glb',
  './models/готика/torch_lit.glb',
  './models/готика/torch_mounted.glb',
  './models/готика/wall_arched.glb',
  './models/готика/wall_archedwindow_gated.glb',
  './models/готика/wall_archedwindow_open.glb',
  './models/готика/wall_broken.glb',
  './models/готика/wall_cracked.glb',
  './models/готика/wall_pillar.glb',

  /* С 19.09.2026: нечисть и камень по картинкам владельца, текстуры камня,
     мостовой и задник с замком. */
  './models/нечисть/оборотень.glb',
  './models/нечисть/дракула.glb',
  './models/камень/ангел.glb',
  './models/камень/горгулья.glb',
  './models/камень/склеп.glb',
  './models/текстуры/cobblestone_floor_04-рельеф.webp',
  './models/текстуры/cobblestone_floor_04-цвет.webp',
  './models/текстуры/mossy_rock-цвет.webp',
  './models/текстуры/задник-замок.webp',
  /* Вечер 19.09.2026: рисованная обочина и две плиты с картинок ChatGPT. */
  './models/текстуры/обочина-дуб.webp',
  './models/текстуры/обочина-оградка.webp',
  './models/текстуры/обочина-ангел.webp',
  './models/текстуры/обочина-двойное.webp',
  './models/текстуры/обочина-склеп.webp',
  './models/текстуры/обочина-толпа.webp',
  './models/текстуры/обочина-ворота.webp',
  './models/текстуры/обочина-плакальщица.webp',
  './models/текстуры/обочина-даль.webp',
  './models/текстуры/подземелье-ниши.webp',
  './models/текстуры/подземелье-прикованный.webp',
  './models/текстуры/подземелье-решётка.webp',
  './models/текстуры/подземелье-колонна.webp',
  './models/текстуры/подземелье-гробы.webp',
  './models/текстуры/подземелье-вагонетка.webp',
  './models/текстуры/подземелье-алтарь.webp',
  './models/текстуры/подземелье-клетка.webp',
  './models/текстуры/подземелье-стена.webp',
  './models/текстуры/замок-доспехи.webp',
  './models/текстуры/замок-канделябр.webp',
  './models/текстуры/замок-люстра.webp',
  './models/текстуры/замок-стол.webp',
  './models/текстуры/замок-трон.webp',
  './models/текстуры/замок-горгулья.webp',
  './models/текстуры/замок-гроб.webp',
  './models/текстуры/замок-зеркало.webp',
  './models/текстуры/замок-стена.webp',
  './models/текстуры/задник-подземелье.webp',
  './models/текстуры/задник-зал.webp',
  './models/текстуры/задник-небо.webp',
  './models/текстуры/задник-сзади.webp',
  './models/текстуры/обочина-высокое-1.webp',
  './models/текстуры/обочина-высокое-2.webp',
  './models/текстуры/обочина-высокое-3.webp',
  './models/текстуры/обочина-высокое-4.webp',
  /* Препятствия по силуэтам с картинок ChatGPT (19.09.2026). */
  './models/текстуры/препятствие-надгробие-череп.webp',
  './models/текстуры/препятствие-надгробие-ангел.webp',
  './models/текстуры/препятствие-надгробие-крест.webp',
  './models/текстуры/препятствие-надгробие-мышь.webp',
  './models/текстуры/препятствие-ворота-1-перемычка.webp',
  './models/текстуры/препятствие-ворота-1-столб-л.webp',
  './models/текстуры/препятствие-ворота-1-столб-п.webp',
  './models/текстуры/препятствие-ворота-2-перемычка.webp',
  './models/текстуры/препятствие-ворота-2-столб-л.webp',
  './models/текстуры/препятствие-ворота-2-столб-п.webp',
  './models/текстуры/препятствие-катафалк-борт.webp',
  './models/текстуры/препятствие-катафалк-колесо.webp',
  './models/текстуры/препятствие-катафалк-крышка.webp',
  './models/текстуры/препятствие-катафалк-торец.webp',
  './models/текстуры/препятствие-паутина.webp',
  './models/текстуры/препятствие-склеп-1.webp',
  './models/текстуры/препятствие-склеп-2.webp',
  './models/текстуры/препятствие-яма-кислота.webp',
  './models/текстуры/препятствие-яма-могила.webp',
  './models/текстуры/препятствие-яма-колья.webp',
  './места.js',
  './models/нечисть/скелет.glb',
  './models/нечисть/зомби.glb',
  './models/нечисть/колдун.glb',
  './models/нечисть/мумия.glb',
  './models/нечисть/паук.glb',
  './models/нечисть/гончая.glb',
  './models/нечисть/рудокоп.glb',
  './models/нечисть/голем.glb',
  './models/нечисть/доспехи.glb',
  './models/нечисть/статуя.glb',
  './models/нечисть/дама.glb',
  './models/нечисть/горгулья-живая.glb',
  './models/нечисть/палач.glb',
  './models/нечисть/шут.glb',
  './models/нечисть/жнец.glb',
  './models/звук/крик.mp3',
  './models/звук/музыка-кладбище.mp3',
  './models/звук/музыка-подземелье.mp3',
  './models/звук/музыка-замок.mp3',
  './models/звук/фон-ветер.mp3',
  './models/звук/фон-сверчки.mp3',
  './models/звук/фон-гул.mp3',
  './models/звук/фон-капель.mp3',
  './models/звук/фон-камин.mp3',
  './models/звук/фон-сквозняк.mp3',
  './models/звук/разово-ворон.mp3',
  './models/звук/разово-сова.mp3',
  './models/текстуры/трасса-кладбище.webp',
  './models/текстуры/трасса-подземелье.webp',
  './models/текстуры/трасса-замок.webp',
  './models/текстуры/наряд-могильщик.webp',
  './models/текстуры/наряд-чумной.webp',
  './models/текстуры/наряд-неупокоенный.webp',
  './models/текстуры/наряд-охотник.webp',
  './models/текстуры/наряд-кровопийца.webp',
  './models/текстуры/наряд-костяной.webp',
  './models/текстуры/лавка-runner.webp',
  './models/текстуры/лавка-gravedigger.webp',
  './models/текстуры/лавка-plague.webp',
  './models/текстуры/лавка-ghost.webp',
  './models/текстуры/лавка-hunter.webp',
  './models/текстуры/лавка-vampire.webp',
  './models/текстуры/лавка-bones.webp',
  './models/текстуры/значок-кристалл.webp',
  './models/текстуры/значок-крылья.webp',
  './models/текстуры/значок-монета.webp',
  './models/текстуры/значок-магнит.webp',
  './models/текстуры/значок-рывок.webp',
  './models/текстуры/значок-щит.webp',
  './models/текстуры/крыло-раскрыто.webp',
  './models/текстуры/мышь-крыло-л.webp',
  './models/текстуры/мышь-тело.webp',
  './models/текстуры/мышь-крыло-п.webp',
  './models/текстуры/крыло-сложено.webp',
  './models/камень/плита-готика.glb',
  './models/камень/плита-череп.glb',
  './models/камень/плита-кельтский.glb',
  './models/камень/плита-крест.glb',
  './models/текстуры/лавка-вещь-крышка.webp',
  './models/текстуры/лавка-вещь-фора.webp',
  './models/текстуры/лавка-вещь-сундук.webp',
  './models/текстуры/лавка-вещь-мышь.webp',
  './models/текстуры/лавка-вещь-удвоитель.webp',
  './models/текстуры/лавка-след-нет.webp',
  './models/текстуры/лавка-след-искры.webp',
  './models/текстуры/лавка-след-туман.webp',
  './models/текстуры/лавка-след-кровь.webp',
  './models/текстуры/лавка-крылья-обычные.webp',
  './models/текстуры/лавка-крылья-багровые.webp',
  './models/текстуры/лавка-крылья-изумрудные.webp',
  './models/текстуры/лавка-крылья-ледяные.webp',
  './models/текстуры/лавка-свечение-нет.webp',
  './models/текстуры/лавка-свечение-лунное.webp',
  './models/текстуры/лавка-свечение-ядовитое.webp',
  './models/текстуры/лавка-свечение-адское.webp',
  './models/камень/плита-скол.glb',
  './models/камень/плита-обелиск.glb',
  './models/камень/катафалк-форы.glb'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* Поодиночке: один недоступный файл не должен рушить всю установку. */
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => (name === CACHE ? null : caches.delete(name))));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Переходы по страницам: свежая версия, если сеть есть; иначе — из кэша. */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || Response.error();
      }
    })());
    return;
  }

  /* Остальное: отдаём из кэша сразу, параллельно обновляя его. */
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    const network = fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') {
        caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    }).catch(() => null);

    return cached || (await network) || Response.error();
  })());
});
