// Rookless Chess engine.
// Standard chess rules throughout, with two changes to the starting position:
//   1. All 4 rooks are removed (a1, h1, a8, h8 start empty).
//   2. The f1 and f8 bishops are swapped ACROSS colors — so White's
//      kingside bishop starts on f8, and Black's kingside bishop starts on f1.
// No castling (there are no rooks to castle with).
// Board convention: row 0 = rank 1 (White's back rank), row 7 = rank 8.
//                    col 0 = file a, col 7 = file h.
// Pieces: uppercase = White, lowercase = Black.
//   P/p pawn, N/n knight, B/b bishop, R/r rook, Q/q queen, K/k king.
// Rooks are removed from the START only — pawns can still promote to a
// rook, per standard promotion rules.

const FILES = 'abcdefgh';

class ChessGame {
  constructor() {
    this.board = this.buildInitialBoard();
    this.turn = 'w';
    this.enPassantTarget = null; // {row, col} square a pawn can capture into via en passant, or null
    this.moveHistoryAlgebraic = [];
    this.isGameOverFlag = false;
    this.statusMessage = 'White to move';
    this.resultReason = null; // 'checkmate' | 'stalemate' | null
  }

  buildInitialBoard() {
    const board = Array(8).fill(null).map(() => Array(8).fill(' '));
    const backRank = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    for (let c = 0; c < 8; c++) {
      board[0][c] = backRank[c];
      board[1][c] = 'P';
      board[6][c] = 'p';
      board[7][c] = backRank[c].toLowerCase();
    }
    // Remove all 4 rooks
    board[0][0] = ' '; board[0][7] = ' ';
    board[7][0] = ' '; board[7][7] = ' ';
    // Swap f1 (White bishop) and f8 (Black bishop) ACROSS colors
    const f1 = board[0][5]; // 'B'
    const f8 = board[7][5]; // 'b'
    board[0][5] = f8; // Black bishop now starts on f1
    board[7][5] = f1; // White bishop now starts on f8
    return board;
  }

  clone() {
    const g = new ChessGame();
    g.board = this.board.map(row => [...row]);
    g.turn = this.turn;
    g.enPassantTarget = this.enPassantTarget ? { ...this.enPassantTarget } : null;
    g.moveHistoryAlgebraic = [...this.moveHistoryAlgebraic];
    g.isGameOverFlag = this.isGameOverFlag;
    g.statusMessage = this.statusMessage;
    g.resultReason = this.resultReason;
    return g;
  }

  getPieceColor(piece) {
    if (piece === ' ' || !piece) return null;
    return piece === piece.toUpperCase() ? 'w' : 'b';
  }

  inBounds(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  // Pseudo-legal moves for the piece at (r,c) — doesn't check whether the
  // move leaves the mover's own king in check.
  getPseudoLegalMoves(r, c, board = this.board, enPassantTarget = this.enPassantTarget) {
    const piece = board[r][c];
    if (piece === ' ') return [];
    const color = this.getPieceColor(piece);
    const type = piece.toUpperCase();
    const moves = [];

    const addIfOpenOrCapture = (nr, nc) => {
      if (!this.inBounds(nr, nc)) return false;
      const target = board[nr][nc];
      if (target === ' ') {
        moves.push({ from: { r, c }, to: { r: nr, c: nc } });
        return true; // can continue sliding
      }
      if (this.getPieceColor(target) !== color) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc } });
      }
      return false; // blocked, stop sliding
    };

    if (type === 'P') {
      const dir = color === 'w' ? 1 : -1;
      const startRow = color === 'w' ? 1 : 6;
      const promoRow = color === 'w' ? 7 : 0;
      // Single advance
      if (this.inBounds(r + dir, c) && board[r + dir][c] === ' ') {
        this.pushPawnMove(moves, r, c, r + dir, c, promoRow);
        // Double advance
        if (r === startRow && board[r + 2 * dir][c] === ' ') {
          moves.push({ from: { r, c }, to: { r: r + 2 * dir, c }, isDoubleStep: true });
        }
      }
      // Captures (including en passant)
      for (const dc of [-1, 1]) {
        const nr = r + dir, nc = c + dc;
        if (!this.inBounds(nr, nc)) continue;
        const target = board[nr][nc];
        if (target !== ' ' && this.getPieceColor(target) !== color) {
          this.pushPawnMove(moves, r, c, nr, nc, promoRow);
        } else if (
          enPassantTarget && enPassantTarget.r === nr && enPassantTarget.c === nc
        ) {
          moves.push({ from: { r, c }, to: { r: nr, c: nc }, isEnPassant: true });
        }
      }
    } else if (type === 'N') {
      const deltas = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
      for (const [dr, dc] of deltas) {
        const nr = r + dr, nc = c + dc;
        if (!this.inBounds(nr, nc)) continue;
        const target = board[nr][nc];
        if (target === ' ' || this.getPieceColor(target) !== color) {
          moves.push({ from: { r, c }, to: { r: nr, c: nc } });
        }
      }
    } else if (type === 'K') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (!this.inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (target === ' ' || this.getPieceColor(target) !== color) {
            moves.push({ from: { r, c }, to: { r: nr, c: nc } });
          }
        }
      }
    } else {
      // Sliding pieces: bishop, rook, queen
      const dirs = [];
      if (type === 'B' || type === 'Q') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
      if (type === 'R' || type === 'Q') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (addIfOpenOrCapture(nr, nc)) {
          nr += dr; nc += dc;
        }
      }
    }
    return moves;
  }

  pushPawnMove(moves, r, c, nr, nc, promoRow) {
    if (nr === promoRow) {
      // Standard promotion choices
      for (const promo of ['Q', 'R', 'B', 'N']) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc }, promotion: promo });
      }
    } else {
      moves.push({ from: { r, c }, to: { r: nr, c: nc } });
    }
  }

  findKing(color, board = this.board) {
    const target = color === 'w' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === target) return { r, c };
      }
    }
    return null;
  }

  // Is the square (r,c) attacked by the given color, on the given board?
  isSquareAttacked(r, c, byColor, board = this.board) {
    for (let sr = 0; sr < 8; sr++) {
      for (let sc = 0; sc < 8; sc++) {
        const piece = board[sr][sc];
        if (piece === ' ' || this.getPieceColor(piece) !== byColor) continue;
        // En passant target isn't relevant for attack-checking, pass null
        const moves = this.getPseudoLegalMoves(sr, sc, board, null);
        if (moves.some(m => m.to.r === r && m.to.c === c)) return true;
      }
    }
    return false;
  }

  isInCheck(color, board = this.board) {
    const kingPos = this.findKing(color, board);
    if (!kingPos) return false;
    const enemyColor = color === 'w' ? 'b' : 'w';
    return this.isSquareAttacked(kingPos.r, kingPos.c, enemyColor, board);
  }

  // Simulates a pseudo-legal move on a board copy and returns the resulting board.
  simulateMove(move, board = this.board) {
    const newBoard = board.map(row => [...row]);
    const { from, to } = move;
    const piece = newBoard[from.r][from.c];
    newBoard[from.r][from.c] = ' ';
    if (move.isEnPassant) {
      // Captured pawn is on the same row as 'from', same column as 'to'
      newBoard[from.r][to.c] = ' ';
    }
    newBoard[to.r][to.c] = move.promotion
      ? (this.getPieceColor(piece) === 'w' ? move.promotion : move.promotion.toLowerCase())
      : piece;
    return newBoard;
  }

  // Fully legal moves for the piece at (r,c): pseudo-legal moves that don't
  // leave the mover's own king in check.
  getLegalMoves(r, c) {
    const piece = this.board[r][c];
    if (piece === ' ') return [];
    const color = this.getPieceColor(piece);
    const pseudo = this.getPseudoLegalMoves(r, c);
    return pseudo.filter(move => {
      const resultBoard = this.simulateMove(move);
      return !this.isInCheck(color, resultBoard);
    });
  }

  getAllLegalMoves(color) {
    const all = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r][c];
        if (piece !== ' ' && this.getPieceColor(piece) === color) {
          all.push(...this.getLegalMoves(r, c));
        }
      }
    }
    return all;
  }

  squareName(r, c) {
    return FILES[c] + (r + 1);
  }

  // Attempts to make a move from (fromR,fromC) to (toR,toC). Returns true if
  // the move was legal and applied, false otherwise. promotion (optional)
  // is one of 'Q'/'R'/'B'/'N', required when the move is a pawn reaching
  // the last rank — if omitted for such a move, defaults to Queen.
  makeMove(fromR, fromC, toR, toC, promotion) {
    if (this.isGameOverFlag) {
      this.statusMessage = 'Game is over!';
      return false;
    }
    const legalMoves = this.getLegalMoves(fromR, fromC);
    let move = legalMoves.find(m => m.to.r === toR && m.to.c === toC && (!m.promotion || m.promotion === (promotion || 'Q')));
    if (!move) {
      // If it's a promotion move and caller didn't specify, try to find any promotion variant
      move = legalMoves.find(m => m.to.r === toR && m.to.c === toC);
    }
    if (!move) {
      // Same two-message distinction as qi-chess: was this pattern-illegal
      // or blocked entirely, or was it a pattern the piece CAN make but
      // that leaves the mover's own king in check?
      const pseudoLegal = this.getPseudoLegalMoves(fromR, fromC);
      const pseudoMatch = pseudoLegal.find(m => m.to.r === toR && m.to.c === toC);
      this.statusMessage = pseudoMatch
        ? 'Invalid move: King would be in check.'
        : 'Invalid move for that piece pattern or blocked path.';
      return false;
    }

    const piece = this.board[fromR][fromC];
    const color = this.getPieceColor(piece);
    const capturedPiece = this.board[toR][toC];
    const isCapture = capturedPiece !== ' ' || move.isEnPassant;

    // Apply the move for real
    this.board[fromR][fromC] = ' ';
    if (move.isEnPassant) {
      this.board[fromR][toC] = ' '; // remove the captured pawn
    }
    this.board[toR][toC] = move.promotion
      ? (color === 'w' ? move.promotion : move.promotion.toLowerCase())
      : piece;

    // Update en passant target for the *next* move
    this.enPassantTarget = move.isDoubleStep
      ? { r: (fromR + toR) / 2, c: fromC }
      : null;

    // Build simple algebraic-ish notation
    const pieceType = piece.toUpperCase();
    const pieceLetter = pieceType === 'P' ? '' : pieceType;
    const captureMark = isCapture ? 'x' : '';
    const fromSquare = pieceType === 'P' && isCapture ? FILES[fromC] : '';
    let notation = `${pieceLetter}${fromSquare}${captureMark}${this.squareName(toR, toC)}`;
    if (move.promotion) notation += `=${move.promotion}`;

    this.turn = color === 'w' ? 'b' : 'w';

    // Check/checkmate/stalemate detection for the side to move next
    const nextInCheck = this.isInCheck(this.turn);
    const nextHasMoves = this.getAllLegalMoves(this.turn).length > 0;
    if (nextInCheck && !nextHasMoves) {
      notation += '#';
      this.isGameOverFlag = true;
      this.resultReason = 'checkmate';
      this.statusMessage = `Checkmate! ${color === 'w' ? 'White' : 'Black'} wins.`;
    } else if (!nextInCheck && !nextHasMoves) {
      this.isGameOverFlag = true;
      this.resultReason = 'stalemate';
      this.statusMessage = 'Stalemate! The game is a draw.';
    } else {
      if (nextInCheck) notation += '+';
      this.isGameOverFlag = false;
      this.resultReason = null;
      this.statusMessage = `${this.turn === 'w' ? 'White' : 'Black'} to move${nextInCheck ? ' — in check!' : ''}`;
    }

    this.moveHistoryAlgebraic.push(notation);
    return true;
  }
}

// Simple material values, used by the eval bar and the bot.
const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

function evaluateMaterial(board) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece === ' ') continue;
      const value = PIECE_VALUES[piece.toUpperCase()];
      score += piece === piece.toUpperCase() ? value : -value;
    }
  }
  return score; // positive favors White
}

// eslint-disable-next-line no-unused-vars
const ChessExports = { ChessGame, evaluateMaterial, PIECE_VALUES, FILES };