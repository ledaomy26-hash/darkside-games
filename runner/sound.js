/* Звук «Бегуна Dark Side» — целиком синтезом, без единого файла.

   Так игра не тяжелеет, не тянет за собой чужие лицензии на сэмплы и целиком
   помещается в офлайн-кэш. Правила, которые тут соблюдены:

   - контекст создаётся лениво, при первом касании: до него браузер молчит;
   - у каждой ноты есть края огибающей, иначе на старте и обрыве слышен щелчок;
   - экспоненциальная кривая не принимает ноль, поэтому начинаем с 0.0001;
   - удар — это шум через полосовой фильтр, а не тон: чистая синусоида пищит. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RunnerSound = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Звуки места по трассам: слои по кругу [запись, громкость] и редкие
     голоса, пауза между ними — в секундах. Громкость относительно master
     (0,5): все записи выровнены по громкости (−24 LUFS слои, −18 голоса). */
  const ФОНЫ = {
    кладбище: {
      слои: [['фон-ветер', 0.45], ['фон-сверчки', 0.3]],
      разово: [['разово-ворон', 0.35], ['разово-сова', 0.4]],
      пауза: [9, 22]
    },
    подземелье: { слои: [['фон-гул', 0.55], ['фон-капель', 0.4]] },
    замок: { слои: [['фон-камин', 0.35], ['фон-сквозняк', 0.4]] }
  };

  class Sound {
    constructor() {
      this.enabled = true;
      this.ac = null;
      this.master = null;
      this.музыкаВкл = true;
      this.место = 'кладбище';
      this.источник = null;
      this.фон = null;                    // играющие слои звуков места
    }

    /* Контекст поднимается по первому звуку и просыпается после сворачивания.
       Музыке он нужен и при выключенных звуках — поэтому поднимается отдельно. */
    контекст() {
      if (!this.ac) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        this.ac = new Ctor();
        this.master = this.ac.createGain();
        this.master.gain.value = this.enabled ? 0.5 : 0;
        this.master.connect(this.ac.destination);
        this.запись('крик');               // крик нужен внезапно — разобрать заранее
      }
      if (this.ac.state === 'suspended' && !this.уснул) this.ac.resume();
      return this.ac;
    }

    wake() {
      const ac = this.контекст();
      return this.enabled ? ac : null;
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.master) this.master.gain.value = on ? 0.5 : 0;
      /* Фон — только когда контекст уже поднят касанием: при загрузке
         страницы звук без жеста браузер не пускает и ругается в консоли. */
      if (on && this.ac) this.фонИграть();
      else if (!on) this.фонСтоп();
    }

    /* Свернули вкладку — игра замолкает целиком, вместе с музыкой. */
    уснуть(да) {
      this.уснул = !!да;
      if (!this.ac) return;
      if (да) this.ac.suspend();
      else this.ac.resume();
    }

    /* ---------- Записанные звуки и музыка (30.09.2026) ----------

       Всё прочее здесь — синтез, но человеческий крик и музыку синтезом не
       сделать: они файлами (models/звук/*.mp3). В собранной странице файлы
       едут внутри неё (ЗВУКИ, адреса data:), при работе с папкой — обычными
       файлами. Откуда взяты и под какой лицензией — models/ОТКУДА ВЗЯТО.txt. */
    адрес(имя) {
      const склад = typeof self !== 'undefined' ? self.ЗВУКИ : null;
      return склад && склад[имя] ? склад[имя] : `models/звук/${имя}.mp3`;
    }

    запись(имя) {
      if (!this.записи) this.записи = {};
      if (!this.записи[имя]) {
        const ac = this.ac;
        this.записи[имя] = fetch(this.адрес(имя))
          .then(r => r.arrayBuffer())
          /* Старый Safari знает только вариант с обратными вызовами. */
          .then(buf => new Promise((ok, fail) => ac.decodeAudioData(buf, ok, fail)))
          .catch(() => { this.записи[имя] = null; return null; });
      }
      return this.записи[имя];
    }

    /* Крик бегуна, когда клыки входят в шею (владелец 30.09.2026: «крик
       бегуна, когда его кусает Дракула»). Задержка — по ходу сцены укуса. */
    scream(delay) {
      const ac = this.wake();
      if (!ac) return;
      const t0 = ac.currentTime + (delay || 0);
      const ждём = this.запись('крик');
      if (!ждём) return;
      ждём.then(buf => {
        if (!buf || !this.enabled) return;
        const src = ac.createBufferSource();
        src.buffer = buf;
        const amp = ac.createGain();
        amp.gain.value = 0.9;
        src.connect(amp); amp.connect(this.master);
        src.start(Math.max(t0, ac.currentTime));
      });
    }

    /* Музыка трассы (владелец 30.09.2026: «чтобы ты бежал не в тишине, а
       музыка играла; кому надо — выключат»). Своя громкость и свой
       выключатель — музыку и звуки выключают порознь. Играет по кругу,
       входит и уходит плавно.

       С 09.10.2026 у каждой трассы своя музыка — models/звук/музыка-<место>.mp3
       (владелец: «на кладбище музыку какую-нибудь томную… негромкую; для
       подземелья тоже что-то в этом духе, и для замка»). Три прежние темы
       Kevin MacLeod ему не понравились — убраны. Громкость ниже прежней
       (0,32 → 0,2): поверх неё ещё звуки места. */
    setMusic(on) {
      this.музыкаВкл = !!on;
      if (on) this.играть();
      else this.заглушить();
    }

    /* Трасса сменилась — и музыка, и звуки места свои. */
    сменитьМесто(место) {
      if (!место || место === this.место) return;
      this.место = место;
      if (this.источник) this.заглушить();
      this.фонСтоп();
      this.играть();
    }

    /* Зовётся на каждом касании: браузер пускает звук только после жеста. */
    играть() {
      this.фонИграть();
      if (!this.музыкаВкл || this.источник || this.грузится) return;
      const ac = this.контекст();
      if (!ac) return;
      const место = this.место;
      const ждём = this.запись('музыка-' + место);
      if (!ждём) return;
      this.грузится = true;
      ждём.then(buf => {
        this.грузится = false;
        if (!buf || !this.музыкаВкл || this.источник || место !== this.место) return;
        if (!this.музыкаГромкость) {
          this.музыкаГромкость = ac.createGain();
          this.музыкаГромкость.connect(ac.destination);
        }
        const g = this.музыкаГромкость.gain;
        g.cancelScheduledValues(ac.currentTime);
        g.setValueAtTime(0.0001, ac.currentTime);
        g.exponentialRampToValueAtTime(0.2, ac.currentTime + 2);
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(this.музыкаГромкость);
        src.start();
        this.источник = src;
      });
    }

    заглушить() {
      const src = this.источник;
      this.источник = null;
      if (!src || !this.ac) return;
      const g = this.музыкаГромкость.gain, t = this.ac.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.exponentialRampToValueAtTime(0.0001, t + 0.6);
      src.stop(t + 0.65);
    }

    /* ---------- Звуки места (09.10.2026) ----------

       Под выключателем «Звуки» (идут через master): слои по кругу, каждый
       своим источником — короткие петли разной длины не сходятся швами, —
       и редкие голоса в случайный миг то слева, то справа. Все записи —
       CC0, откуда — models/ОТКУДА ВЗЯТО.txt. Края петли срезаны на 30 мс:
       mp3 кладёт в начало и конец тишину кодировщика, и на шве был бы щелчок. */
    фонИграть() {
      if (this.фон || !this.enabled) return;
      const ac = this.контекст();
      if (!ac) return;
      const спец = ФОНЫ[this.место];
      if (!спец) return;
      const фон = this.фон = { место: this.место, источники: [], таймер: null };
      for (const [имя, громкость] of спец.слои) {
        const ждём = this.запись(имя);
        if (!ждём) continue;
        ждём.then(buf => {
          if (!buf || this.фон !== фон) return;
          const src = ac.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          src.loopStart = Math.min(0.03, buf.duration / 4);
          src.loopEnd = Math.max(src.loopStart + 0.1, buf.duration - 0.03);
          const amp = ac.createGain();
          amp.gain.setValueAtTime(0.0001, ac.currentTime);
          amp.gain.exponentialRampToValueAtTime(громкость, ac.currentTime + 3);
          src.connect(amp); amp.connect(this.master);
          /* Разные слои — с разного места петли, чтобы не начинали хором. */
          src.start(ac.currentTime, Math.random() * buf.duration * 0.8);
          фон.источники.push({ src, amp });
        });
      }
      if (спец.разово) {
        const следующий = () => {
          const [от, до] = спец.пауза;
          фон.таймер = setTimeout(() => {
            if (this.фон !== фон) return;
            if (!this.уснул && this.enabled) {
              const [имя, громкость] = спец.разово[Math.floor(Math.random() * спец.разово.length)];
              this.голос(имя, громкость);
            }
            следующий();
          }, (от + Math.random() * (до - от)) * 1000);
        };
        следующий();
      }
    }

    фонСтоп() {
      const фон = this.фон;
      this.фон = null;
      if (!фон) return;
      clearTimeout(фон.таймер);
      if (!this.ac) return;
      const t = this.ac.currentTime;
      for (const { src, amp } of фон.источники) {
        amp.gain.cancelScheduledValues(t);
        amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), t);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        src.stop(t + 0.85);
      }
    }

    /* Ворон, сова — где-то за оградой: то слева, то справа. */
    голос(имя, громкость) {
      const ac = this.wake();
      if (!ac) return;
      const ждём = this.запись(имя);
      if (!ждём) return;
      ждём.then(buf => {
        if (!buf || !this.enabled) return;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 0.92 + Math.random() * 0.16;
        const amp = ac.createGain();
        amp.gain.value = громкость * (0.7 + Math.random() * 0.3);
        let выход = amp;
        if (ac.createStereoPanner) {
          const пан = ac.createStereoPanner();
          пан.pan.value = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5);
          amp.connect(пан);
          выход = пан;
        }
        src.connect(amp); выход.connect(this.master);
        src.start();
      });
    }

    /* Одна нота: тип волны, частота, длительность, громкость и задержка. */
    tone(type, from, to, dur, gain, delay) {
      const ac = this.wake();
      if (!ac) return;
      const t0 = ac.currentTime + (delay || 0);
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t0);
      if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.3));
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(amp); amp.connect(this.master);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    }

    /* Шумовой удар через полосовой фильтр: земля, камень, падение. */
    noise(freq, q, dur, gain, delay) {
      const ac = this.wake();
      if (!ac) return;
      const t0 = ac.currentTime + (delay || 0);
      const frames = Math.max(1, Math.ceil(ac.sampleRate * dur));
      const buffer = ac.createBuffer(1, frames, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3);
      }
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = q;
      const amp = ac.createGain();
      amp.gain.setValueAtTime(gain, t0);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(band); band.connect(amp); amp.connect(this.master);
      src.start(t0);
    }

    jump()      { this.tone('triangle', 260, 520, 0.16, 0.16); }
    land()      { this.noise(180, 1.4, 0.10, 0.22); }
    slide()     { this.noise(1200, 0.8, 0.30, 0.14); }
    coin()      { this.tone('square', 880, 880, 0.06, 0.10); this.tone('square', 1320, 1320, 0.09, 0.09, 0.05); }
    gem()       { this.tone('sine', 1046, 1046, 0.12, 0.12); this.tone('sine', 1568, 1568, 0.18, 0.10, 0.08); }
    power()     { [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.11, i * 0.06)); }
    powerOut()  { this.tone('sine', 660, 330, 0.22, 0.08); }

    hit() {
      this.noise(140, 1.0, 0.22, 0.34);
      this.tone('sawtooth', 180, 90, 0.26, 0.16);
    }

    splash()    { this.noise(420, 0.7, 0.34, 0.28); this.tone('sine', 300, 120, 0.3, 0.1); }
    shieldBreak() { this.tone('square', 1200, 500, 0.2, 0.12); this.noise(2200, 1.2, 0.14, 0.12); }
    smash()     { this.noise(260, 0.9, 0.16, 0.26); }

    /* Поймали: три нисходящие ноты с портаменто — узнаваемое «уа-уа-уаа». */
    caught() {
      this.tone('sawtooth', 415, 392, 0.28, 0.18, 0);
      this.tone('sawtooth', 370, 349, 0.28, 0.18, 0.26);
      this.tone('sawtooth', 330, 233, 0.55, 0.20, 0.52);
    }

    /* Рекорд: восходящая фанфара по трезвучию. */
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.16, i * 0.11));
    }

    buy()       { this.tone('triangle', 660, 990, 0.14, 0.14); this.tone('triangle', 990, 1320, 0.16, 0.12, 0.1); }
    deny()      { this.tone('sawtooth', 200, 150, 0.18, 0.12); }
  }

  return { Sound };
});
