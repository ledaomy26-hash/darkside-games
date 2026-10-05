/* Реклама за продолжение забега.

   Здесь только посредник с одним понятным договором: «покажи ролик и скажи,
   досмотрели ли его». Игра ничего не знает про рекламные сети, а сеть ничего
   не знает про игру — поменять одно на другое можно, не трогая остального.

   Сейчас работает заглушка: вместо ролика — отсчёт на экране. Она нужна не
   для вида, а чтобы вся механика продолжения (сколько роликов, что после
   отказа, как считается второй и третий раз) была написана и проверена
   заранее — до того, как появится настоящая сеть.

   Настоящие ролики с вознаграждением живут в приложении, а не на сайте:
   в вебе такого формата по сути нет. Поэтому подключать их будем при сборке
   Android-приложения — Рекламной сетью Яндекса, а не AdMob, который из России
   не выплачивает. Тогда достаточно заменить provider на 'yandex' и написать
   один вызов в show(): всё остальное уже готово. */
(function () {
  'use strict';

  const STEP_MS = 3000;                 // столько длится заглушка одного ролика

  const overlay = document.getElementById('ad-overlay');
  const label = document.getElementById('ad-label');
  const bar = document.getElementById('ad-bar');
  const cancel = document.getElementById('ad-cancel');

  let onCancel = null;

  cancel.addEventListener('click', () => {
    if (onCancel) onCancel();
  });

  /* Показать один ролик. Возвращает обещание: true — досмотрели, false — нет. */
  function show(index, total) {
    return new Promise(resolve => {
      label.textContent = total > 1
        ? `Ролик ${index} из ${total}`
        : 'Ролик до продолжения';
      bar.style.transition = 'none';
      bar.style.width = '0%';
      overlay.hidden = false;

      /* Кадр на применение сброса — иначе полоса не поедет. */
      requestAnimationFrame(() => {
        bar.style.transition = `width ${STEP_MS}ms linear`;
        bar.style.width = '100%';
      });

      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        onCancel = null;
        overlay.hidden = true;
        resolve(ok);
      };

      const timer = setTimeout(() => finish(true), STEP_MS);
      onCancel = () => finish(false);
    });
  }

  /* Показать подряд столько роликов, сколько стоит продолжение. Отказ на любом
     из них отменяет всю покупку: половина просмотренного ничего не даёт. */
  async function showSeries(count) {
    for (let i = 1; i <= count; i++) {
      const ok = await show(i, count);
      if (!ok) return false;
    }
    return true;
  }

  window.RunnerAds = {
    provider: 'stub',
    available: () => true,
    show,
    showSeries
  };
})();
