// Simple minimax + alpha-beta bot for Rookless Chess.
// Runs synchronously on the main thread — search depth is kept modest
// (this board has fewer pieces than a standard chess start, since all 4
// rooks are gone, so branching factor is lower and this stays responsive).

function evaluatePosition(game) {
  let score = 0;
  const board = game.board;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece === ' ') continue;
      const value = PIECE_VALUE[piece.toUpperCase()];
      const sign = piece === piece.toUpperCase() ? 1 : -1;
      score += sign * value;
      // Small bonus for central control (mild positional nudge)
      const centerDist = Math.abs(3.5 - r) + Math.abs(3.5 - c);
      score += sign * (7 - centerDist) * 2;
      // Pawn advancement bonus: without this, the bot has no incentive to
      // actually push a pawn toward promotion — "walk it 5 squares" is too
      // far beyond a shallow search's horizon to show up in material terms
      // alone. Grows quadratically the closer to the last rank it gets.
      if (piece.toUpperCase() === 'P') {
        const squaresAdvanced = sign === 1 ? (r - 1) : (6 - r); // 0 at own start, up to 5 just before promoting
        score += sign * squaresAdvanced * squaresAdvanced * 3;
      }
    }
  }
  return score;
}

const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// Rough "how promising does this move look before searching it" score, used
// purely to decide search ORDER (not part of the actual evaluation). Trying
// promotions and captures first makes alpha-beta pruning dramatically more
// effective — this is the standard fix for the "slow, unordered minimax"
// problem, and is what was causing multi-second-per-move slowdowns once the
// midgame opened up (far more legal moves per side than the opening, and no
// ordering meant alpha-beta rarely got to cut branches early).
function moveOrderScore(game, move) {
  let score = 0;
  if (move.promotion) {
    score += PIECE_VALUE[move.promotion] * 10; // queening should almost always be tried first
  }
  const targetPiece = game.board[move.to.r][move.to.c];
  if (targetPiece !== ' ') {
    const attacker = game.board[move.from.r][move.from.c];
    // MVV-LVA: prioritize capturing valuable pieces with cheap ones
    score += PIECE_VALUE[targetPiece.toUpperCase()] * 10 - PIECE_VALUE[attacker.toUpperCase()];
  } else if (move.isEnPassant) {
    score += PIECE_VALUE.P * 10;
  }
  return score;
}

function orderMoves(game, moves) {
  return [...moves].sort((a, b) => moveOrderScore(game, b) - moveOrderScore(game, a));
}

function minimax(game, depth, alpha, beta, maximizing) {
  if (depth === 0 || game.isGameOverFlag) {
    return evaluatePosition(game);
  }
  const color = maximizing ? 'w' : 'b';
  const moves = orderMoves(game, game.getAllLegalMoves(color));

  if (moves.length === 0) {
    // Checkmate or stalemate at this node
    if (game.isInCheck(color)) {
      return maximizing ? -100000 - depth : 100000 + depth;
    }
    return 0; // stalemate
  }

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      const next = game.clone();
      next.makeMove(move.from.r, move.from.c, move.to.r, move.to.c, move.promotion);
      const val = minimax(next, depth - 1, alpha, beta, false);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      const next = game.clone();
      next.makeMove(move.from.r, move.from.c, move.to.r, move.to.c, move.promotion);
      const val = minimax(next, depth - 1, alpha, beta, true);
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// Picks a move for `color` to play, searching `depth` plies ahead.
// Returns { move, score } where score is from White's perspective.
function getBotMove(game, color, depth = 3) {
  const moves = game.getAllLegalMoves(color);
  if (moves.length === 0) return null;

  const maximizing = color === 'w';
  let bestMove = null;
  let bestScore = maximizing ? -Infinity : Infinity;

  // Order by how promising each move looks (promotions/captures first) so
  // alpha-beta pruning is effective, then let equally-good moves be picked
  // among with some randomness so the bot doesn't always play the exact
  // same line.
  const ordered = orderMoves(game, moves);

  for (const move of ordered) {
    const next = game.clone();
    next.makeMove(move.from.r, move.from.c, move.to.r, move.to.c, move.promotion);
    const val = minimax(next, depth - 1, -Infinity, Infinity, !maximizing);
    const isBetter = maximizing ? val > bestScore : val < bestScore;
    const isEqual = val === bestScore;
    if (isBetter || (isEqual && Math.random() < 0.3)) {
      bestScore = val;
      bestMove = move;
    }
  }

  return { move: bestMove, score: bestScore };
}