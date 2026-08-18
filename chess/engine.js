/* Шахматный движок: генерация ходов, правила, SAN, FEN.
   Индексация доски: 0 = a8, 7 = h8, 56 = a1, 63 = h1. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChessEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WHITE = 'w';
  const BLACK = 'b';

  const PAWN = 'p', KNIGHT = 'n', BISHOP = 'b', ROOK = 'r', QUEEN = 'q', KING = 'k';

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const BISHOP_DELTAS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ROOK_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const KING_DELTAS = BISHOP_DELTAS.concat(ROOK_DELTAS);

  // Направления ходов фигуры и признак «скользит до упора»
  const DELTAS = {
    n: KNIGHT_DELTAS, b: BISHOP_DELTAS, r: ROOK_DELTAS, q: KING_DELTAS, k: KING_DELTAS
  };
  const SLIDING = { b: true, r: true, q: true };

  const FILES = 'abcdefgh';

  function fileOf(sq) { return sq & 7; }
  function rankOf(sq) { return sq >> 3; }   // 0 = 8-я горизонталь
  function square(file, rank) { return rank * 8 + file; }
  function onBoard(file, rank) { return file >= 0 && file < 8 && rank >= 0 && rank < 8; }

  function algebraic(sq) { return FILES[fileOf(sq)] + (8 - rankOf(sq)); }
  function fromAlgebraic(str) {
    const f = FILES.indexOf(str[0]);
    const r = 8 - parseInt(str[1], 10);
    return square(f, r);
  }

  function swap(color) { return color === WHITE ? BLACK : WHITE; }

  class Chess {
    constructor(fen) {
      this.load(fen || START_FEN);
    }

    load(fen) {
      const parts = fen.trim().split(/\s+/);
      this.board = new Array(64).fill(null);

      const rows = parts[0].split('/');
      for (let r = 0; r < 8; r++) {
        let f = 0;
        for (const ch of rows[r]) {
          if (/\d/.test(ch)) {
            f += parseInt(ch, 10);
          } else {
            const color = ch === ch.toUpperCase() ? WHITE : BLACK;
            this.board[square(f, r)] = { type: ch.toLowerCase(), color };
            f++;
          }
        }
      }

      this.turn = parts[1] === BLACK ? BLACK : WHITE;
      this.castling = parts[2] === '-' ? '' : parts[2];
      this.ep = parts[3] && parts[3] !== '-' ? fromAlgebraic(parts[3]) : -1;
      this.halfmoves = parts[4] ? parseInt(parts[4], 10) : 0;
      this.fullmoves = parts[5] ? parseInt(parts[5], 10) : 1;

      this.kings = { w: -1, b: -1 };
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (p && p.type === KING) this.kings[p.color] = i;
      }

      this.history = [];
      this.positionCounts = Object.create(null);
      this.positionCounts[this.positionKey()] = 1;
    }

    clone() {
      const copy = new Chess(this.fen());
      return copy;
    }

    fen() {
      let out = '';
      for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[square(f, r)];
          if (!p) { empty++; continue; }
          if (empty) { out += empty; empty = 0; }
          out += p.color === WHITE ? p.type.toUpperCase() : p.type;
        }
        if (empty) out += empty;
        if (r < 7) out += '/';
      }
      return [
        out,
        this.turn,
        this.castling || '-',
        this.ep >= 0 ? algebraic(this.ep) : '-',
        this.halfmoves,
        this.fullmoves
      ].join(' ');
    }

    /* Ключ для правила троекратного повторения (без счётчиков ходов). */
    positionKey() {
      const f = this.fen().split(' ');
      return f[0] + ' ' + f[1] + ' ' + f[2] + ' ' + f[3];
    }

    get(sq) { return this.board[sq]; }

    /* ---------- Атаки ---------- */

    isAttacked(sq, byColor) {
      const board = this.board;
      const f = fileOf(sq), r = rankOf(sq);

      // Пешки
      const pawnDir = byColor === WHITE ? 1 : -1; // атакующая пешка стоит "ниже" по экрану
      for (const df of [-1, 1]) {
        const nf = f + df, nr = r + pawnDir;
        if (onBoard(nf, nr)) {
          const p = board[square(nf, nr)];
          if (p && p.color === byColor && p.type === PAWN) return true;
        }
      }

      // Кони и король — на один шаг по своим направлениям
      for (const [deltas, type] of [[KNIGHT_DELTAS, KNIGHT], [KING_DELTAS, KING]]) {
        for (const [df, dr] of deltas) {
          const nf = f + df, nr = r + dr;
          if (!onBoard(nf, nr)) continue;
          const p = board[square(nf, nr)];
          if (p && p.color === byColor && p.type === type) return true;
        }
      }

      // Слоны и ладьи (вместе с ферзём) — по лучам до первой встречной фигуры
      for (const [deltas, type] of [[BISHOP_DELTAS, BISHOP], [ROOK_DELTAS, ROOK]]) {
        for (const [df, dr] of deltas) {
          let nf = f + df, nr = r + dr;
          while (onBoard(nf, nr)) {
            const p = board[square(nf, nr)];
            if (p) {
              if (p.color === byColor && (p.type === type || p.type === QUEEN)) return true;
              break;
            }
            nf += df; nr += dr;
          }
        }
      }

      return false;
    }

    inCheck(color) {
      const c = color || this.turn;
      const k = this.kings[c];
      if (k < 0) return false;
      return this.isAttacked(k, swap(c));
    }

    /* ---------- Генерация ходов ---------- */

    /* options: { legal: true, from: sq, capturesOnly: false } */
    moves(options) {
      const opts = options || {};
      const legal = opts.legal !== false;
      const color = this.turn;
      const list = [];
      const board = this.board;

      const push = (move) => {
        // Превращение пешки разворачиваем в 4 хода
        const toRank = rankOf(move.to);
        if (move.piece === PAWN && (toRank === 0 || toRank === 7)) {
          for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
            list.push(Object.assign({}, move, { promotion: promo }));
          }
        } else {
          list.push(move);
        }
      };

      const makeMoveObj = (from, to, flags) => ({
        from, to,
        piece: board[from].type,
        color,
        captured: flags && flags.ep ? PAWN : (board[to] ? board[to].type : null),
        promotion: null,
        ep: !!(flags && flags.ep),
        castle: (flags && flags.castle) || null,
        double: !!(flags && flags.double)
      });

      for (let sq = 0; sq < 64; sq++) {
        if (opts.from !== undefined && opts.from !== null && sq !== opts.from) continue;
        const piece = board[sq];
        if (!piece || piece.color !== color) continue;

        const f = fileOf(sq), r = rankOf(sq);

        if (piece.type === PAWN) {
          const dir = color === WHITE ? -1 : 1;
          const startRank = color === WHITE ? 6 : 1;

          if (!opts.capturesOnly) {
            const oneR = r + dir;
            if (onBoard(f, oneR) && !board[square(f, oneR)]) {
              push(makeMoveObj(sq, square(f, oneR), null));
              const twoR = r + dir * 2;
              if (r === startRank && !board[square(f, twoR)]) {
                push(makeMoveObj(sq, square(f, twoR), { double: true }));
              }
            }
          }

          for (const df of [-1, 1]) {
            const nf = f + df, nr = r + dir;
            if (!onBoard(nf, nr)) continue;
            const target = square(nf, nr);
            const p = board[target];
            if (p && p.color !== color) {
              push(makeMoveObj(sq, target, null));
            } else if (!p && target === this.ep) {
              push(makeMoveObj(sq, target, { ep: true }));
            }
          }
          continue;
        }

        // Конь и король шагают один раз, слон, ладья и ферзь скользят до упора
        for (const [df, dr] of DELTAS[piece.type]) {
          let nf = f + df, nr = r + dr;
          while (onBoard(nf, nr)) {
            const target = square(nf, nr);
            const p = board[target];
            if (p) {
              if (p.color !== color) push(makeMoveObj(sq, target, null));
              break;
            }
            if (!opts.capturesOnly) push(makeMoveObj(sq, target, null));
            if (!SLIDING[piece.type]) break;
            nf += df; nr += dr;
          }
        }

        // Рокировка
        if (piece.type === KING && !opts.capturesOnly && sq === (color === WHITE ? 60 : 4)) {
          const enemy = swap(color);
          const kingSide = color === WHITE ? 'K' : 'k';
          const queenSide = color === WHITE ? 'Q' : 'q';

          if (this.castling.indexOf(kingSide) >= 0 &&
            !board[sq + 1] && !board[sq + 2] &&
            !this.isAttacked(sq, enemy) && !this.isAttacked(sq + 1, enemy) && !this.isAttacked(sq + 2, enemy)) {
            push(makeMoveObj(sq, sq + 2, { castle: 'k' }));
          }
          if (this.castling.indexOf(queenSide) >= 0 &&
            !board[sq - 1] && !board[sq - 2] && !board[sq - 3] &&
            !this.isAttacked(sq, enemy) && !this.isAttacked(sq - 1, enemy) && !this.isAttacked(sq - 2, enemy)) {
            push(makeMoveObj(sq, sq - 2, { castle: 'q' }));
          }
        }
      }

      if (!legal) return list;

      const legalMoves = [];
      for (const move of list) {
        this.makeMove(move);
        if (!this.isAttacked(this.kings[color], swap(color))) legalMoves.push(move);
        this.undoMove();
      }
      return legalMoves;
    }

    /* ---------- Ход / откат ---------- */

    makeMove(move) {
      const board = this.board;
      const color = move.color;
      const enemy = swap(color);

      this.history.push({
        move,
        captured: move.ep ? { type: PAWN, color: enemy } : board[move.to],
        castling: this.castling,
        ep: this.ep,
        halfmoves: this.halfmoves,
        fullmoves: this.fullmoves,
        kingSquare: this.kings[color]
      });

      const piece = board[move.from];
      board[move.from] = null;

      if (move.ep) {
        const capturedSq = move.to + (color === WHITE ? 8 : -8);
        board[capturedSq] = null;
      }

      board[move.to] = move.promotion ? { type: move.promotion, color } : piece;

      if (piece.type === KING) {
        this.kings[color] = move.to;
        if (move.castle === 'k') {
          board[move.to - 1] = board[move.to + 1];
          board[move.to + 1] = null;
        } else if (move.castle === 'q') {
          board[move.to + 1] = board[move.to - 2];
          board[move.to - 2] = null;
        }
      }

      // Права на рокировку
      if (this.castling) {
        let c = this.castling;
        if (piece.type === KING) {
          c = c.replace(color === WHITE ? /[KQ]/g : /[kq]/g, '');
        }
        if (move.from === 63 || move.to === 63) c = c.replace('K', '');
        if (move.from === 56 || move.to === 56) c = c.replace('Q', '');
        if (move.from === 7 || move.to === 7) c = c.replace('k', '');
        if (move.from === 0 || move.to === 0) c = c.replace('q', '');
        this.castling = c;
      }

      this.ep = move.double ? move.to + (color === WHITE ? 8 : -8) : -1;

      if (piece.type === PAWN || move.captured) this.halfmoves = 0;
      else this.halfmoves++;

      if (color === BLACK) this.fullmoves++;
      this.turn = enemy;
    }

    undoMove() {
      const record = this.history.pop();
      if (!record) return null;

      const move = record.move;
      const board = this.board;
      const color = move.color;

      board[move.from] = move.promotion
        ? { type: PAWN, color }
        : board[move.to];
      board[move.to] = null;

      if (move.ep) {
        const capturedSq = move.to + (color === WHITE ? 8 : -8);
        board[capturedSq] = { type: PAWN, color: swap(color) };
      } else if (record.captured) {
        board[move.to] = record.captured;
      }

      if (move.piece === KING) {
        this.kings[color] = record.kingSquare;
        if (move.castle === 'k') {
          board[move.to + 1] = board[move.to - 1];
          board[move.to - 1] = null;
        } else if (move.castle === 'q') {
          board[move.to - 2] = board[move.to + 1];
          board[move.to + 1] = null;
        }
      }

      this.castling = record.castling;
      this.ep = record.ep;
      this.halfmoves = record.halfmoves;
      this.fullmoves = record.fullmoves;
      this.turn = color;
      return move;
    }

    /* Ход из пользовательского интерфейса. Возвращает объект с SAN или null. */
    move(from, to, promotion) {
      const candidates = this.moves({ from });
      const found = candidates.find(m => m.to === to && (!m.promotion || m.promotion === (promotion || QUEEN)));
      if (!found) return null;

      const san = this.toSan(found);
      this.makeMove(found);
      const key = this.positionKey();
      this.positionCounts[key] = (this.positionCounts[key] || 0) + 1;
      return { move: found, san };
    }

    undo() {
      const key = this.positionKey();
      if (this.positionCounts[key]) this.positionCounts[key]--;
      return this.undoMove();
    }

    /* ---------- SAN ---------- */

    toSan(move) {
      if (move.castle === 'k') return this.withCheckSuffix(move, 'O-O');
      if (move.castle === 'q') return this.withCheckSuffix(move, 'O-O-O');

      let san = '';
      if (move.piece === PAWN) {
        if (move.captured) san += FILES[fileOf(move.from)] + 'x';
        san += algebraic(move.to);
        if (move.promotion) san += '=' + move.promotion.toUpperCase();
      } else {
        san += move.piece.toUpperCase();

        // Уточнение при неоднозначности
        const same = this.moves().filter(m =>
          m.piece === move.piece && m.to === move.to && m.from !== move.from);
        if (same.length) {
          const sameFile = same.some(m => fileOf(m.from) === fileOf(move.from));
          const sameRank = same.some(m => rankOf(m.from) === rankOf(move.from));
          if (!sameFile) san += FILES[fileOf(move.from)];
          else if (!sameRank) san += String(8 - rankOf(move.from));
          else san += algebraic(move.from);
        }

        if (move.captured) san += 'x';
        san += algebraic(move.to);
      }
      return this.withCheckSuffix(move, san);
    }

    withCheckSuffix(move, san) {
      this.makeMove(move);
      const opponentInCheck = this.inCheck(this.turn);
      const noMoves = this.moves().length === 0;
      this.undoMove();
      if (opponentInCheck) return san + (noMoves ? '#' : '+');
      return san;
    }

    /* ---------- Состояние партии ---------- */

    insufficientMaterial() {
      const pieces = [];
      let bishops = [];
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (!p || p.type === KING) continue;
        if (p.type === PAWN || p.type === ROOK || p.type === QUEEN) return false;
        pieces.push(p);
        if (p.type === BISHOP) bishops.push({ color: p.color, light: (fileOf(i) + rankOf(i)) % 2 === 0 });
      }
      if (pieces.length <= 1) return true;                       // K vs K, K+N/B vs K
      if (pieces.length === 2 && pieces.every(p => p.type === BISHOP)) {
        return bishops[0].light === bishops[1].light;            // одноцветные слоны
      }
      if (pieces.length === 2 && pieces.every(p => p.type === KNIGHT || p.type === BISHOP)) {
        return pieces[0].color !== pieces[1].color;              // лёгкая фигура у каждого
      }
      return false;
    }

    threefold() {
      return (this.positionCounts[this.positionKey()] || 0) >= 3;
    }

    /* Возвращает { over, result, reason } */
    status() {
      const legal = this.moves();
      if (legal.length === 0) {
        if (this.inCheck(this.turn)) {
          return { over: true, result: swap(this.turn), reason: 'checkmate' };
        }
        return { over: true, result: 'draw', reason: 'stalemate' };
      }
      if (this.insufficientMaterial()) return { over: true, result: 'draw', reason: 'material' };
      if (this.halfmoves >= 100) return { over: true, result: 'draw', reason: 'fifty' };
      if (this.threefold()) return { over: true, result: 'draw', reason: 'threefold' };
      return { over: false, result: null, reason: this.inCheck(this.turn) ? 'check' : null };
    }

    perft(depth) {
      if (depth === 0) return 1;
      const moves = this.moves();
      if (depth === 1) return moves.length;
      let nodes = 0;
      for (const m of moves) {
        this.makeMove(m);
        nodes += this.perft(depth - 1);
        this.undoMove();
      }
      return nodes;
    }
  }

  return {
    Chess,
    WHITE, BLACK,
    PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    START_FEN,
    algebraic, fromAlgebraic, fileOf, rankOf, square, swap
  };
});
