/* Движок русских шашек: генерация ходов, правила, нотация, позиция.

   Индексация доски совпадает с шахматной: 0 = a8, 7 = h8, 56 = a1, 63 = h1.
   Игровые поля — тёмные, то есть те, где (file + rank) нечётно: a1, c1, b2, …

   Правила русских шашек, которые здесь реализованы:
   - простая ходит вперёд, а бьёт и вперёд, и назад;
   - дамка ходит и бьёт по диагонали на любое расстояние;
   - бой обязателен, но выбирать можно любую из цепочек — не обязательно самую длинную;
   - начатую цепочку боя нужно доводить до конца;
   - побитые шашки снимаются лишь в конце хода и до тех пор мешают ходу («турецкий удар»);
   - простая, попавшая при бое на дамочное поле, превращается и продолжает бой уже дамкой. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckersEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WHITE = 'w';
  const BLACK = 'b';

  const MAN = 'm';
  const KING = 'k';

  // Содержимое клетки числом: так ход и откат обходятся без создания объектов
  const EMPTY = 0;
  const WM = 1, WK = 2, BM = 3, BK = 4;

  const FILES = 'abcdefgh';
  const DIRECTIONS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  /* Ничья, если 15 ходов подряд игроки двигали только дамок и никого не били. */
  const QUIET_LIMIT = 30;

  const START_POSITION = 'W:Wa1,c1,e1,g1,b2,d2,f2,h2,a3,c3,e3,g3:Ba7,c7,e7,g7,b8,d8,f8,h8,b6,d6,f6,h6';

  function fileOf(sq) { return sq & 7; }
  function rankOf(sq) { return sq >> 3; }          // 0 — восьмая горизонталь
  function square(file, rank) { return rank * 8 + file; }
  function onBoard(file, rank) { return file >= 0 && file < 8 && rank >= 0 && rank < 8; }
  function isPlaySquare(sq) { return ((fileOf(sq) + rankOf(sq)) & 1) === 1; }

  function algebraic(sq) { return FILES[fileOf(sq)] + (8 - rankOf(sq)); }
  function fromAlgebraic(str) {
    const text = String(str).trim().toLowerCase();
    const file = FILES.indexOf(text[0]);
    const rank = 8 - parseInt(text[1], 10);
    if (file < 0 || !(rank >= 0 && rank < 8)) return -1;
    return square(file, rank);
  }

  function swap(color) { return color === WHITE ? BLACK : WHITE; }

  function colorOf(piece) { return piece === WM || piece === WK ? WHITE : BLACK; }
  function isKingPiece(piece) { return piece === WK || piece === BK; }
  function pieceFor(color, king) {
    if (color === WHITE) return king ? WK : WM;
    return king ? BK : BM;
  }

  /* Горизонталь превращения: белые идут вверх экрана, чёрные — вниз. */
  function promotionRank(color) { return color === WHITE ? 0 : 7; }

  class Checkers {
    constructor(position) {
      this.load(position || START_POSITION);
    }

    load(position) {
      this.board = new Array(64).fill(EMPTY);

      const parts = String(position).trim().split(':');
      this.turn = parts[0] && parts[0].toUpperCase() === 'B' ? BLACK : WHITE;

      for (const group of parts.slice(1)) {
        if (!group) continue;
        const color = group[0].toUpperCase() === 'B' ? BLACK : WHITE;
        for (const token of group.slice(1).split(',')) {
          const text = token.trim();
          if (!text) continue;
          const king = text[0].toUpperCase() === 'K';
          const sq = fromAlgebraic(king ? text.slice(1) : text);
          if (sq >= 0) this.board[sq] = pieceFor(color, king);
        }
      }

      this.quiet = 0;
      this.moveNumber = 1;
      this.history = [];
      this.positionCounts = Object.create(null);
      this.positionCounts[this.positionKey()] = 1;
    }

    clone() { return new Checkers(this.position()); }

    /* Позиция строкой: «W:Wa1,Kc3:Ba7» — сторона хода и шашки каждого цвета. */
    position() {
      const list = color => {
        const parts = [];
        for (let sq = 0; sq < 64; sq++) {
          const piece = this.board[sq];
          if (piece === EMPTY || colorOf(piece) !== color) continue;
          parts.push((isKingPiece(piece) ? 'K' : '') + algebraic(sq));
        }
        return parts.join(',');
      };
      return (this.turn === WHITE ? 'W' : 'B') + ':W' + list(WHITE) + ':B' + list(BLACK);
    }

    positionKey() { return this.position(); }

    /* Клетка для интерфейса: null или { type: 'm' | 'k', color: 'w' | 'b' }. */
    get(sq) {
      const piece = this.board[sq];
      if (piece === EMPTY) return null;
      return { type: isKingPiece(piece) ? KING : MAN, color: colorOf(piece) };
    }

    count(color) {
      let men = 0, kings = 0;
      for (let sq = 0; sq < 64; sq++) {
        const piece = this.board[sq];
        if (piece === EMPTY || colorOf(piece) !== color) continue;
        if (isKingPiece(piece)) kings++; else men++;
      }
      return { men, kings, total: men + kings };
    }

    /* ---------- Генерация ходов ---------- */

    /* options: { from: sq, capturesOnly: true }
       Бой обязателен: если он есть хоть у одной шашки, тихие ходы не возвращаются. */
    moves(options) {
      const opts = options || {};
      const color = this.turn;
      const captures = [];

      for (let sq = 0; sq < 64; sq++) {
        const piece = this.board[sq];
        if (piece === EMPTY || colorOf(piece) !== color) continue;
        this.collectCaptures(sq, piece, captures);
      }

      let list = captures;
      if (!captures.length) {
        if (opts.capturesOnly) return [];
        list = [];
        for (let sq = 0; sq < 64; sq++) {
          const piece = this.board[sq];
          if (piece === EMPTY || colorOf(piece) !== color) continue;
          this.collectQuietMoves(sq, piece, list);
        }
      }

      if (opts.from !== undefined && opts.from !== null) {
        return list.filter(move => move.from === opts.from);
      }
      return list;
    }

    hasCaptures() {
      const color = this.turn;
      for (let sq = 0; sq < 64; sq++) {
        const piece = this.board[sq];
        if (piece === EMPTY || colorOf(piece) !== color) continue;
        const found = [];
        this.collectCaptures(sq, piece, found);
        if (found.length) return true;
      }
      return false;
    }

    collectQuietMoves(from, piece, list) {
      const color = colorOf(piece);
      const king = isKingPiece(piece);
      const file = fileOf(from), rank = rankOf(from);
      const forward = color === WHITE ? -1 : 1;

      for (const [df, dr] of DIRECTIONS) {
        if (!king && dr !== forward) continue;       // простая ходит только вперёд
        let f = file + df, r = rank + dr;
        while (onBoard(f, r)) {
          const to = square(f, r);
          if (this.board[to] !== EMPTY) break;
          const endedAsKing = king || rankOf(to) === promotionRank(color);
          list.push(this.makeMoveObject([from, to], [], color, king, endedAsKing));
          if (!king) break;                          // простая шагает ровно на одну клетку
          f += df; r += dr;
        }
      }
    }

    /* Все полные цепочки боя из клетки. Цепочка обязана продолжаться,
       пока та же шашка может бить дальше. */
    collectCaptures(from, piece, list) {
      const color = colorOf(piece);
      const board = this.board;

      const king = isKingPiece(piece);
      board[from] = EMPTY;                           // шашка в пути: своё поле она освобождает
      this.extendCaptures(from, king, king, color, [from], [], list);
      board[from] = piece;
    }

    extendCaptures(sq, king, startedAsKing, color, path, captured, list) {
      const jumps = this.jumpsFrom(sq, king, color, captured);

      if (!jumps.length) {
        // Из начальной клетки ничего не побито — это не ход, а отсутствие боя
        if (captured.length) {
          list.push(this.makeMoveObject(path.slice(), captured.slice(), color, startedAsKing, king));
        }
        return;
      }

      for (const jump of jumps) {
        // Побитая шашка остаётся на доске до конца хода и мешает как препятствие
        captured.push(jump.victim);
        path.push(jump.land);

        const becameKing = !king && rankOf(jump.land) === promotionRank(color);
        this.extendCaptures(jump.land, king || becameKing, startedAsKing, color, path, captured, list);

        path.pop();
        captured.pop();
      }
    }

    /* Прыжки из клетки: { victim, land }. Побитые ранее шашки бить повторно нельзя. */
    jumpsFrom(sq, king, color, captured) {
      const board = this.board;
      const file = fileOf(sq), rank = rankOf(sq);
      const jumps = [];

      for (const [df, dr] of DIRECTIONS) {
        let f = file + df, r = rank + dr;

        // Дамка подходит к жертве издалека, простая бьёт только вплотную
        if (king) {
          while (onBoard(f, r) && board[square(f, r)] === EMPTY) { f += df; r += dr; }
        }
        if (!onBoard(f, r)) continue;

        const victim = square(f, r);
        const target = board[victim];
        if (target === EMPTY || colorOf(target) === color) continue;
        if (captured.indexOf(victim) >= 0) continue;   // эту шашку уже побили в этой цепочке

        let lf = f + df, lr = r + dr;
        while (onBoard(lf, lr) && board[square(lf, lr)] === EMPTY) {
          jumps.push({ victim, land: square(lf, lr) });
          if (!king) break;                            // простая встаёт сразу за жертвой
          lf += df; lr += dr;
        }
      }

      return jumps;
    }

    makeMoveObject(path, captured, color, startedAsKing, endedAsKing) {
      return {
        from: path[0],
        to: path[path.length - 1],
        path,
        captures: captured,
        color,
        king: startedAsKing,                        // ходили дамкой, а не простой
        promotion: !startedAsKing && endedAsKing    // простая стала дамкой этим ходом
      };
    }

    /* ---------- Ход и откат ---------- */

    makeMove(move) {
      const board = this.board;
      const piece = board[move.from];
      const wasKing = isKingPiece(piece);

      this.history.push({
        move,
        piece,
        victims: move.captures.map(sq => board[sq]),
        quiet: this.quiet,
        moveNumber: this.moveNumber
      });

      board[move.from] = EMPTY;
      for (const sq of move.captures) board[sq] = EMPTY;
      board[move.to] = wasKing || move.promotion ? pieceFor(move.color, true) : piece;

      // Тихими считаются только ходы дамок без взятия — они и ведут к ничьей
      this.quiet = (wasKing && !move.captures.length) ? this.quiet + 1 : 0;
      if (move.color === BLACK) this.moveNumber++;
      this.turn = swap(move.color);
    }

    undoMove() {
      const record = this.history.pop();
      if (!record) return null;

      const move = record.move;
      const board = this.board;

      board[move.to] = EMPTY;
      for (let i = 0; i < move.captures.length; i++) board[move.captures[i]] = record.victims[i];
      board[move.from] = record.piece;

      this.quiet = record.quiet;
      this.moveNumber = record.moveNumber;
      this.turn = move.color;
      return move;
    }

    /* ---------- Ходы из интерфейса ---------- */

    /* Ищет ход по пройденным клеткам: [from, land1, land2, …]. */
    moveFromPath(path) {
      if (!path || path.length < 2) return null;
      const key = path.join(',');
      return this.moves({ from: path[0] }).find(m => m.path.join(',') === key) || null;
    }

    /* Ходы, начало которых совпадает с уже пройденным путём. */
    continuations(path) {
      if (!path || !path.length) return [];
      const prefix = path.join(',');
      return this.moves({ from: path[0] }).filter(m => {
        const own = m.path.join(',');
        return own === prefix || own.indexOf(prefix + ',') === 0;
      });
    }

    /* Доска в середине хода: шашка уже переставлена, побитые ещё стоят, но обречены. */
    previewPath(path) {
      const board = this.board.slice();
      const doomed = [];
      if (!path || path.length < 2) return { board, doomed, promoted: false };

      const moves = this.continuations(path);
      if (!moves.length) return { board, doomed, promoted: false };

      const sample = moves[0];
      const steps = path.length - 1;
      const piece = board[path[0]];
      let king = isKingPiece(piece);

      // Побитые за пройденные шаги: у всех продолжений первые взятия общие
      for (let i = 0; i < steps && i < sample.captures.length; i++) doomed.push(sample.captures[i]);

      for (let i = 1; i <= steps; i++) {
        if (!king && rankOf(path[i]) === promotionRank(sample.color)) king = true;
      }

      board[path[0]] = EMPTY;
      board[path[steps]] = pieceFor(sample.color, king);
      return { board, doomed, promoted: king && !isKingPiece(piece) };
    }

    /* Делает ход и возвращает { move, notation }. */
    move(pathOrMove) {
      const move = Array.isArray(pathOrMove) ? this.moveFromPath(pathOrMove) : pathOrMove;
      if (!move) return null;

      const notation = this.notation(move);
      this.makeMove(move);
      const key = this.positionKey();
      this.positionCounts[key] = (this.positionCounts[key] || 0) + 1;
      return { move, notation };
    }

    undo() {
      const key = this.positionKey();
      if (this.positionCounts[key]) this.positionCounts[key]--;
      return this.undoMove();
    }

    /* Русская нотация: тихий ход «c3-d4», бой «c3:e5:g7». */
    notation(move) {
      const separator = move.captures.length ? ':' : '-';
      return move.path.map(algebraic).join(separator);
    }

    /* ---------- Состояние партии ---------- */

    threefold() {
      return (this.positionCounts[this.positionKey()] || 0) >= 3;
    }

    /* Возвращает { over, result, reason }: result — 'w', 'b' или 'draw'. */
    status() {
      if (!this.moves().length) {
        // Ходов нет: либо шашки кончились, либо все заперты — в обоих случаях поражение
        const blocked = this.count(this.turn).total > 0;
        return { over: true, result: swap(this.turn), reason: blocked ? 'blocked' : 'wiped' };
      }
      if (this.quiet >= QUIET_LIMIT) return { over: true, result: 'draw', reason: 'quiet' };
      if (this.threefold()) return { over: true, result: 'draw', reason: 'threefold' };
      return { over: false, result: null, reason: null };
    }

    perft(depth) {
      if (depth === 0) return 1;
      const moves = this.moves();
      if (depth === 1) return moves.length;
      let nodes = 0;
      for (const move of moves) {
        this.makeMove(move);
        nodes += this.perft(depth - 1);
        this.undoMove();
      }
      return nodes;
    }
  }

  return {
    Checkers,
    WHITE, BLACK, MAN, KING,
    EMPTY, WM, WK, BM, BK,
    START_POSITION, QUIET_LIMIT,
    algebraic, fromAlgebraic, fileOf, rankOf, square, swap, isPlaySquare,
    colorOf, isKingPiece, pieceFor, promotionRank
  };
});
