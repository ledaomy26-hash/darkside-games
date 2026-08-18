/* Шахматный ИИ: negamax с alpha-beta, форсированный поиск взятий,
   оценка по материалу и таблицам позиций фигур. */
(function (root, factory) {
  const api = factory(typeof require === 'function' && typeof module !== 'undefined'
    ? require('./engine.js')
    : root.ChessEngine);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChessAI = api;
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  const { WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } = Engine;

  const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  const PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 20, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20
    ],
    kEnd: [
      -50, -40, -30, -20, -20, -30, -40, -50,
      -30, -20, -10, 0, 0, -10, -20, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -30, 0, 0, 0, 0, -30, -30,
      -50, -30, -30, -30, -30, -30, -30, -50
    ]
  };

  const MATE = 100000;

  /* Уровни сложности. slack — на сколько сантипешек ход может уступать лучшему,
     чтобы всё ещё считаться приемлемым: так компьютер играет не идеально и разнообразно. */
  const LEVELS = {
    1: { depth: 1, slack: 100, quiescence: false, label: 'Новичок' },
    2: { depth: 2, slack: 40, quiescence: false, label: 'Любитель' },
    3: { depth: 3, slack: 8, quiescence: true, label: 'Клубный игрок' },
    4: { depth: 4, slack: 0, quiescence: true, label: 'Мастер' }
  };

  function isEndgame(game) {
    let material = 0;
    let queens = 0;
    for (let i = 0; i < 64; i++) {
      const p = game.board[i];
      if (!p || p.type === KING || p.type === PAWN) continue;
      material += VALUES[p.type];
      if (p.type === QUEEN) queens++;
    }
    return queens === 0 || material <= 1600;
  }

  /* Оценка позиции с точки зрения стороны, делающей ход. */
  function evaluate(game, endgame) {
    let score = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = game.board[sq];
      if (!p) continue;
      const table = p.type === KING ? (endgame ? PST.kEnd : PST.k) : PST[p.type];
      const idx = p.color === WHITE ? sq : (sq ^ 56);
      const value = VALUES[p.type] + table[idx];
      score += p.color === WHITE ? value : -value;
    }

    // Права на рокировку ценны: иначе король «гуляет» на f1/g1 ради бонуса таблицы
    if (!endgame) {
      const c = game.castling;
      if (c.indexOf('K') >= 0) score += 14;
      if (c.indexOf('Q') >= 0) score += 10;
      if (c.indexOf('k') >= 0) score -= 14;
      if (c.indexOf('q') >= 0) score -= 10;
    }

    return game.turn === WHITE ? score : -score;
  }

  /* MVV-LVA: жертву подороже бьём фигурой подешевле. */
  function scoreMove(move) {
    let s = 0;
    if (move.captured) s += 10 * VALUES[move.captured] - VALUES[move.piece];
    if (move.promotion) s += VALUES[move.promotion];
    if (move.castle) s += 50;
    return s;
  }

  function orderMoves(moves) {
    return moves
      .map(m => ({ m, s: scoreMove(m) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.m);
  }

  function quiesce(game, alpha, beta, endgame, stats, depth) {
    stats.nodes++;
    const standPat = evaluate(game, endgame);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (depth <= 0) return alpha;

    const captures = orderMoves(game.moves({ capturesOnly: true }));
    for (const move of captures) {
      game.makeMove(move);
      const score = -quiesce(game, -beta, -alpha, endgame, stats, depth - 1);
      game.undoMove();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(game, depth, alpha, beta, endgame, config, stats, ply) {
    stats.nodes++;

    const moves = game.moves();
    if (moves.length === 0) {
      if (game.inCheck(game.turn)) return -MATE + ply;   // мат: чем ближе, тем хуже
      return 0;                                          // пат
    }
    if (game.halfmoves >= 100) return 0;

    if (depth === 0) {
      return config.quiescence
        ? quiesce(game, alpha, beta, endgame, stats, 4)
        : evaluate(game, endgame);
    }

    let best = -Infinity;
    for (const move of orderMoves(moves)) {
      game.makeMove(move);
      const score = -negamax(game, depth - 1, -beta, -alpha, endgame, config, stats, ply + 1);
      game.undoMove();
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  /* Ищет лучший ход. Возвращает { move, san, score, nodes, time }. */
  function findBestMove(game, level) {
    const config = LEVELS[level] || LEVELS[3];
    const started = Date.now();
    const stats = { nodes: 0 };
    const endgame = isEndgame(game);

    const moves = orderMoves(game.moves());
    if (moves.length === 0) return null;

    const slack = config.slack || 0;
    const scored = [];
    let bestScore = -Infinity;

    for (const move of moves) {
      /* Окно чуть шире отставания slack: тогда все ходы, попадающие в разброс,
         оценены точно, а отсечённые заведомо хуже и в выбор не попадают. */
      const alpha = bestScore === -Infinity ? -Infinity : bestScore - slack - 1;
      game.makeMove(move);
      const score = -negamax(game, config.depth - 1, -Infinity, -alpha, endgame, config, stats, 1);
      game.undoMove();

      if (score > bestScore) bestScore = score;
      scored.push({ move, score });
    }

    // Найденный мат разыгрываем всегда, независимо от уровня
    const forced = bestScore >= MATE - 1000 || bestScore <= -MATE + 1000;
    const pool = forced ? scored.filter(s => s.score === bestScore)
      : scored.filter(s => s.score >= bestScore - slack);
    const chosen = pool[Math.floor(Math.random() * pool.length)] || scored[0];

    return {
      move: chosen.move,
      score: Math.round(chosen.score),
      nodes: stats.nodes,
      time: Date.now() - started,
      depth: config.depth
    };
  }

  return { findBestMove, evaluate, LEVELS, VALUES, MATE };
});
