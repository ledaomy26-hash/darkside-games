/* Сетевой слой: два способа связать двух игроков.
   1. P2P — прямое соединение WebRTC, игроки обмениваются кодами вручную.
   2. Комната — обмен сообщениями через сервер (server.ps1 / server.py) по long-polling.
   Оба способа дают одинаковый транспорт: send(), close(), onMessage/onOpen/onClose/onError. */
(function (root) {
  'use strict';

  const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];

  const SIGNAL_PREFIX_RAW = 'NFC0';
  const SIGNAL_PREFIX_ZIP = 'NFC1';

  /* ---------- Кодирование кода приглашения ---------- */

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64ToBytes(text) {
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deflate(text) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }

  /* Описание соединения (SDP) в компактную строку и обратно. */
  async function encodeSignal(description) {
    const json = JSON.stringify({ t: description.type, s: description.sdp });
    try {
      const packed = await deflate(json);
      if (packed) return SIGNAL_PREFIX_ZIP + ':' + bytesToBase64(packed);
    } catch (err) {
      /* обойдёмся без сжатия */
    }
    return SIGNAL_PREFIX_RAW + ':' + bytesToBase64(new TextEncoder().encode(json));
  }

  async function decodeSignal(code) {
    const trimmed = String(code).trim().replace(/\s+/g, '');
    const parts = trimmed.split(':');
    if (parts.length !== 2) throw new Error('Код повреждён: неверный формат');

    const bytes = base64ToBytes(parts[1]);
    let json;
    if (parts[0] === SIGNAL_PREFIX_ZIP) json = await inflate(bytes);
    else if (parts[0] === SIGNAL_PREFIX_RAW) json = new TextDecoder().decode(bytes);
    else throw new Error('Код повреждён: неизвестный формат');

    const parsed = JSON.parse(json);
    return { type: parsed.t, sdp: parsed.s };
  }

  /* ---------- Общая часть транспорта ---------- */

  function makeTransport(kind) {
    return {
      kind,
      onMessage: null,
      onOpen: null,
      onClose: null,
      onError: null,
      closed: false,
      send() { throw new Error('Транспорт не готов'); },
      close() {},
      emit(name, payload) {
        const handler = this['on' + name];
        if (handler) handler(payload);
      }
    };
  }

  /* ---------- P2P через WebRTC ---------- */

  function waitForIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check);
        clearTimeout(timer);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      pc.addEventListener('icegatheringstatechange', check);
      // Некоторые сети не завершают сбор кандидатов — не ждём дольше 5 секунд
      const timer = setTimeout(done, 5000);
    });
  }

  function attachChannel(transport, pc, channel) {
    channel.onopen = () => transport.emit('Open');
    channel.onclose = () => {
      if (transport.closed) return;
      transport.closed = true;
      transport.emit('Close');
    };
    channel.onerror = event => transport.emit('Error', event);
    channel.onmessage = event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (err) { return; }
      transport.emit('Message', msg);
    };

    transport.send = msg => {
      if (channel.readyState === 'open') channel.send(JSON.stringify(msg));
    };
    transport.close = () => {
      transport.closed = true;
      try { channel.close(); } catch (err) { /* уже закрыт */ }
      try { pc.close(); } catch (err) { /* уже закрыт */ }
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].indexOf(pc.connectionState) >= 0 && !transport.closed) {
        transport.closed = true;
        transport.emit('Close');
      }
    };
  }

  /* Хост: создаёт код приглашения, затем принимает код ответа. */
  async function createPeerHost() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('checkers', { ordered: true });
    const transport = makeTransport('p2p');
    attachChannel(transport, pc, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);

    return {
      transport,
      invite: await encodeSignal(pc.localDescription),
      async accept(answerCode) {
        await pc.setRemoteDescription(await decodeSignal(answerCode));
      }
    };
  }

  /* Гость: принимает код приглашения и отдаёт код ответа. */
  async function createPeerGuest(inviteCode) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const transport = makeTransport('p2p');

    const channelReady = new Promise(resolve => {
      pc.ondatachannel = event => {
        attachChannel(transport, pc, event.channel);
        resolve();
      };
    });

    await pc.setRemoteDescription(await decodeSignal(inviteCode));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);

    return {
      transport,
      answer: await encodeSignal(pc.localDescription),
      channelReady
    };
  }

  /* ---------- Комната на сервере ---------- */

  /* Адрес сервера комнат. Пусто — сервер раздаёт саму игру и лежит рядом с ней.
     В установленном приложении файлы локальные, поэтому адрес задаёт игрок. */
  let serverBase = '';

  function setServerBase(url) {
    serverBase = String(url || '').trim();
    if (serverBase && !/^https?:\/\//i.test(serverBase)) serverBase = 'http://' + serverBase;
    if (serverBase) serverBase = serverBase.replace(/\/+$/, '') + '/';
    return serverBase;
  }

  function getServerBase() {
    return serverBase;
  }

  function apiUrl(path) {
    const base = serverBase || location.href.replace(/[^/]*$/, '');
    return new URL('api/' + path, base).toString();
  }

  async function request(path, options) {
    const response = await fetch(apiUrl(path), options);
    if (!response.ok) throw new Error('Сервер ответил ошибкой ' + response.status);
    const data = await response.json();
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  function postJson(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  /* Отвечает ли сервер комнат: заданный игроком либо тот, что раздал страницу. */
  async function serverAvailable() {
    if (!serverBase && location.protocol === 'file:') return false;
    try {
      const data = await request('ping');
      return !!(data && data.ok);
    } catch (err) {
      return false;
    }
  }

  function makeRoomTransport(room, token, color) {
    const transport = makeTransport('room');
    transport.room = room;
    transport.color = color;

    let since = 0;
    let stopped = false;

    // Сообщение уходит строкой: сервер не разбирает содержимое, только пересылает
    transport.send = msg => {
      if (stopped) return;
      postJson('send', { room, token, msg: JSON.stringify(msg) })
        .catch(err => transport.emit('Error', err));
    };

    transport.close = () => {
      if (stopped) return;
      stopped = true;
      transport.closed = true;
      postJson('leave', { room, token }).catch(() => {});
    };

    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function loop() {
      while (!stopped) {
        try {
          const started = Date.now();
          const data = await request('poll?room=' + encodeURIComponent(room) +
            '&token=' + encodeURIComponent(token) + '&since=' + since +
            (transport.opponentJoined ? '&seen=1' : ''));
          if (stopped) return;

          if (data.opponentJoined && !transport.opponentJoined) {
            transport.opponentJoined = true;
            transport.opponentName = data.opponentName || 'Соперник';
            transport.emit('Open');
          }

          const events = data.events || [];
          for (const event of events) {
            since = Math.max(since, event.seq);
            if (!event.msg) continue;
            let msg;
            try { msg = JSON.parse(event.msg); } catch (err) { continue; }
            transport.emit('Message', msg);
          }

          if (data.opponentLeft && !transport.closed) {
            transport.closed = true;
            stopped = true;
            transport.emit('Close');
            return;
          }

          // Сервер, который отвечает сразу (без ожидания событий), опрашиваем с паузой
          if (!events.length && Date.now() - started < 1000) await pause(600);
        } catch (err) {
          if (stopped) return;
          transport.emit('Error', err);
          await pause(1500);
        }
      }
    }

    // Даём вызывающему коду назначить обработчики до первого события
    setTimeout(loop, 0);
    return transport;
  }

  /* Создать комнату. Возвращает транспорт и код для соперника. */
  async function createRoom(options) {
    const opts = options || {};
    const data = await postJson('create', { name: opts.name || 'Хозяин партии', color: opts.color || 'w' });
    const transport = makeRoomTransport(data.room, data.token, data.color);
    return { transport, room: data.room, color: data.color };
  }

  /* Войти в комнату по коду. */
  async function joinRoom(room, options) {
    const opts = options || {};
    const code = String(room).trim().toUpperCase();
    const data = await postJson('join', { room: code, name: opts.name || 'Соперник' });
    const transport = makeRoomTransport(code, data.token, data.color);
    transport.opponentJoined = true;
    transport.opponentName = data.opponentName || 'Соперник';
    return { transport, room: code, color: data.color, opponentName: transport.opponentName };
  }

  root.CheckersNet = {
    encodeSignal,
    decodeSignal,
    createPeerHost,
    createPeerGuest,
    serverAvailable,
    setServerBase,
    getServerBase,
    createRoom,
    joinRoom
  };
})(window);
