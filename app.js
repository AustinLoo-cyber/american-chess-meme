(function () {
  // Same convention as qi-chess: one solid glyph per piece TYPE, shared by
  // both colors and told apart purely by CSS color/stroke — rather than the
  // hollow-vs-solid Unicode pairs. The black pawn uses a real image asset,
  // matching qi-chess exactly; there's no white-pawn image precedent from
  // qi-chess (its White side was all Xiangqi pieces), so White's pawn uses
  // the solid glyph styled white.
  const PIECE_GLYPHS = {
    K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F',
  };
  const BLACK_PAWN_IMG = 'assets/black_chess_pawn.png';

  let game = new ChessGame();
  let boardFlipped = false;
  let selected = null; // {r,c} of the currently picked-up piece
  let legalMovesForSelected = [];
  let lastMove = null; // {from:{r,c}, to:{r,c}} for highlighting
  let isDragging = false;
  let dragPointerPos = { x: 0, y: 0 };
  let isBotThinking = false;
  let selfPlayActive = false; // mirrors qi-chess's selfPlayActive ref
  let promotionPending = null; // {fromR,fromC,toR,toC} awaiting a promotion choice

  // Move history navigation (mirrors qi-chess's boardHistory/currentMoveIndex).
  // boardHistory[0] is the starting position; boardHistory[i] is the board
  // right after the i-th half-move. currentMoveIndex tracks which snapshot
  // is currently being VIEWED — it only equals boardHistory.length-1 when
  // looking at the live/current position; otherwise the board is locked
  // (read-only) the same way it is in qi-chess.
  let boardHistory = [game.board.map(row => [...row])];
  let currentMoveIndex = 0;

  function isAtLatestMove() {
    return currentMoveIndex === boardHistory.length - 1;
  }
  function getDisplayBoard() {
    return isAtLatestMove() ? game.board : boardHistory[currentMoveIndex];
  }
  function recordMoveInHistory() {
    // Discard any "future" snapshots (shouldn't normally happen since the
    // board is locked while viewing history, but safe to guard anyway).
    boardHistory = boardHistory.slice(0, currentMoveIndex + 1);
    boardHistory.push(game.board.map(row => [...row]));
    currentMoveIndex = boardHistory.length - 1;
  }
  function goToMoveIndex(index) {
    if (index < 0 || index > boardHistory.length - 1) return;
    currentMoveIndex = index;
    selected = null;
    legalMovesForSelected = [];
    renderBoard();
    updateMoveHistory();
  }

  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('statusMessage');
  const evalFillEl = document.getElementById('evalBarFill');
  const evalLabelEl = document.getElementById('evalScoreLabel');
  const moveHistoryListEl = document.getElementById('moveHistoryList');
  const botMoveBtnEl = document.getElementById('botMoveBtn');
  const botVsBotBtnEl = document.getElementById('botVsBotBtn');
  const dragGhostEl = (() => {
    const el = document.createElement('div');
    el.className = 'dragging-piece hidden';
    document.body.appendChild(el);
    return el;
  })();
  const promotionOverlayEl = document.getElementById('promotionOverlay');
  const promotionChoicesEl = document.getElementById('promotionChoices');

  function toVisual(r, c) {
    return boardFlipped ? { r: 7 - r, c: 7 - c } : { r, c };
  }
  function toModel(visR, visC) {
    return boardFlipped ? { r: 7 - visR, c: 7 - visC } : { r: visR, c: visC };
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    const atLatest = isAtLatestMove();
    const displayBoard = getDisplayBoard();
    boardEl.classList.toggle('history-locked', !atLatest);
    for (let visR = 7; visR >= 0; visR--) {
      for (let visC = 0; visC < 8; visC++) {
        const { r, c } = toModel(visR, visC);
        const piece = displayBoard[r][c];
        const sq = document.createElement('div');
        const isLight = (r + c) % 2 === 1;
        sq.className = `square ${isLight ? 'light' : 'dark'}`;
        sq.dataset.r = r;
        sq.dataset.c = c;

        if (piece !== ' ') {
          const type = piece.toUpperCase();
          const isWhite = piece === piece.toUpperCase();
          if (type === 'P' && !isWhite) {
            const img = document.createElement('img');
            img.src = BLACK_PAWN_IMG;
            img.className = 'piece-pawn-img';
            img.draggable = false;
            img.alt = 'black pawn';
            sq.appendChild(img);
          } else {
            const pieceSpan = document.createElement('span');
            pieceSpan.textContent = PIECE_GLYPHS[type];
            pieceSpan.className = (isWhite ? 'piece-white' : 'piece-black') + ' piece-qichess-glyph' + (type === 'P' && isWhite ? ' piece-white-pawn' : '');
            sq.appendChild(pieceSpan);
          }
        }

        // Coordinate labels: rank number on visually-left column, file letter on visually-bottom row
        if (visC === 0) {
          const rankLabel = document.createElement('span');
          rankLabel.className = 'coord-label coord-rank';
          rankLabel.textContent = r + 1;
          sq.appendChild(rankLabel);
        }
        if (visR === 0) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'coord-label coord-file';
          fileLabel.textContent = 'abcdefgh'[c];
          sq.appendChild(fileLabel);
        }

        // Selection/legal-move/last-move/check highlighting only make sense
        // for the live position — while viewing history, the board is a
        // read-only snapshot, same as qi-chess.
        if (atLatest) {
          if (selected && selected.r === r && selected.c === c) {
            sq.classList.add('selected');
          }
          if (lastMove && ((lastMove.from.r === r && lastMove.from.c === c) || (lastMove.to.r === r && lastMove.to.c === c))) {
            sq.classList.add('last-move');
          }
          if (legalMovesForSelected.some(m => m.to.r === r && m.to.c === c)) {
            sq.classList.add(piece !== ' ' ? 'legal-capture' : 'legal-move');
          }
          if (piece.toUpperCase() === 'K' && game.getPieceColor(piece) === game.turn && game.isInCheck(game.turn)) {
            sq.classList.add('in-check');
          }
          sq.addEventListener('pointerdown', onSquarePointerDown);
        }
        boardEl.appendChild(sq);
      }
    }
  }

  function updateStatus() {
    statusEl.textContent = game.statusMessage;
  }

  function updateEvalBar() {
    updateEvalBarWithScore(evaluateMaterial(game.board)); // positive favors White
  }

  function updateEvalBarWithScore(score) {
    const percent = 100 / (1 + Math.exp(-score / 350));
    evalFillEl.style.height = percent + '%';
    evalLabelEl.textContent = (score / 100).toFixed(1);
  }

  function updateMoveHistory() {
    moveHistoryListEl.innerHTML = '';
    const moves = game.moveHistoryAlgebraic;
    for (let i = 0; i < moves.length; i += 2) {
      const moveNum = i / 2 + 1;
      const numEl = document.createElement('div');
      numEl.className = 'move-num';
      numEl.textContent = moveNum + '.';

      const whiteEl = document.createElement('div');
      whiteEl.className = 'move-white';
      // moveHistoryAlgebraic[i] is White's move; it produced boardHistory[i+1]
      const whiteHistoryIndex = i + 1;
      if (moves[i]) {
        whiteEl.textContent = moves[i];
        whiteEl.classList.add('move-clickable');
        if (whiteHistoryIndex === currentMoveIndex) whiteEl.classList.add('move-current');
        whiteEl.addEventListener('click', () => goToMoveIndex(whiteHistoryIndex));
      }

      const blackEl = document.createElement('div');
      blackEl.className = 'move-black';
      const blackHistoryIndex = i + 2;
      if (moves[i + 1]) {
        blackEl.textContent = moves[i + 1];
        blackEl.classList.add('move-clickable');
        if (blackHistoryIndex === currentMoveIndex) blackEl.classList.add('move-current');
        blackEl.addEventListener('click', () => goToMoveIndex(blackHistoryIndex));
      }

      moveHistoryListEl.append(numEl, whiteEl, blackEl);
    }
    if (isAtLatestMove()) {
      moveHistoryListEl.parentElement.scrollTop = moveHistoryListEl.parentElement.scrollHeight;
    }
  }

  function renderAll() {
    renderBoard();
    updateStatus();
    updateMoveHistory();
    updateBotButtonLabels();
    // Deliberately NOT calling updateEvalBar() here — the eval bar should
    // only reflect the bot's own search score (set via handleBotMove /
    // handleSelfPlay), not be live/active during plain human-vs-human play.
  }

  // --- Drag and drop (Pointer Events: works for mouse, touch, and pen) ---

  function onSquarePointerDown(e) {
    if (isBotThinking || game.isGameOverFlag || promotionPending || !isAtLatestMove()) return;
    const r = parseInt(e.currentTarget.dataset.r, 10);
    const c = parseInt(e.currentTarget.dataset.c, 10);
    const piece = game.board[r][c];
    if (piece === ' ' || game.getPieceColor(piece) !== game.turn) {
      // Clicking an empty square or opponent's piece while nothing is
      // selected does nothing (aside from the turn-mismatch message below);
      // if something IS selected, try moving there.
      if (selected) {
        attemptMove(selected.r, selected.c, r, c);
      } else if (piece !== ' ') {
        setStatusText("It's not your turn to move that piece!");
      }
      return;
    }
    e.preventDefault();
    selected = { r, c };
    legalMovesForSelected = game.getLegalMoves(r, c);
    isDragging = true;
    dragPointerPos = { x: e.clientX, y: e.clientY };
    setDragGhostPiece(piece);
    positionDragGhost(e.clientX, e.clientY);
    renderBoard();
  }

  function setDragGhostPiece(piece) {
    const type = piece.toUpperCase();
    const isWhite = piece === piece.toUpperCase();
    dragGhostEl.innerHTML = '';
    dragGhostEl.className = 'dragging-piece';
    if (type === 'P' && !isWhite) {
      const img = document.createElement('img');
      img.src = BLACK_PAWN_IMG;
      img.className = 'piece-pawn-img';
      img.draggable = false;
      dragGhostEl.appendChild(img);
    } else {
      const span = document.createElement('span');
      span.textContent = PIECE_GLYPHS[type];
      span.className = (isWhite ? 'piece-white' : 'piece-black') + ' piece-qichess-glyph' + (type === 'P' && isWhite ? ' piece-white-pawn' : '');
      dragGhostEl.appendChild(span);
    }
  }

  function positionDragGhost(x, y) {
    dragGhostEl.style.left = x + 'px';
    dragGhostEl.style.top = y + 'px';
  }

  document.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    if (e.cancelable) e.preventDefault();
    dragPointerPos = { x: e.clientX, y: e.clientY };
    positionDragGhost(e.clientX, e.clientY);
  }, { passive: false });

  document.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    dragGhostEl.classList.add('hidden');
    const boardRect = boardEl.getBoundingClientRect();
    const sq = boardRect.width / 8;
    const visC = Math.floor((e.clientX - boardRect.left) / sq);
    const visR = 7 - Math.floor((e.clientY - boardRect.top) / sq);
    if (visR < 0 || visR > 7 || visC < 0 || visC > 7) {
      selected = null; legalMovesForSelected = []; renderBoard();
      return;
    }
    const { r, c } = toModel(visR, visC);
    if (selected) attemptMove(selected.r, selected.c, r, c);
  });
  document.addEventListener('pointercancel', () => {
    isDragging = false;
    dragGhostEl.classList.add('hidden');
    selected = null; legalMovesForSelected = [];
    renderBoard();
  });

  function attemptMove(fromR, fromC, toR, toC) {
    const legal = game.getLegalMoves(fromR, fromC);
    const promoMatch = legal.find(m => m.to.r === toR && m.to.c === toC && m.promotion);
    selected = null;
    legalMovesForSelected = [];
    if (promoMatch) {
      // All 4 promotion variants share the same to-square; ask the player which to use.
      promotionPending = { fromR, fromC, toR, toC };
      showPromotionOverlay(game.getPieceColor(game.board[fromR][fromC]));
      return;
    }
    finalizeMove(fromR, fromC, toR, toC);
  }

  function finalizeMove(fromR, fromC, toR, toC, promotion) {
    const moved = game.makeMove(fromR, fromC, toR, toC, promotion);
    if (moved) {
      lastMove = { from: { r: fromR, c: fromC }, to: { r: toR, c: toC } };
      recordMoveInHistory();
    }
    // Regardless of whether the move was valid or not, sync from game.statusMessage —
    // makeMove sets its own "Invalid move..." message on failure, same as qi-chess.
    renderAll();
  }

  function showPromotionOverlay(color) {
    promotionChoicesEl.innerHTML = '';
    for (const type of ['Q', 'R', 'B', 'N']) {
      const btn = document.createElement('button');
      const span = document.createElement('span');
      span.textContent = PIECE_GLYPHS[type];
      span.className = (color === 'w' ? 'piece-white' : 'piece-black') + ' piece-qichess-glyph';
      btn.appendChild(span);
      btn.addEventListener('click', () => {
        const { fromR, fromC, toR, toC } = promotionPending;
        promotionPending = null;
        promotionOverlayEl.classList.add('hidden');
        finalizeMove(fromR, fromC, toR, toC, type);
      });
      promotionChoicesEl.appendChild(btn);
    }
    promotionOverlayEl.classList.remove('hidden');
  }

  // --- Buttons ---
  // This section mirrors qi-chess's handleBotMove / handleSelfPlay / Pause
  // behavior as closely as possible: the same status messages, the same
  // isBotThinking-driven button disabled/label states (not tied to whether
  // self-play itself is running), and the same "graceful stop" pattern
  // where Pause just flips a flag the loop checks between moves.

  document.getElementById('restartBtn').addEventListener('click', () => {
    selfPlayActive = false;
    isBotThinking = false;
    game = new ChessGame();
    selected = null; legalMovesForSelected = []; lastMove = null;
    boardHistory = [game.board.map(row => [...row])];
    currentMoveIndex = 0;
    evalFillEl.style.height = '50%';
    evalLabelEl.textContent = '0.0';
    renderAll();
    updateBotButtonLabels();
  });

  document.getElementById('botMoveBtn').addEventListener('click', handleBotMove);
  document.getElementById('botVsBotBtn').addEventListener('click', handleSelfPlay);
  document.getElementById('pauseBtn').addEventListener('click', () => {
    selfPlayActive = false;
  });

  function setStatusText(text) {
    statusEl.textContent = text;
  }

  function updateBotButtonLabels() {
    const locked = isBotThinking || game.isGameOverFlag || !isAtLatestMove();
    botMoveBtnEl.disabled = locked;
    botMoveBtnEl.textContent = isBotThinking ? 'Bot is moving...' : 'Bot Move';
    botVsBotBtnEl.disabled = locked;
    botVsBotBtnEl.textContent = isBotThinking ? 'Bots are playing...' : 'Bot vs Bot';
  }

  // Performs one bot move for whoever's turn it is. Returns
  // { moved, statusMessage, score } — score is already in "positive
  // favors White" convention from this engine's bot, so (unlike qi-chess's
  // bot, which needed per-mover negation) no sign-flipping is needed here.
  function performBotMove() {
    if (game.isGameOverFlag) {
      return { moved: false, statusMessage: 'Game is over!' };
    }
    const botColor = game.turn;
    const result = getBotMove(game, botColor, 3);
    if (!result || !result.move) {
      return { moved: false, statusMessage: 'Bot has no legal moves.' };
    }
    const { from, to, promotion } = result.move;
    const moved = game.makeMove(from.r, from.c, to.r, to.c, promotion);
    if (moved) {
      lastMove = { from, to };
      recordMoveInHistory();
      return { moved: true, score: result.score };
    }
    return { moved: false, statusMessage: 'Bot suggested an illegal move (engine rejected it).' };
  }

  async function handleBotMove() {
    if (isBotThinking || game.isGameOverFlag || !isAtLatestMove()) {
      setStatusText(isBotThinking ? 'Bot is already thinking...' : (!isAtLatestMove() ? 'Return to the latest move first.' : 'Game is over!'));
      return;
    }
    isBotThinking = true;
    setStatusText(`Bot is thinking for ${game.turn === 'w' ? 'White' : 'Black'}...`);
    updateBotButtonLabels();

    await new Promise((res) => setTimeout(res, 30)); // let the "thinking" state paint before the (synchronous) search blocks the thread
    const { statusMessage, score } = performBotMove();

    isBotThinking = false;
    renderBoard();
    updateMoveHistory();
    if (score !== undefined) updateEvalBarWithScore(score);
    else updateEvalBar();
    setStatusText(statusMessage || game.statusMessage);
    updateBotButtonLabels();
  }

  async function handleSelfPlay() {
    if (game.isGameOverFlag) {
      setStatusText('Game over! Reset to watch again.');
      return;
    }
    if (!isAtLatestMove()) {
      setStatusText('Return to the latest move first.');
      return;
    }
    selfPlayActive = true;
    setStatusText('Bot vs Bot has started...');
    updateBotButtonLabels();

    while (!game.isGameOverFlag && selfPlayActive) {
      isBotThinking = true;
      updateBotButtonLabels();
      await new Promise((res) => setTimeout(res, 30));
      const { statusMessage, score } = performBotMove();

      renderBoard();
      updateMoveHistory();
      if (score !== undefined) updateEvalBarWithScore(score);
      else updateEvalBar();
      setStatusText(statusMessage || game.statusMessage);
      isBotThinking = false;
      updateBotButtonLabels();

      await new Promise((res) => setTimeout(res, 500)); // give the UI time, same pacing as qi-chess
    }

    isBotThinking = false;
    setStatusText(selfPlayActive ? 'Bot vs Bot finished!' : 'Bot vs Bot paused');
    updateBotButtonLabels();
  }

  // --- Move history navigation (arrow keys, matching qi-chess) ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      goToMoveIndex(currentMoveIndex - 1);
    } else if (e.key === 'ArrowRight') {
      goToMoveIndex(currentMoveIndex + 1);
    }
  });

  // --- Flip board ---
  document.getElementById('flipBoardBtn').addEventListener('click', () => {
    boardFlipped = !boardFlipped;
    renderBoard();
  });

  // --- Rules panel ---
  const rulesPanel = document.getElementById('rulesPanel');
  document.getElementById('rulesToggleBtn').addEventListener('click', () => {
    rulesPanel.classList.toggle('hidden');
  });
  document.getElementById('rulesCloseBtn').addEventListener('click', () => {
    rulesPanel.classList.add('hidden');
  });

  renderAll();
})();