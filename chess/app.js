/* Интерфейс: отрисовка доски, ввод игроков, компьютер и игра с живым соперником. */
(function () {
  'use strict';

  const E = window.ChessEngine;
  const AI = window.ChessAI;
  const Net = window.ChessNet;
  const Credits = window.ChessCredits;
  const Ads = window.ChessAds;

  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const PIECE_NAMES = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' };
  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const FULL_SET = { p: 8, n: 2, b: 2, r: 2, q: 1 };

  const LEVEL_HINTS = {
    1: 'Смотрит на один ход вперёд, часто ошибается — для первых партий',
    2: 'Считает на два хода, замечает простые угрозы',
    3: 'Считает на три хода вперёд, наказывает за зевки',
    4: 'Считает на четыре хода и доигрывает размены — играет всерьёз'
  };

  const el = {};
  [
    'board', 'moves', 'statusTitle', 'statusSub', 'statusIcon', 'engineNote',
    'level', 'levelHint', 'sideSelect', 'modeSelect',
    'aiOptions', 'localOptions', 'onlineOptions', 'autoFlipSelect', 'soundSelect',
    'newGame', 'undo', 'flip', 'resign',
    'creditsLine', 'creditsAmount', 'creditsGet',
    'adOverlay', 'adTitle', 'adText', 'adWatch', 'adClose',
    'topPlayer', 'bottomPlayer', 'topName', 'bottomName', 'topAvatar', 'bottomAvatar',
    'topCaptured', 'bottomCaptured',
    'promoOverlay', 'promoChoices', 'endOverlay', 'endTitle', 'endText', 'endIcon', 'endNewGame',
    'netOverlay', 'netClose', 'netMethod', 'netMethodHint', 'netColor', 'netCreate', 'netJoin',
    'netDot', 'netStatusText', 'netConnect', 'netDisconnect', 'netCopyRoom',
    'roomCode', 'roomLink', 'roomCopyLink', 'roomCopyCode', 'hostRoomStatus',
    'joinRoomCode', 'joinRoomGo', 'joinRoomStatus',
    'serverField', 'serverUrl', 'serverCheck', 'serverStatus',
    'inviteCode', 'inviteCopy', 'answerInput', 'answerApply', 'hostP2pStatus',
    'inviteInput', 'inviteApply', 'answerBlock', 'answerCode', 'answerCopy', 'joinP2pStatus'
  ].forEach(id => { el[id] = document.getElementById(id); });

  const state = {
    game: new E.Chess(),
    mode: 'ai',            // ai | local | online
    human: 'w',            // цвет игрока в партии с компьютером
    level: 3,
    orientation: 'w',
    autoFlip: true,        // разворот доски в игре вдвоём
    selected: null,
    targets: [],
    lastMove: null,
    moveList: [],
    thinking: false,
    hints: true,
    finished: false,
    endReason: null,       // 'resign-me' | 'resign-opponent' | null
    generation: 0,
    guardeAt: -1,          // поле ферзя, по которому уже прозвучало гарде
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
      node.classList.toggle('light', (file + rank) % 2 === 0);
      node.classList.toggle('dark', (file + rank) % 2 === 1);
    }
  }

  function nodeFor(index) {
    return squares.find(s => Number(s.dataset.index) === index);
  }

  /* ---------- Отрисовка ---------- */

  function render() {
    const game = state.game;
    const checkedKing = game.inCheck(game.turn) ? game.kings[game.turn] : -1;
    const movable = !state.thinking && !state.finished && (!online() || netLive());

    for (const node of squares) {
      const index = Number(node.dataset.index);
      const piece = game.board[index];

      node.innerHTML = '';
      node.classList.remove('selected', 'last-move', 'check', 'selectable');

      const file = E.fileOf(index), rank = E.rankOf(index);
      const bottomRank = state.orientation === 'w' ? 7 : 0;
      const leftFile = state.orientation === 'w' ? 0 : 7;
      if (rank === bottomRank) {
        const c = document.createElement('span');
        c.className = 'coord file';
        c.textContent = 'abcdefgh'[file];
        node.appendChild(c);
      }
      if (file === leftFile) {
        const c = document.createElement('span');
        c.className = 'coord rank';
        c.textContent = String(8 - rank);
        node.appendChild(c);
      }

      if (state.lastMove && (index === state.lastMove.from || index === state.lastMove.to)) {
        node.classList.add('last-move');
      }
      if (index === checkedKing) node.classList.add('check');
      if (state.selected === index) node.classList.add('selected');

      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece ' + (piece.color === 'w' ? 'white' : 'black');
        span.textContent = GLYPH[piece.type];
        span.dataset.index = String(index);
        if (movable && controls(piece.color) && piece.color === game.turn) {
          span.addEventListener('pointerdown', onPointerDown);
          node.classList.add('selectable');
        }
        node.appendChild(span);
      }

      const target = state.targets.find(m => m.to === index);
      if (target) {
        node.classList.add('selectable');
        if (state.hints) {
          const hint = document.createElement('span');
          hint.className = 'hint' + (target.captured ? ' capture' : '');
          node.appendChild(hint);
        }
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
        '<span class="san' + (i === lastIdx ? ' last' : '') + '">' + (white ? white.san : '') + '</span>' +
        '<span class="san' + (i + 1 === lastIdx ? ' last' : '') + '">' + (black ? black.san : '') + '</span></div>';
    }
    el.moves.innerHTML = html;
    el.moves.scrollTop = el.moves.scrollHeight;
  }

  function renderCaptured() {
    const counts = { w: {}, b: {} };
    for (const p of state.game.board) {
      if (!p || p.type === 'k') continue;
      counts[p.color][p.type] = (counts[p.color][p.type] || 0) + 1;
    }

    const lost = color => {
      const list = [];
      let value = 0;
      for (const type of ['q', 'r', 'b', 'n', 'p']) {
        const missing = FULL_SET[type] - (counts[color][type] || 0);
        for (let i = 0; i < missing; i++) list.push(type);
        value += Math.max(0, missing) * VALUES[type];
      }
      return { color, list, value };
    };

    const whiteLost = lost('w');
    const blackLost = lost('b');
    const diff = whiteLost.value - blackLost.value;   // > 0 — чёрные впереди

    const paint = (node, lostByOwner, advantage) => {
      node.innerHTML = lostByOwner.list
        .map(t => '<span class="piece ' + (lostByOwner.color === 'w' ? 'white' : 'black') + '">' + GLYPH[t] + '</span>')
        .join('') + (advantage > 0 ? '<span class="adv">+' + advantage + '</span>' : '');
    };

    const bottomColor = state.orientation;
    const topColor = E.swap(bottomColor);
    const byColor = { w: whiteLost, b: blackLost };

    paint(el.bottomCaptured, byColor[topColor], bottomColor === 'w' ? -diff : diff);
    paint(el.topCaptured, byColor[bottomColor], topColor === 'w' ? -diff : diff);
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
    if (state.mode === 'local') return color === 'w' ? '♔' : '♚';
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

    const check = status.reason === 'check';
    const turnName = game.turn === 'w' ? 'белых' : 'чёрных';

    if (state.thinking) {
      setStatus('Компьютер думает…', 'Идёт расчёт вариантов', '🧠');
    } else if (state.mode === 'local') {
      setStatus('Ход ' + turnName,
        check ? 'Королю объявлен шах' : 'Оба игрока ходят на этом устройстве',
        check ? '⚠' : (game.turn === 'w' ? '♙' : '♟'));
    } else if (state.mode === 'online' && !netLive()) {
      setStatus('Нет соединения', 'Подключитесь к сопернику, чтобы начать', '🌐');
    } else if (controls(game.turn)) {
      setStatus(check ? 'Вам шах!' : 'Ваш ход',
        check ? 'Нужно защитить короля' : 'Выберите фигуру для хода',
        check ? '⚠' : '♟');
    } else if (state.mode === 'online') {
      setStatus('Ход соперника', check ? 'Соперник под шахом' : 'Ожидание хода', '⏳');
    } else {
      setStatus('Ход компьютера', check ? 'Компьютер под шахом' : 'Ожидание ответа', '🤖');
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
    } else if (status.reason === 'checkmate') {
      const winnerName = status.result === 'w' ? 'Белые' : 'Чёрные';
      if (state.mode === 'local') {
        title = winnerName + ' победили';
        text = 'Мат. Партия завершена.';
        icon = '👑';
      } else {
        const iWon = controls(status.result);
        title = iWon ? 'Победа!' : 'Поражение';
        text = 'Мат. ' + winnerName + ' выиграли партию.';
        icon = iWon ? '👑' : '💀';
      }
    } else {
      title = 'Ничья';
      icon = '🤝';
      text = {
        stalemate: 'Пат — у стороны нет ходов, но шаха нет.',
        material: 'Недостаточно материала для мата.',
        fifty: 'Правило 50 ходов без взятий и ходов пешками.',
        threefold: 'Троекратное повторение позиции.'
      }[status.reason] || 'Партия завершена вничью.';
    }

    setStatus(title, text, icon);
    el.endIcon.textContent = icon;
    el.endTitle.textContent = title;
    el.endText.textContent = text;
    el.endOverlay.classList.add('open');
  }

  /* ---------- Ввод игрока ---------- */

  function selectSquare(index) {
    const piece = state.game.board[index];
    if (!piece || piece.color !== state.game.turn || !controls(piece.color)) return false;
    state.selected = index;
    state.targets = state.game.moves({ from: index });
    render();
    return true;
  }

  function clearSelection() {
    state.selected = null;
    state.targets = [];
  }

  function onSquareClick(index) {
    if (!canPlay()) return;

    const target = state.targets.find(m => m.to === index);
    if (target) {
      tryMove(state.selected, index);
      return;
    }

    if (state.selected === index && justSelected) {
      justSelected = false;
      return;
    }

    if (state.selected === index) {
      clearSelection();
      render();
      return;
    }

    if (!selectSquare(index)) {
      clearSelection();
      render();
    }
  }

  function tryMove(from, to) {
    const candidates = state.game.moves({ from }).filter(m => m.to === to);
    if (!candidates.length) return;

    if (candidates[0].promotion) {
      askPromotion(state.game.turn, choice => {
        if (choice) applyMove(from, to, choice);
        else { clearSelection(); render(); }
      });
      return;
    }
    applyMove(from, to, null);
  }

  /* Поле ферзя той стороны, которой сейчас ходить, если он под боем. Иначе -1.
     Ферзей после превращения пешек бывает несколько — хватит и первого. */
  function queenUnderAttack() {
    const game = state.game;
    const owner = game.turn;
    const foe = E.swap(owner);
    for (let sq = 0; sq < 64; sq++) {
      const piece = game.board[sq];
      if (piece && piece.color === owner && piece.type === E.QUEEN &&
          game.isAttacked(sq, foe)) {
        return sq;
      }
    }
    return -1;
  }

  /* Звуковое предупреждение после хода.

     Шах перекрывает гарде: пока король под боем, защищать ферзя всё равно
     нельзя. Повторно о том же ферзе не сигналим — иначе, если игрок его
     не увёл, сигнал звучал бы после каждого хода. */
  function announce(status) {
    const sound = window.ChessSound;
    if (!sound) return;

    if (status.over) {
      if (status.reason === 'checkmate') sound.checkmate();
      state.guardeAt = -1;
      return;
    }

    if (status.reason === 'check') {
      sound.check();
      state.guardeAt = -1;
      return;
    }

    const queen = queenUnderAttack();
    if (queen < 0) {
      state.guardeAt = -1;      // угроза снята — следующая прозвучит заново
      return;
    }
    if (queen !== state.guardeAt) {
      sound.guarde();
      state.guardeAt = queen;
    }
  }

  /* Выполняет ход. options.fromNetwork — ход пришёл от соперника. */
  function applyMove(from, to, promotion, options) {
    const opts = options || {};
    const result = state.game.move(from, to, promotion);
    if (!result) return null;

    state.lastMove = result.move;
    state.moveList.push({ san: result.san, color: result.move.color });
    clearSelection();

    if (window.ChessSound) window.ChessSound.move(!!result.move.captured);

    if (online() && !opts.fromNetwork) {
      sendNet({ t: 'move', from, to, promotion: promotion || null });
    }

    if (state.mode === 'local' && state.autoFlip) {
      state.orientation = state.game.turn;
      layoutBoard();
    }

    const status = refreshAll();
    announce(status);
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
    const piece = state.game.board[index];
    if (!piece || piece.color !== state.game.turn || !controls(piece.color)) return;

    event.preventDefault();
    justSelected = state.selected !== index;
    selectSquare(index);

    const source = nodeFor(index).querySelector('.piece');
    const ghost = document.createElement('span');
    ghost.className = 'drag-ghost piece ' + (piece.color === 'w' ? 'white' : 'black');
    ghost.textContent = GLYPH[piece.type];
    ghost.style.fontSize = getComputedStyle(source).fontSize;
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
    if (!squareNode) { clearSelection(); render(); return; }

    const to = Number(squareNode.dataset.index);
    if (to === index) return;

    if (state.targets.some(m => m.to === to)) tryMove(index, to);
    else { clearSelection(); render(); }
  }

  /* ---------- Превращение пешки ---------- */

  function askPromotion(color, callback) {
    el.promoChoices.innerHTML = '';
    for (const type of ['q', 'r', 'b', 'n']) {
      const button = document.createElement('button');
      button.className = color === 'w' ? 'white' : 'black';
      button.textContent = GLYPH[type];
      button.title = PIECE_NAMES[type];
      button.addEventListener('click', () => {
        el.promoOverlay.classList.remove('open');
        callback(type);
      });
      el.promoChoices.appendChild(button);
    }
    el.promoOverlay.classList.add('open');
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

    el.engineNote.textContent = 'Глубина ' + best.depth + ' · ' +
      best.nodes.toLocaleString('ru-RU') + ' позиций · ' + best.time + ' мс';

    applyMove(best.move.from, best.move.to, best.move.promotion);
  }

  /* ---------- Партия ---------- */

  function newGame(options) {
    const opts = options || {};
    state.generation++;
    state.game = new E.Chess();
    state.selected = null;
    state.targets = [];
    state.lastMove = null;
    state.moveList = [];
    state.thinking = false;
    state.finished = false;
    state.endReason = null;
    state.guardeAt = -1;

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
    if (!state.moveList.length) return;
    // Против компьютера отмена стоит кредит. Вдвоём за одним устройством — бесплатно.
    if (paidUndo()) {
      if (!Credits.canUndo()) { showAdOffer(true); return; }
      Credits.spendUndo();
    }

    state.generation++;
    state.guardeAt = -1;   // позиция откатилась, прежнее предупреждение недействительно

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
    clearSelection();

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
      applyMove(msg.from, msg.to, msg.promotion, { fromNetwork: true });
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

  const SERVER_KEY = 'dsc.roomServer';

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

  onSegment(el.soundSelect, data => {
    if (window.ChessSound) window.ChessSound.enabled = data.sound === 'on';
  });

  // Кнопка должна показывать выбор с прошлого запуска, а не значение из разметки
  if (window.ChessSound && el.soundSelect) {
    const wanted = window.ChessSound.enabled ? 'on' : 'off';
    const saved = el.soundSelect.querySelector('[data-sound="' + wanted + '"]');
    if (saved) selectSegment(el.soundSelect, saved);
  }

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

  el.promoOverlay.addEventListener('click', event => {
    if (event.target === el.promoOverlay) {
      el.promoOverlay.classList.remove('open');
      clearSelection();
      render();
    }
  });

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undoMove();
    }
    if (event.key === 'Escape') {
      closeNetOverlay();
      el.promoOverlay.classList.remove('open');
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
