/* Интерфейс: отрисовка доски, ввод игроков, компьютер и игра с живым соперником.

   Главное отличие от шахмат — ход бывает многошаговым. Пока цепочка боя не
   доиграна, ход не считается сделанным: движок хранит только полные ходы,
   а интерфейс ведёт игрока по ним шаг за шагом (state.path). */
(function () {
  'use strict';

  const E = window.CheckersEngine;
  const AI = window.CheckersAI;
  const Net = window.CheckersNet;
  const Credits = window.CheckersCredits;
  const Ads = window.CheckersAds;

  const PIECES_PER_SIDE = 12;

  const LEVEL_HINTS = {
    1: 'Смотрит на пару ходов вперёд и часто зевает — для первых партий',
    2: 'Считает на четыре хода, замечает простые угрозы',
    3: 'Считает на шесть ходов вперёд, наказывает за подставленные шашки',
    4: 'Считает до десяти ходов и доигрывает размены — играет всерьёз'
  };

  const el = {};
  [
    'board', 'moves', 'statusTitle', 'statusSub', 'statusIcon', 'engineNote',
    'level', 'levelHint', 'sideSelect', 'modeSelect',
    'aiOptions', 'localOptions', 'onlineOptions', 'autoFlipSelect',
    'newGame', 'undo', 'flip', 'resign',
    'creditsLine', 'creditsAmount', 'creditsGet',
    'adOverlay', 'adTitle', 'adText', 'adWatch', 'adClose',
    'topPlayer', 'bottomPlayer', 'topName', 'bottomName', 'topAvatar', 'bottomAvatar',
    'topCaptured', 'bottomCaptured',
    'endOverlay', 'endTitle', 'endText', 'endIcon', 'endNewGame',
    'netOverlay', 'netClose', 'netMethod', 'netMethodHint', 'netColor', 'netCreate', 'netJoin',
    'netDot', 'netStatusText', 'netConnect', 'netDisconnect', 'netCopyRoom',
    'roomCode', 'roomLink', 'roomCopyLink', 'roomCopyCode', 'hostRoomStatus',
    'joinRoomCode', 'joinRoomGo', 'joinRoomStatus',
    'serverField', 'serverUrl', 'serverCheck', 'serverStatus',
    'inviteCode', 'inviteCopy', 'answerInput', 'answerApply', 'hostP2pStatus',
    'inviteInput', 'inviteApply', 'answerBlock', 'answerCode', 'answerCopy', 'joinP2pStatus'
  ].forEach(id => { el[id] = document.getElementById(id); });

  const state = {
    game: new E.Checkers(),
    mode: 'ai',            // ai | local | online
    human: 'w',            // цвет игрока в партии с компьютером
    level: 3,
    orientation: 'w',
    autoFlip: true,        // разворот доски в игре вдвоём
    path: [],              // незавершённый ход: [откуда, куда, куда дальше…]
    targets: [],           // куда можно шагнуть следующим шагом
    lastMove: null,
    moveList: [],
    thinking: false,
    finished: false,
    endReason: null,       // 'resign-me' | 'resign-opponent' | null
    generation: 0,
    net: {
      transport: null,
      status: 'idle',      // idle | connecting | waiting | live | closed
      method: 'p2p',
      myColor: 'w',
      opponentName: 'Соперник',
      room: null,
      serverAvailable: false
    }
  };

  const squares = [];

  /* ---------- Кто чем управляет ---------- */

  function controls(color) {
    if (state.mode === 'local') return true;
    if (state.mode === 'online') return color === state.net.myColor;
    return color === state.human;
  }

  function online() { return state.mode === 'online'; }
  function netLive() { return state.net.status === 'live'; }

  function canPlay() {
    if (state.thinking || state.finished) return false;
    if (online() && !netLive()) return false;
    return controls(state.game.turn);
  }

  /* Идёт ли незавершённая цепочка боя. */
  function midCapture() { return state.path.length >= 2; }

  /* ---------- Построение доски ---------- */

  function buildBoard() {
    el.board.innerHTML = '';
    squares.length = 0;
    for (let i = 0; i < 64; i++) {
      const node = document.createElement('div');
      node.className = 'square';
      node.addEventListener('click', () => onSquareClick(Number(node.dataset.index)));
      el.board.appendChild(node);
      squares.push(node);
    }
    layoutBoard();
  }

  function layoutBoard() {
    for (let visual = 0; visual < 64; visual++) {
      const index = state.orientation === 'w' ? visual : 63 - visual;
      const node = squares[visual];
      node.dataset.index = index;
      const file = E.fileOf(index), rank = E.rankOf(index);
      node.classList.toggle('light', !E.isPlaySquare(index));
      node.classList.toggle('dark', E.isPlaySquare(index));
    }
  }

  function nodeFor(index) {
    return squares.find(s => Number(s.dataset.index) === index);
  }

  /* ---------- Что показывать на доске ---------- */

  /* В середине боя доска показывается такой, какой станет: шашка уже переставлена,
     а побитые ещё стоят, но помечены — их снимут в конце хода. */
  function boardView() {
    if (midCapture()) {
      const preview = state.game.previewPath(state.path);
      return { board: preview.board, doomed: preview.doomed };
    }
    return { board: state.game.board, doomed: [] };
  }

  /* Клетки, куда можно шагнуть следующим шагом текущего хода. */
  function nextSteps() {
    if (!state.path.length) return [];
    const depth = state.path.length;
    const found = new Map();
    for (const move of state.game.continuations(state.path)) {
      if (move.path.length > depth) found.set(move.path[depth], move.captures.length > 0);
    }
    return [...found].map(([to, capture]) => ({ to, capture }));
  }

  /* Какими шашками сейчас можно ходить и обязателен ли бой.
     Ход в шашках либо есть у шашки, либо нет: подсвечивать остальные незачем. */
  function movableFrom() {
    if (state.path.length || !canPlay()) return { from: [], mustCapture: false };
    const moves = state.game.moves();
    return {
      from: [...new Set(moves.map(move => move.from))],
      mustCapture: moves.length > 0 && moves[0].captures.length > 0
    };
  }

  /* ---------- Отрисовка ---------- */

  function render() {
    const view = boardView();
    const movable = !state.thinking && !state.finished && (!online() || netLive());
    const ready = movableFrom();
    const active = state.path.length ? state.path[state.path.length - 1] : -1;

    for (const node of squares) {
      const index = Number(node.dataset.index);
      const piece = view.board[index];

      node.innerHTML = '';
      node.classList.remove('selected', 'last-move', 'must', 'selectable');

      const file = E.fileOf(index), rank = E.rankOf(index);
      const bottomRank = state.orientation === 'w' ? 7 : 0;
      const leftFile = state.orientation === 'w' ? 0 : 7;
      if (rank === bottomRank) {
        const coord = document.createElement('span');
        coord.className = 'coord file';
        coord.textContent = 'abcdefgh'[file];
        node.appendChild(coord);
      }
      if (file === leftFile) {
        const coord = document.createElement('span');
        coord.className = 'coord rank';
        coord.textContent = String(8 - rank);
        node.appendChild(coord);
      }

      if (state.lastMove && state.lastMove.path.indexOf(index) >= 0) node.classList.add('last-move');
      if (state.path.indexOf(index) >= 0) node.classList.add('selected');
      // Обязательный бой отмечаем на доске: иначе непонятно, почему тихий ход не идёт
      if (ready.mustCapture && ready.from.indexOf(index) >= 0) node.classList.add('must');

      if (piece !== E.EMPTY) {
        const color = E.colorOf(piece);
        const span = document.createElement('span');
        span.className = 'piece ' + (color === 'w' ? 'white' : 'black') +
          (E.isKingPiece(piece) ? ' king' : '') +
          (view.doomed.indexOf(index) >= 0 ? ' doomed' : '');
        span.dataset.index = String(index);

        const mine = midCapture() ? index === active : ready.from.indexOf(index) >= 0;
        const grabbable = movable && mine;
        if (grabbable) {
          span.addEventListener('pointerdown', onPointerDown);
          node.classList.add('selectable');
        }
        node.appendChild(span);
      }

      const target = state.targets.find(step => step.to === index);
      if (target) {
        node.classList.add('selectable');
        const hint = document.createElement('span');
        hint.className = 'hint' + (target.capture ? ' capture' : '');
        node.appendChild(hint);
      }
    }

    renderCaptured();
    updatePlayers();
  }

  function renderMoves() {
    if (!state.moveList.length) {
      el.moves.innerHTML = '<div class="empty">Партия ещё не начата</div>';
      return;
    }
    let html = '';
    const lastIdx = state.moveList.length - 1;
    for (let i = 0; i < state.moveList.length; i += 2) {
      const num = i / 2 + 1;
      const white = state.moveList[i];
      const black = state.moveList[i + 1];
      html += '<div class="row"><span class="num">' + num + '.</span>' +
        '<span class="san' + (i === lastIdx ? ' last' : '') + '">' + (white ? white.notation : '') + '</span>' +
        '<span class="san' + (i + 1 === lastIdx ? ' last' : '') + '">' + (black ? black.notation : '') + '</span></div>';
    }
    el.moves.innerHTML = html;
    el.moves.scrollTop = el.moves.scrollHeight;
  }

  function renderCaptured() {
    const white = state.game.count('w');
    const black = state.game.count('b');
    const lost = { w: PIECES_PER_SIDE - white.total, b: PIECES_PER_SIDE - black.total };
    const diff = lost.w - lost.b;                    // > 0 — чёрные впереди

    const paint = (node, color, advantage) => {
      let html = '';
      for (let i = 0; i < lost[color]; i++) {
        html += '<span class="chip ' + (color === 'w' ? 'white' : 'black') + '"></span>';
      }
      if (advantage > 0) html += '<span class="adv">+' + advantage + '</span>';
      node.innerHTML = html;
    };

    // Игроку показываем то, что он съел, то есть потери соперника
    const bottomColor = state.orientation;
    const topColor = E.swap(bottomColor);
    paint(el.bottomCaptured, topColor, bottomColor === 'w' ? -diff : diff);
    paint(el.topCaptured, bottomColor, topColor === 'w' ? -diff : diff);
  }

  function playerLabel(color) {
    const side = color === 'w' ? 'белые' : 'чёрные';
    if (state.mode === 'local') return (color === 'w' ? 'Игрок 1' : 'Игрок 2') + ' · ' + side;
    if (state.mode === 'online') {
      return (color === state.net.myColor ? 'Вы' : state.net.opponentName) + ' · ' + side;
    }
    return (color === state.human ? 'Вы' : 'Компьютер') + ' · ' + side;
  }

  function playerAvatar(color) {
    if (state.mode === 'local') return color === 'w' ? '⛀' : '⛂';
    if (state.mode === 'online') return color === state.net.myColor ? '🧑' : '🌐';
    return color === state.human ? '🧑' : '🤖';
  }

  function updatePlayers() {
    const bottomColor = state.orientation;
    const topColor = E.swap(bottomColor);

    el.bottomName.textContent = playerLabel(bottomColor);
    el.topName.textContent = playerLabel(topColor);
    el.bottomAvatar.textContent = playerAvatar(bottomColor);
    el.topAvatar.textContent = playerAvatar(topColor);

    el.bottomPlayer.classList.toggle('active', !state.finished && state.game.turn === bottomColor);
    el.topPlayer.classList.toggle('active', !state.finished && state.game.turn === topColor);
  }

  function setStatus(title, sub, icon) {
    el.statusTitle.textContent = title;
    el.statusSub.textContent = sub;
    if (icon) el.statusIcon.textContent = icon;
  }

  function refreshStatus() {
    const game = state.game;

    // Сдачу движок не знает — статус уже показан, не затираем его
    if (state.finished && state.endReason) {
      return { over: true, result: null, reason: 'resign' };
    }

    const status = game.status();

    if (status.over) {
      state.finished = true;
      showEnd(status);
      return status;
    }

    const moves = game.moves();
    const mustCapture = moves.length > 0 && moves[0].captures.length > 0;
    const turnName = game.turn === 'w' ? 'белых' : 'чёрных';
    const chip = game.turn === 'w' ? '⛀' : '⛂';

    if (midCapture()) {
      setStatus('Бой продолжается', 'Выберите, куда бить дальше', '⚔');
    } else if (state.thinking) {
      setStatus('Компьютер думает…', 'Идёт расчёт вариантов', '🧠');
    } else if (state.mode === 'local') {
      setStatus(mustCapture ? 'Бой обязателен' : 'Ход ' + turnName,
        mustCapture ? 'Бьют ' + turnName : 'Оба игрока ходят на этом устройстве',
        mustCapture ? '⚔' : chip);
    } else if (state.mode === 'online' && !netLive()) {
      setStatus('Нет соединения', 'Подключитесь к сопернику, чтобы начать', '🌐');
    } else if (controls(game.turn)) {
      setStatus(mustCapture ? 'Бой обязателен' : 'Ваш ход',
        mustCapture ? 'Выберите шашку, которой будете бить' : 'Выберите шашку для хода',
        mustCapture ? '⚔' : chip);
    } else if (state.mode === 'online') {
      setStatus('Ход соперника', 'Ожидание хода', '⏳');
    } else {
      setStatus('Ход компьютера', 'Ожидание ответа', '🤖');
    }
    return status;
  }

  function showEnd(status) {
    let title, text, icon;

    if (status.reason === 'resign') {
      const iResigned = state.endReason === 'resign-me';
      if (state.mode === 'local') {
        title = 'Сдача';
        text = (status.result === 'w' ? 'Чёрные' : 'Белые') + ' сдались. Победа ' +
          (status.result === 'w' ? 'белых' : 'чёрных') + '.';
        icon = '🏳';
      } else {
        title = iResigned ? 'Вы сдались' : 'Соперник сдался';
        text = iResigned ? 'Партия завершена в пользу соперника.' : 'Победа присуждена вам.';
        icon = iResigned ? '🏳' : '👑';
      }
    } else if (status.result === 'draw') {
      title = 'Ничья';
      icon = '🤝';
      text = {
        quiet: 'Пятнадцать ходов подряд играли только дамки и никто не бил.',
        threefold: 'Одна и та же позиция повторилась трижды.'
      }[status.reason] || 'Партия завершена вничью.';
    } else {
      const winnerName = status.result === 'w' ? 'Белые' : 'Чёрные';
      const how = status.reason === 'wiped'
        ? 'У соперника не осталось шашек.'
        : 'Сопернику нечем ходить — все шашки заперты.';
      if (state.mode === 'local') {
        title = winnerName + ' победили';
        text = how;
        icon = '👑';
      } else {
        const iWon = controls(status.result);
        title = iWon ? 'Победа!' : 'Поражение';
        text = how;
        icon = iWon ? '👑' : '💀';
      }
    }

    setStatus(title, text, icon);
    el.endIcon.textContent = icon;
    el.endTitle.textContent = title;
    el.endText.textContent = text;
    el.endOverlay.classList.add('open');
  }

  /* ---------- Ввод игрока ---------- */

  function resetPath() {
    state.path = [];
    state.targets = [];
  }

  function selectPiece(index) {
    const piece = state.game.board[index];
    if (piece === E.EMPTY) return false;
    if (E.colorOf(piece) !== state.game.turn || !controls(E.colorOf(piece))) return false;
    if (!state.game.moves({ from: index }).length) return false;

    state.path = [index];
    state.targets = nextSteps();
    render();
    return true;
  }

  function onSquareClick(index) {
    if (!canPlay()) return;

    if (state.targets.some(step => step.to === index)) {
      stepTo(index);
      return;
    }

    // Повторный клик по своей же шашке снимает выделение
    if (state.path.length === 1 && state.path[0] === index) {
      if (justSelected) { justSelected = false; return; }
      resetPath();
      render();
      return;
    }

    // Пока цепочка не доиграна, ход можно только продолжить или начать заново
    if (!selectPiece(index)) {
      resetPath();
      render();
    }
  }

  /* Шаг хода. Пока бой можно продолжать, ход остаётся незавершённым. */
  function stepTo(index) {
    state.path.push(index);

    const move = state.game.moveFromPath(state.path);
    const longer = state.game.continuations(state.path)
      .some(candidate => candidate.path.length > state.path.length);

    if (move && !longer) {
      applyMove(move);
      return;
    }

    if (!longer) {                       // тупик: такого хода нет, откатываем шаг
      state.path.pop();
      state.targets = nextSteps();
      render();
      return;
    }

    state.targets = nextSteps();
    refreshStatus();
    render();
  }

  /* Выполняет полный ход. options.fromNetwork — ход пришёл от соперника. */
  function applyMove(move, options) {
    const opts = options || {};
    const result = state.game.move(move.path);
    if (!result) return null;

    state.lastMove = result.move;
    state.moveList.push({ notation: result.notation, color: result.move.color });
    resetPath();

    if (online() && !opts.fromNetwork) {
      sendNet({ t: 'move', path: move.path });
    }

    if (state.mode === 'local' && state.autoFlip) {
      state.orientation = state.game.turn;
      layoutBoard();
    }

    const status = refreshAll();
    if (status.over) return result;

    if (state.mode === 'ai' && state.game.turn !== state.human) scheduleComputerMove();
    return result;
  }

  /* Полное обновление экрана после изменения позиции. */
  function refreshAll() {
    renderMoves();
    const status = refreshStatus();
    render();
    return status;
  }

  /* ---------- Перетаскивание ---------- */

  let drag = null;
  let justSelected = false;

  function onPointerDown(event) {
    if (!canPlay()) return;
    const index = Number(event.currentTarget.dataset.index);

    // В середине боя тащить можно только ту шашку, которая бьёт
    if (midCapture()) {
      if (index !== state.path[state.path.length - 1]) return;
    } else {
      justSelected = state.path.length !== 1 || state.path[0] !== index;
      if (!selectPiece(index)) return;
    }

    event.preventDefault();

    const source = nodeFor(index).querySelector('.piece');
    const rect = source.getBoundingClientRect();
    const ghost = source.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = event.clientX + 'px';
    ghost.style.top = event.clientY + 'px';
    document.body.appendChild(ghost);
    source.classList.add('dragging');

    drag = { index, ghost, source, moved: false };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(event) {
    if (!drag) return;
    drag.moved = true;
    drag.ghost.style.left = event.clientX + 'px';
    drag.ghost.style.top = event.clientY + 'px';
  }

  function onPointerUp(event) {
    if (!drag) return;
    const { index, ghost, source, moved } = drag;
    ghost.remove();
    source.classList.remove('dragging');
    drag = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);

    if (!moved) return;

    const node = document.elementFromPoint(event.clientX, event.clientY);
    const squareNode = node && node.closest ? node.closest('.square') : null;
    if (!squareNode) { render(); return; }

    const to = Number(squareNode.dataset.index);
    if (to === index) return;

    if (state.targets.some(step => step.to === to)) stepTo(to);
    else if (!midCapture()) { resetPath(); render(); }
    else render();
  }

  /* ---------- Ход компьютера ---------- */

  function scheduleComputerMove() {
    state.thinking = true;
    el.board.classList.add('thinking');
    refreshStatus();
    render();

    // Небольшая пауза, чтобы браузер успел отрисовать статус до блокирующего расчёта
    const generation = state.generation;
    setTimeout(() => computerMove(generation), 60);
  }

  function computerMove(generation) {
    if (generation !== state.generation) return;

    const best = AI.findBestMove(state.game, state.level);
    if (generation !== state.generation) return;

    state.thinking = false;
    el.board.classList.remove('thinking');

    if (!best) { refreshAll(); return; }

    el.engineNote.textContent = best.forced
      ? 'Ход вынужденный'
      : 'Глубина ' + best.depth + ' · ' + best.nodes.toLocaleString('ru-RU') +
        ' позиций · ' + best.time + ' мс';

    applyMove(best.move);
  }

  /* ---------- Партия ---------- */

  function newGame(options) {
    const opts = options || {};
    state.generation++;
    state.game = new E.Checkers();
    resetPath();
    state.lastMove = null;
    state.moveList = [];
    state.thinking = false;
    state.finished = false;
    state.endReason = null;

    if (state.mode === 'ai') state.orientation = state.human;
    else if (state.mode === 'online') state.orientation = state.net.myColor;
    else state.orientation = 'w';

    el.endOverlay.classList.remove('open');
    el.board.classList.remove('thinking');
    el.engineNote.textContent = 'Движок готов';

    if (online() && !opts.fromNetwork && netLive()) {
      sendNet({ t: 'restart' });
    }

    layoutBoard();
    updateControlsVisibility();
    refreshAll();

    if (state.mode === 'ai' && state.game.turn !== state.human) scheduleComputerMove();
  }

  function undoMove() {
    if (state.thinking || online()) return;

    // Незавершённый бой отменяем целиком, а не по шагам
    if (midCapture()) {
      resetPath();
      refreshAll();
      return;
    }

    if (!state.moveList.length) return;
    // Против компьютера отмена стоит кредит. Вдвоём за одним устройством — бесплатно.
    if (paidUndo()) {
      if (!Credits.canUndo()) { showAdOffer(true); return; }
      Credits.spendUndo();
    }

    state.generation++;

    state.game.undo();
    state.moveList.pop();

    // Против компьютера откатываем и свой ход, чтобы снова ходил игрок
    if (state.mode === 'ai' && state.moveList.length && state.game.turn !== state.human) {
      state.game.undo();
      state.moveList.pop();
    }

    state.finished = false;
    state.endReason = null;
    el.endOverlay.classList.remove('open');

    const last = state.game.history[state.game.history.length - 1];
    state.lastMove = last ? last.move : null;
    resetPath();

    if (state.mode === 'local' && state.autoFlip) state.orientation = state.game.turn;

    layoutBoard();
    const status = refreshAll();

    if (!status.over && state.mode === 'ai' && state.game.turn !== state.human) scheduleComputerMove();
  }

  /* Сдача. options.fromNetwork — сдался соперник. */
  function resign(options) {
    const opts = options || {};
    if (state.finished) return;

    const loser = opts.fromNetwork ? E.swap(state.net.myColor)
      : (state.mode === 'online' ? state.net.myColor : state.game.turn);

    state.finished = true;
    state.endReason = opts.fromNetwork ? 'resign-opponent' : 'resign-me';

    if (online() && !opts.fromNetwork) sendNet({ t: 'resign' });

    showEnd({ over: true, result: E.swap(loser), reason: 'resign' });
    render();
  }

  /* ---------- Сеть ---------- */

  function sendNet(msg) {
    const transport = state.net.transport;
    if (transport && !transport.closed) transport.send(msg);
  }

  function setNetStatus(status, text) {
    state.net.status = status;
    const labels = {
      idle: 'Соединение не установлено',
      connecting: 'Подключение…',
      waiting: 'Ожидание соперника…',
      live: 'Соперник на связи',
      closed: 'Соединение разорвано'
    };
    el.netStatusText.textContent = text || labels[status] || '';
    el.netDot.className = 'net-dot ' + status;
    el.netDisconnect.hidden = status === 'idle';
    el.netCopyRoom.hidden = !(state.net.room && status !== 'idle');
    el.netConnect.textContent = status === 'idle' || status === 'closed'
      ? 'Подключиться к сопернику' : 'Показать данные подключения';
    refreshStatus();
    render();
  }

  function attachTransport(transport, options) {
    const opts = options || {};
    state.net.transport = transport;
    state.net.myColor = opts.color || 'w';
    state.net.opponentName = opts.opponentName || 'Соперник';
    state.net.room = opts.room || null;

    transport.onOpen = () => {
      if (transport.opponentName) state.net.opponentName = transport.opponentName;
      setNetStatus('live');
      closeNetOverlay();
      // Хозяин партии объявляет распределение цветов
      if (opts.isHost) sendNet({ t: 'hello', color: state.net.myColor });
      state.orientation = state.net.myColor;
      layoutBoard();
      newGameForNetwork();
    };

    transport.onMessage = handleNetMessage;

    transport.onClose = () => {
      setNetStatus('closed', 'Соперник отключился');
    };

    transport.onError = err => {
      console.warn('Сетевая ошибка:', err);
    };
  }

  /* Новая партия при подключении — без рассылки сообщения сопернику. */
  function newGameForNetwork() {
    newGame({ fromNetwork: true });
  }

  function handleNetMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'hello') {
      // Цвет назначает хозяин партии: себе msg.color, нам — противоположный
      state.net.myColor = E.swap(msg.color);
      state.orientation = state.net.myColor;
      setNetStatus('live');
      layoutBoard();
      newGameForNetwork();
      return;
    }

    if (msg.t === 'move') {
      // Ход соперника проверяется своим движком: путь должен быть законным
      const move = state.game.moveFromPath(msg.path || []);
      if (move) applyMove(move, { fromNetwork: true });
      return;
    }

    if (msg.t === 'resign') {
      resign({ fromNetwork: true });
      return;
    }

    if (msg.t === 'restart') {
      newGame({ fromNetwork: true });
      return;
    }
  }

  function disconnect() {
    const transport = state.net.transport;
    if (transport) {
      transport.onClose = null;
      transport.close();
    }
    state.net.transport = null;
    state.net.room = null;
    setNetStatus('idle');
  }

  /* ---------- Мастер подключения ---------- */

  let netContext = null;   // данные текущей попытки подключения

  function showNetScreen(name) {
    for (const screen of el.netOverlay.querySelectorAll('.net-screen')) {
      screen.hidden = screen.dataset.screen !== name;
    }
    el.netOverlay.classList.add('open');
  }

  function closeNetOverlay() {
    el.netOverlay.classList.remove('open');
  }

  function chosenColor() {
    const active = el.netColor.querySelector('button.active');
    const value = active ? active.dataset.color : 'w';
    if (value === 'r') return Math.random() < 0.5 ? 'w' : 'b';
    return value;
  }

  function chosenMethod() {
    const active = el.netMethod.querySelector('button.active');
    return active ? active.dataset.method : 'p2p';
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const helper = document.createElement('textarea');
      helper.value = text;
      document.body.appendChild(helper);
      helper.select();
      try { document.execCommand('copy'); } catch (e) { /* браузер запретил */ }
      helper.remove();
    }
    if (button) {
      const original = button.textContent;
      button.textContent = 'Скопировано';
      setTimeout(() => { button.textContent = original; }, 1400);
    }
  }

  /* Ссылка для соперника: с адреса сервера, если игра открыта не с него (приложение) */
  function roomLink(code) {
    const base = Net.getServerBase();
    if (base) return base + '?room=' + code;
    return location.origin + location.pathname + '?room=' + code;
  }

  async function hostRoom(color) {
    setNetStatus('connecting');
    el.roomCode.textContent = '····';
    el.hostRoomStatus.textContent = 'Создаём комнату…';
    showNetScreen('host-room');

    try {
      const result = await Net.createRoom({ color, name: 'Хозяин партии' });
      const link = roomLink(result.room);
      el.roomCode.textContent = result.room;
      el.roomLink.value = link;
      el.hostRoomStatus.textContent = 'Ожидание соперника…';
      attachTransport(result.transport, { color: result.color, room: result.room, isHost: true });
      setNetStatus('waiting');
    } catch (err) {
      el.hostRoomStatus.textContent = 'Не удалось создать комнату: ' + err.message;
      setNetStatus('idle');
    }
  }

  async function joinRoom(code) {
    el.joinRoomStatus.textContent = 'Подключаемся…';
    setNetStatus('connecting');
    try {
      const result = await Net.joinRoom(code, { name: 'Соперник' });
      attachTransport(result.transport, {
        color: result.color,
        room: result.room,
        opponentName: result.opponentName
      });
      setNetStatus('live');
      state.orientation = state.net.myColor;
      layoutBoard();
      newGameForNetwork();
      closeNetOverlay();
    } catch (err) {
      el.joinRoomStatus.textContent = 'Не получилось войти: ' + err.message;
      setNetStatus('idle');
    }
  }

  async function hostPeer(color) {
    setNetStatus('connecting');
    el.inviteCode.value = 'Готовим код…';
    el.hostP2pStatus.textContent = '';
    el.answerInput.value = '';
    showNetScreen('host-p2p');

    try {
      const host = await Net.createPeerHost();
      netContext = { kind: 'p2p-host', host, color };
      el.inviteCode.value = host.invite;
      el.hostP2pStatus.textContent = 'Код готов. Ждём ответный код соперника.';
      attachTransport(host.transport, { color, isHost: true });
      setNetStatus('waiting');
    } catch (err) {
      el.inviteCode.value = '';
      el.hostP2pStatus.textContent = 'Не удалось подготовить соединение: ' + err.message;
      setNetStatus('idle');
    }
  }

  async function applyAnswer() {
    if (!netContext || netContext.kind !== 'p2p-host') return;
    const code = el.answerInput.value.trim();
    if (!code) {
      el.hostP2pStatus.textContent = 'Вставьте ответный код соперника.';
      return;
    }
    el.hostP2pStatus.textContent = 'Устанавливаем соединение…';
    try {
      await netContext.host.accept(code);
      el.hostP2pStatus.textContent = 'Соединение устанавливается…';
    } catch (err) {
      el.hostP2pStatus.textContent = 'Код не подошёл: ' + err.message;
    }
  }

  async function joinPeer() {
    const code = el.inviteInput.value.trim();
    if (!code) {
      el.joinP2pStatus.textContent = 'Вставьте код приглашения.';
      return;
    }
    el.joinP2pStatus.textContent = 'Готовим ответный код…';
    setNetStatus('connecting');

    try {
      const guest = await Net.createPeerGuest(code);
      netContext = { kind: 'p2p-guest', guest };
      el.answerCode.value = guest.answer;
      el.answerBlock.hidden = false;
      el.joinP2pStatus.textContent = 'Отправьте код сопернику и дождитесь начала партии.';
      attachTransport(guest.transport, { color: 'b' });
      setNetStatus('waiting');
    } catch (err) {
      el.joinP2pStatus.textContent = 'Код не подошёл: ' + err.message;
      setNetStatus('idle');
    }
  }

  function openNetWizard() {
    if (state.net.transport && state.net.status !== 'closed') {
      // Показываем данные текущего подключения
      if (state.net.room) showNetScreen('host-room');
      else if (netContext && netContext.kind === 'p2p-host') showNetScreen('host-p2p');
      else if (netContext && netContext.kind === 'p2p-guest') showNetScreen('join-p2p');
      else showNetScreen('choose');
      return;
    }
    showNetScreen('choose');
  }

  function updateNetMethodHint() {
    const method = chosenMethod();
    if (method === 'room') {
      el.netMethodHint.textContent = state.net.serverAvailable
        ? 'Соперник открывает ссылку и вводит короткий код комнаты.'
        : 'Сервер комнат не найден. Запустите server.py и укажите его адрес.';
    } else {
      el.netMethodHint.textContent = 'Обмен двумя кодами через любой мессенджер. Сервер не нужен, соединение прямое.';
    }
    // Поле адреса нужно там, где сервера рядом нет: в приложении и при открытии файлом.
    // Если адрес уже задан вручную, поле остаётся видимым — его можно поправить.
    const manual = !!Net.getServerBase();
    el.serverField.hidden = !(method === 'room' && (!state.net.serverAvailable || manual));
  }

  /* ---------- Адрес сервера комнат ---------- */

  const SERVER_KEY = 'dsd.roomServer';

  function readStoredServer() {
    try { return localStorage.getItem(SERVER_KEY) || ''; } catch (err) { return ''; }
  }

  function storeServer(url) {
    try { localStorage.setItem(SERVER_KEY, url); } catch (err) { /* приватный режим */ }
  }

  async function checkServer() {
    const entered = el.serverUrl.value.trim();
    if (!entered) {
      el.serverStatus.textContent = 'Введите адрес, по которому открывается игра на компьютере.';
      return;
    }

    const normalized = Net.setServerBase(entered);
    el.serverUrl.value = normalized.replace(/\/$/, '');
    el.serverStatus.textContent = 'Проверяем связь…';
    el.serverCheck.disabled = true;

    const available = await Net.serverAvailable();
    el.serverCheck.disabled = false;
    state.net.serverAvailable = available;

    if (available) {
      storeServer(normalized);
      el.serverStatus.textContent = 'Сервер отвечает — можно создавать комнату.';
    } else {
      Net.setServerBase('');
      el.serverStatus.textContent = 'Сервер не отвечает. Проверьте адрес, запущен ли он и в одной ли вы сети.';
    }
    updateNetMethodHint();
  }

  /* ---------- Переключение режимов ---------- */

  function updateControlsVisibility() {
    el.aiOptions.hidden = state.mode !== 'ai';
    el.localOptions.hidden = state.mode !== 'local';
    el.onlineOptions.hidden = state.mode !== 'online';

    el.undo.disabled = online();
    el.undo.title = online() ? 'В игре с соперником отмена ходов недоступна' : '';
    el.resign.hidden = state.mode === 'ai';
    el.resign.disabled = state.finished || (online() && !netLive());

    refreshCredits();
  }

  // ---------- Кредиты на отмену хода ----------

  /* Платная ли отмена в текущем режиме: только против компьютера и без премиума. */
  function paidUndo() {
    return state.mode === 'ai' && !Credits.premium;
  }

  function refreshCredits() {
    const show = paidUndo();
    el.creditsLine.hidden = !show;
    if (!show) return;

    const amount = Credits.amount;
    el.creditsAmount.textContent = amount;
    el.creditsAmount.parentElement.classList.toggle('low', amount === 0);
    el.creditsGet.hidden = !Ads.available();
  }

  /* Предложение посмотреть ролик. empty — открыто из-за нехватки кредитов. */
  function showAdOffer(empty) {
    if (!Ads.available()) {
      if (empty) {
        el.adTitle.textContent = 'Отмены закончились';
        el.adText.textContent = 'Ролики доступны в приложении для телефона — там отмены можно пополнять.';
        el.adWatch.hidden = true;
        el.adOverlay.classList.add('open');
      }
      return;
    }

    el.adWatch.hidden = false;
    el.adTitle.textContent = empty ? 'Отмены закончились' : 'Пополнить отмены';
    el.adText.textContent = `Посмотрите короткий ролик и получите ${Credits.AD_REWARD} отмены хода.`;
    el.adOverlay.classList.add('open');
  }

  async function watchAd() {
    el.adWatch.disabled = true;
    const rewarded = await Ads.showRewarded();
    el.adWatch.disabled = false;
    el.adOverlay.classList.remove('open');

    if (!rewarded) {
      setStatus('Ролик не досмотрен', 'Отмены начисляются только за полный просмотр', '⏳');
    }
    refreshCredits();
  }


  /* Группа кнопок-переключателей: подсвечивает нажатую и отдаёт её data-атрибуты. */
  function onSegment(group, handler) {
    group.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.parentElement !== group) return;
      selectSegment(group, button);
      handler(button.dataset);
    });
  }

  function selectSegment(group, button) {
    for (const item of group.children) item.classList.toggle('active', item === button);
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;

    selectSegment(el.modeSelect, [...el.modeSelect.children].find(b => b.dataset.mode === mode));

    if (mode !== 'online' && state.net.transport) disconnect();

    updateControlsVisibility();
    newGame();

    if (mode === 'online' && !state.net.transport) openNetWizard();
  }

  /* ---------- События ---------- */

  el.level.addEventListener('change', () => {
    state.level = Number(el.level.value);
    el.levelHint.textContent = LEVEL_HINTS[state.level] || '';
  });

  onSegment(el.modeSelect, data => setMode(data.mode));

  onSegment(el.sideSelect, data => {
    state.human = data.side;
    newGame();
  });

  onSegment(el.autoFlipSelect, data => {
    state.autoFlip = data.autoflip === 'on';
    if (state.autoFlip) {
      state.orientation = state.game.turn;
      layoutBoard();
      render();
    }
  });

  el.newGame.addEventListener('click', () => newGame());
  el.endNewGame.addEventListener('click', () => newGame());
  el.undo.addEventListener('click', undoMove);
  el.creditsGet.addEventListener('click', () => showAdOffer(false));
  el.adWatch.addEventListener('click', watchAd);
  el.adClose.addEventListener('click', () => el.adOverlay.classList.remove('open'));
  Credits.onChange(refreshCredits);
  el.resign.addEventListener('click', () => {
    if (state.finished) return;
    if (confirm('Сдаться и завершить партию?')) resign();
  });

  el.flip.addEventListener('click', () => {
    state.orientation = E.swap(state.orientation);
    layoutBoard();
    render();
  });

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undoMove();
    }
    if (event.key === 'Escape') {
      closeNetOverlay();
      if (state.path.length) { resetPath(); refreshAll(); }
    }
  });

  /* Мастер подключения */
  el.netConnect.addEventListener('click', openNetWizard);
  el.netClose.addEventListener('click', closeNetOverlay);
  el.netDisconnect.addEventListener('click', disconnect);
  el.netCopyRoom.addEventListener('click', () => {
    if (state.net.room) copyText(roomLink(state.net.room), el.netCopyRoom);
  });

  onSegment(el.netMethod, updateNetMethodHint);
  onSegment(el.netColor, () => {});

  el.serverCheck.addEventListener('click', checkServer);
  el.serverUrl.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); checkServer(); }
  });

  el.netCreate.addEventListener('click', () => {
    const color = chosenColor();
    if (chosenMethod() === 'room') hostRoom(color);
    else hostPeer(color);
  });

  el.netJoin.addEventListener('click', () => {
    if (chosenMethod() === 'room') {
      el.joinRoomStatus.textContent = '';
      showNetScreen('join-room');
      el.joinRoomCode.focus();
    } else {
      el.joinP2pStatus.textContent = '';
      el.answerBlock.hidden = true;
      el.inviteInput.value = '';
      showNetScreen('join-p2p');
    }
  });

  el.roomCopyLink.addEventListener('click', () => copyText(el.roomLink.value, el.roomCopyLink));
  el.roomCopyCode.addEventListener('click', () => copyText(el.roomCode.textContent, el.roomCopyCode));
  el.joinRoomGo.addEventListener('click', () => joinRoom(el.joinRoomCode.value));
  el.joinRoomCode.addEventListener('keydown', event => {
    if (event.key === 'Enter') joinRoom(el.joinRoomCode.value);
  });
  el.inviteCopy.addEventListener('click', () => copyText(el.inviteCode.value, el.inviteCopy));
  el.answerApply.addEventListener('click', applyAnswer);
  el.inviteApply.addEventListener('click', joinPeer);
  el.answerCopy.addEventListener('click', () => copyText(el.answerCode.value, el.answerCopy));

  window.addEventListener('beforeunload', () => {
    if (state.net.transport) state.net.transport.close();
  });

  /* ---------- Старт ---------- */

  async function init() {
    el.levelHint.textContent = LEVEL_HINTS[state.level];
    buildBoard();
    updateControlsVisibility();
    newGame();

    const gift = Credits.claimDailyGift();
    if (gift) setStatus('Подарок за визит', `Вам начислено ${gift} отмены хода`, '🎁');

    // Сначала пробуем сервер рядом с игрой, затем — сохранённый адрес
    state.net.serverAvailable = await Net.serverAvailable();

    if (!state.net.serverAvailable) {
      const saved = readStoredServer();
      if (saved) {
        el.serverUrl.value = saved.replace(/\/$/, '');
        Net.setServerBase(saved);
        state.net.serverAvailable = await Net.serverAvailable();
        if (!state.net.serverAvailable) Net.setServerBase('');
      }
    }

    if (state.net.serverAvailable) {
      selectSegment(el.netMethod, el.netMethod.querySelector('button[data-method="room"]'));
    }
    updateNetMethodHint();

    // Ссылка вида index.html?room=XXXX — сразу предлагаем войти
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam && state.net.serverAvailable) {
      setMode('online');
      el.joinRoomCode.value = roomParam.toUpperCase();
      showNetScreen('join-room');
      joinRoom(roomParam);
    }
  }

  init();
})();
