/* Компьютерный соперник: negamax с alpha-beta, доигрывание боёв и оценка позиции.

   Шашки считаются иначе, чем шахматы: ходов из позиции немного (обычно 6–12),
   зато бой обязателен, поэтому дерево полно форсированных цепочек. Отсюда две
   особенности: перебор идёт глубже шахматного, а на последней глубине позиция
   доигрывается до той, где брать нечего. */
(function (root, factory) {
  const api = factory(typeof require === 'function' && typeof module !== 'undefined'
    ? require('./engine.js')
    : root.CheckersEngine);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckersAI = api;
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  const { WHITE, EMPTY, WM, WK, BM, BK, rankOf, fileOf } = Engine;

  const MAN = 100;
  const KING = 300;
  const WIN = 100000;

  /* Ценность поля для простой шашки, взгляд со стороны белых (они идут вверх).
     Чем ближе к дамочному полю, тем дороже; центр надёжнее краёв, а своя
     первая горизонталь ценна тем, что не пускает чужие шашки в дамки. */
  const MAN_TABLE = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    30, 34, 34, 36, 36, 34, 34, 30,
    18, 22, 24, 26, 26, 24, 22, 18,
    10, 14, 16, 18, 18, 16, 14, 10,
    6, 8, 10, 12, 12, 10, 8, 6,
    2, 4, 6, 8, 8, 6, 4, 2,
    8, 8, 8, 8, 8, 8, 8, 8
  ];

  /* Дамке важен центр: с краёв она простреливает меньше полей. */
  const KING_TABLE = [
    -12, -8, -6, -4, -4, -6, -8, -12,
    -8, 2, 6, 8, 8, 6, 2, -8,
    -6, 6, 12, 14, 14, 12, 6, -6,
    -4, 8, 14, 18, 18, 14, 8, -4,
    -4, 8, 14, 18, 18, 14, 8, -4,
    -6, 6, 12, 14, 14, 12, 6, -6,
    -8, 2, 6, 8, 8, 6, 2, -8,
    -12, -8, -6, -4, -4, -6, -8, -12
  ];

  /* Уровни: глубина перебора, потолок времени и slack — насколько ход может
     уступать лучшему, оставаясь приемлемым. Из-за slack слабые уровни ошибаются
     и не повторяют партию в партию одно и то же. */
  const LEVELS = {
    1: { depth: 2, slack: 130, time: 250, label: 'Новичок' },
    2: { depth: 4, slack: 50, time: 500, label: 'Любитель' },
    3: { depth: 6, slack: 12, time: 1100, label: 'Профессионал' },
    4: { depth: 10, slack: 0, time: 2600, label: 'Мастер' }
  };

  /* Поворот доски на 180°: при отражении по горизонтали тёмные поля стали бы
     светлыми, а игра идёт только по тёмным. */
  function mirror(sq) { return 63 - sq; }

  /* Оценка позиции глазами того, чья очередь ходить. */
  function evaluate(game) {
    const board = game.board;
    let score = 0;
    let whiteMen = 0, blackMen = 0, whiteKings = 0, blackKings = 0;
    let whiteBack = 0, blackBack = 0;

    for (let sq = 0; sq < 64; sq++) {
      const piece = board[sq];
      if (piece === EMPTY) continue;

      if (piece === WM) {
        whiteMen++;
        score += MAN + MAN_TABLE[sq];
        if (rankOf(sq) === 7) whiteBack++;
      } else if (piece === BM) {
        blackMen++;
        score -= MAN + MAN_TABLE[mirror(sq)];
        if (rankOf(sq) === 0) blackBack++;
      } else if (piece === WK) {
        whiteKings++;
        score += KING + KING_TABLE[sq];
      } else {
        blackKings++;
        score -= KING + KING_TABLE[sq];
      }
    }

    // Держать первую горизонталь стоит лишь пока сопернику есть кого проводить
    if (blackMen) score += whiteBack * 7;
    if (whiteMen) score -= blackBack * 7;

    // При материальном перевесе выгодны размены: меньше фигур — яснее победа
    const white = whiteMen + whiteKings * 3;
    const black = blackMen + blackKings * 3;
    if (white !== black) {
      const total = white + black;
      score += (white - black) * (24 - total) * 1.5;
    }

    return game.turn === WHITE ? score : -score;
  }

  /* Сначала смотрим ходы, которые обычно и оказываются лучшими:
     длинные бои, взятие дамок, проход в дамки. */
  function scoreMove(game, move) {
    let score = 0;
    for (const sq of move.captures) {
      const victim = game.board[sq];
      score += (victim === WK || victim === BK) ? KING : MAN;
    }
    if (move.promotion) score += 120;
    if (move.king) score += 8;
    return score;
  }

  function orderMoves(game, moves) {
    if (moves.length < 2) return moves;
    return moves
      .map(move => ({ move, score: scoreMove(game, move) }))
      .sort((a, b) => b.score - a.score)
      .map(item => item.move);
  }

  /* Доигрывание: пока бой обязателен, оценивать позицию бессмысленно —
     на доске висит незавершённый размен. Здесь нет «права остаться на месте»,
     потому что пропустить обязательный бой игрок не может. */
  function quiesce(game, alpha, beta, stats, depth, deadline) {
    stats.nodes++;

    // Цепочки боёв бывают длинными: время проверяем и здесь, иначе ход затянется
    if ((stats.nodes & 255) === 0 && Date.now() > deadline) {
      stats.aborted = true;
      return evaluate(game);
    }

    const moves = game.moves();
    if (!moves.length) return -WIN;
    if (depth <= 0 || !moves[0].captures.length) return evaluate(game);

    let best = -Infinity;
    for (const move of orderMoves(game, moves)) {
      game.makeMove(move);
      const score = -quiesce(game, -beta, -alpha, stats, depth - 1, deadline);
      game.undoMove();
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function negamax(game, depth, alpha, beta, stats, ply, deadline) {
    stats.nodes++;

    // Время вышло — возвращаем оценку, результат этой ветки всё равно отбросят
    if ((stats.nodes & 255) === 0 && Date.now() > deadline) {
      stats.aborted = true;
      return evaluate(game);
    }

    const moves = game.moves();
    if (!moves.length) return -WIN + ply;          // ходов нет — проигрыш, чем позже, тем лучше
    if (game.quiet >= Engine.QUIET_LIMIT) return 0;

    if (depth <= 0) return quiesce(game, alpha, beta, stats, 8, deadline);

    // Единственный ответ ничего не ветвит — досчитываем его без потери глубины
    const extension = moves.length === 1 ? 1 : 0;

    let best = -Infinity;
    for (const move of orderMoves(game, moves)) {
      game.makeMove(move);
      const score = -negamax(game, depth - 1 + extension, -beta, -alpha, stats, ply + 1, deadline);
      game.undoMove();
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  /* Ищет ход за сторону, которая на очереди.
     Возвращает { move, score, nodes, time, depth } или null, если ходов нет. */
  function findBestMove(game, level) {
    const config = LEVELS[level] || LEVELS[3];
    const started = Date.now();
    const deadline = started + config.time;
    const stats = { nodes: 0, aborted: false };

    const moves = game.moves();
    if (!moves.length) return null;
    if (moves.length === 1) {
      return { move: moves[0], score: 0, nodes: 0, time: 0, depth: 0, forced: true };
    }

    const ordered = orderMoves(game, moves);
    let scored = ordered.map(move => ({ move, score: 0 }));
    let reached = 0;

    // Углубляемся, пока есть время: даже прерванный поиск оставляет результат
    // предыдущей, полностью просчитанной глубины
    for (let depth = 1; depth <= config.depth; depth++) {
      const round = [];
      let bestScore = -Infinity;
      stats.aborted = false;

      for (const item of scored) {
        game.makeMove(item.move);
        const score = -negamax(game, depth - 1, -Infinity, Infinity, stats, 1, deadline);
        game.undoMove();
        round.push({ move: item.move, score });
        if (score > bestScore) bestScore = score;
        if (stats.aborted) break;
      }

      if (stats.aborted) break;

      round.sort((a, b) => b.score - a.score);   // лучший ход первым в следующий проход
      scored = round;
      reached = depth;

      // Победа найдена — дальше искать нечего
      if (bestScore >= WIN - 1000) break;

      // Следующая глубина обходится в несколько раз дороже предыдущей: начинать её
      // на исходе бюджета значит выйти за отведённое время и всё равно всё бросить
      if (Date.now() - started > config.time * 0.4) break;
    }

    const bestScore = scored[0].score;
    const decided = bestScore >= WIN - 1000 || bestScore <= -WIN + 1000;
    const pool = decided
      ? scored.filter(item => item.score === bestScore)
      : scored.filter(item => item.score >= bestScore - config.slack);
    const chosen = pool[Math.floor(Math.random() * pool.length)] || scored[0];

    return {
      move: chosen.move,
      score: Math.round(chosen.score),
      nodes: stats.nodes,
      time: Date.now() - started,
      depth: reached
    };
  }

  return { findBestMove, evaluate, LEVELS, MAN, KING, WIN };
});
