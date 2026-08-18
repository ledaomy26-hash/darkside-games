/* Звуковые сигналы: стук шашки, бой, исход партии.

   Звук синтезируется на месте через Web Audio — файлов нет вовсе. Это держит
   игру офлайновой, не добавляет веса приложению и снимает вопрос лицензий на
   чужие сэмплы.

   Браузеры не дают запускать звук до первого касания страницы, поэтому
   контекст создаётся лениво — на первом же сигнале после хода игрока. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckersSound = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'darkside-checkers-sound';

  let ctx = null;
  let enabled = loadEnabled();

  function loadEnabled() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === '1';
    } catch (err) {
      return true;   // приватный режим — просто звучим
    }
  }

  function saveEnabled(value) {
    try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (err) { /* приватный режим */ }
  }

  function context() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch (err) { return null; }
    return ctx;
  }

  /* Одна нота с мягкими краями: резкий старт и обрыв дают щелчок. */
  function tone(at, freq, duration, volume, type) {
    const ac = context();
    if (!ac) return;

    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, at);

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  /* Стук фигуры о доску.

     Дерево на слух — это короткий шумовой удар с быстрым затуханием плюс
     низкий призвук самой доски. Чистым тоном такое не получается: выходит
     писк, а не стук. Поэтому шум пропускается через узкую полосу около
     380 Гц — она и даёт «деревянность». */
  function knock(volume) {
    const ac = context();
    if (!ac) return;

    const at = ac.currentTime + 0.005;
    const duration = 0.11;

    const frames = Math.ceil(ac.sampleRate * duration);
    const buffer = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Куб огибающей — резкая атака и короткий хвост, как у щелчка по дереву
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3);
    }

    const noise = ac.createBufferSource();
    noise.buffer = buffer;

    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(380, at);
    band.Q.setValueAtTime(4.5, at);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    noise.connect(band);
    band.connect(gain);
    gain.connect(ac.destination);
    noise.start(at);

    // Низкий призвук: доска отзывается на удар и тон слегка проседает
    const body = ac.createOscillator();
    const bodyGain = ac.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(165, at);
    body.frequency.exponentialRampToValueAtTime(110, at + 0.06);
    bodyGain.gain.setValueAtTime(volume * 0.7, at);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    body.connect(bodyGain);
    bodyGain.connect(ac.destination);
    body.start(at);
    body.stop(at + 0.09);
  }

  /* Нота со сползающей высотой — так звучит тромбон, «уа-а». */
  function slide(at, fromFreq, toFreq, duration, volume, type) {
    const ac = context();
    if (!ac) return;

    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = type || 'sawtooth';
    osc.frequency.setValueAtTime(fromFreq, at);
    osc.frequency.exponentialRampToValueAtTime(toFreq, at + duration);

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.04);
    gain.gain.setValueAtTime(volume, at + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  /* Последовательность нот: [частота, задержка, длительность, громкость] */
  function play(notes, type) {
    if (!enabled) return;
    const ac = context();
    if (!ac) return;
    // После сворачивания вкладки контекст засыпает и молчит без единой ошибки
    if (ac.state === 'suspended') ac.resume();

    const now = ac.currentTime + 0.01;
    for (const [freq, delay, duration, volume] of notes) {
      tone(now + delay, freq, duration, volume, type);
    }
  }

  // Предупреждения звучат после стука, иначе они сливаются в кашу
  const AFTER_KNOCK = 0.13;

  return {
    /* Стук шашки о доску. Бой звучит весомее простого хода. */
    move(capture) {
      if (!enabled) return;
      const ac = context();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();
      knock(capture ? 0.34 : 0.22);
    },

    /* Конец партии вничью или вдвоём — нейтральная нисходящая фраза. */
    gameOver() {
      play([[698, AFTER_KNOCK, 0.16, 0.18],
            [587, AFTER_KNOCK + 0.15, 0.16, 0.18],
            [440, AFTER_KNOCK + 0.30, 0.42, 0.20]]);
    },

    /* Проигрыш — тот самый «уа-уа-уаа» сползающего тромбона.
       Звучит только там, где есть «вы» и «соперник»: против компьютера и по сети. */
    defeat() {
      if (!enabled) return;
      const ac = context();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();

      const now = ac.currentTime + 0.02;
      slide(now,        415, 392, 0.26, 0.16);   // уа
      slide(now + 0.30, 370, 349, 0.26, 0.16);   // уа
      slide(now + 0.60, 330, 233, 0.75, 0.18);   // уааа — вниз и долго
    },

    /* Победа — короткая восходящая фанфара. */
    victory() {
      play([[523, 0.02, 0.14, 0.16],
            [659, 0.14, 0.14, 0.16],
            [784, 0.26, 0.16, 0.17],
            [1047, 0.42, 0.40, 0.18]]);
    },

    get enabled() { return enabled; },

    set enabled(value) {
      enabled = !!value;
      saveEnabled(enabled);
    }
  };
});
