import { comboName } from './game.js';

function cardKey(c) {
  const rankMap = {'3':0,'4':1,'5':2,'6':3,'7':4,'8':5,'9':6,'10':7,'J':8,'Q':9,'K':10,'A':11,'2':12};
  const suitMap = {diamonds:0,clubs:1,hearts:2,spades:3};
  return 'c' + (rankMap[c.rank] ?? 99) + '_' + (suitMap[c.suit] ?? 99);
}

function ensureCardEl(card, hideCards, isSelf, playerIdx, cardIdx, state, handEl) {
  // Face-down placeholder cards carry a stable per-seat key (backKey); real
  // cards derive theirs from rank+suit.
  const key = card.backKey || cardKey(card);
  let cardEl = handEl ? handEl.querySelector('.card[data-key="' + key + '"]') : null;

  if (!cardEl) {
    cardEl = document.createElement('div');
    cardEl.dataset.key = key;
    if (hideCards) {
      cardEl.className = 'card face-down';
    } else {
      const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
      cardEl.className = 'card ' + (isRed ? 'red' : 'black');
      cardEl.innerHTML = '<span class="rank">' + card.rank + '</span><span class="suit">' + card.suitSymbol + '</span>';
      cardEl.onclick = (e) => {
        if (!cardEl._dragged) {
          if (navigator.vibrate) navigator.vibrate(10);
          cardEl.classList.remove('tapped');
          void cardEl.offsetWidth;
          cardEl.classList.add('tapped');
          setTimeout(() => cardEl.classList.remove('tapped'), 200);
          state.selectCard(playerIdx, parseInt(cardEl.dataset.idx));
        }
      };
      cardEl.onpointerenter = () => cardEl.classList.add('card-hovered');
      cardEl.onpointerleave = () => cardEl.classList.remove('card-hovered');

      if (isSelf) {
        cardEl.style.cursor = 'grab';
        cardEl.onpointerdown = (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          // Own cards handle every gesture in JS (tap, swipe-up select, drag
          // to center = play, drag on a card = manual sort). 'pan-x' would let
          // the browser steal vertical swipes into page scrolling, so claim
          // all pointer deltas — pointercancel still fires if the OS takes the
          // touch away and cleans the drag up.
          cardEl.style.touchAction = 'none';
          cardEl._dragged = false;
          const start = { x: e.clientX, y: e.clientY };
          const fromIdx = parseInt(cardEl.dataset.idx);
          cardEl.setPointerCapture(e.pointerId);

          const rect = cardEl.getBoundingClientRect();
          const follower = cardEl.cloneNode(true);
          follower.className = cardEl.className + ' drag-follower';
          follower.style.width = rect.width + 'px';
          follower.style.height = rect.height + 'px';
          follower.style.left = rect.left + rect.width / 2 + 'px';
          follower.style.top = rect.top + rect.height / 2 + 'px';
          document.body.appendChild(follower);
          cardEl.classList.add('drag-placeholder');

          let targetIdx = -1;
          const dropZone = document.getElementById('center-cards');
          const swipeMin = Math.max(16, Math.round(rect.height * 0.45));

          const clearHighlights = () => {
            document.querySelectorAll('.drag-target').forEach(el => el.classList.remove('drag-target'));
            if (dropZone) dropZone.classList.remove('play-drop-active');
          };

          const onMove = (ev) => {
            const dx = ev.clientX - start.x;
            const dy = ev.clientY - start.y;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) cardEl._dragged = true;
            follower.style.left = ev.clientX + 'px';
            follower.style.top = ev.clientY + 'px';

            clearHighlights();
            const elUnder = document.elementFromPoint(ev.clientX, ev.clientY);
            if (elUnder) {
              const overDrop = elUnder.closest ? elUnder.closest('#center-cards') : null;
              if (overDrop) {
                if (dropZone) dropZone.classList.add('play-drop-active');
                return;
              }
              const targetEl = elUnder.closest('.hand-bottom .card[data-idx]');
              if (targetEl && targetEl !== cardEl) {
                targetEl.classList.add('drag-target');
                targetIdx = parseInt(targetEl.dataset.idx);
              } else {
                targetIdx = -1;
              }
            }
          };

          const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            follower.remove();
            cardEl.classList.remove('drag-placeholder');
            clearHighlights();

            if (!cardEl._dragged) return; // plain tap -> onclick handles select

            const dx = ev.clientX - start.x;
            const dy = ev.clientY - start.y;
            const elUnder = document.elementFromPoint(ev.clientX, ev.clientY);
            const overDrop = elUnder && elUnder.closest ? elUnder.closest('#center-cards') : null;

            // 1) Dropped on the center play zone -> drag & drop to play.
            if (overDrop) {
              if (state.dragToPlay) state.dragToPlay(playerIdx, fromIdx);
              return;
            }

            // 2) Mostly-vertical upward swipe -> activate (select) the card.
            if (dy < -swipeMin && Math.abs(dx) < Math.abs(dy) * 0.6) {
              if (navigator.vibrate) navigator.vibrate(10);
              state.selectCard(playerIdx, fromIdx);
              return;
            }

            // 3) Dropped on another hand card -> manual sort (reorder).
            if (targetIdx >= 0 && targetIdx !== fromIdx) {
              let adjTarget = targetIdx;
              if (fromIdx < targetIdx) adjTarget = targetIdx - 1;
              const hands = state.hands;
              const [moved] = hands[playerIdx].splice(fromIdx, 1);
              hands[playerIdx].splice(adjTarget, 0, moved);
              if (state.onManualReorder) {
                state.onManualReorder(hands[playerIdx].map(c => c.rank + ':' + c.suit));
              }
              render(state);
            }
          };

          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          cardEl.addEventListener('pointercancel', () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            follower.remove();
            cardEl.classList.remove('drag-placeholder');
            clearHighlights();
          }, { once: true });
        };
      }
    }
  }

  cardEl.dataset.idx = cardIdx;
  if (hideCards) {
    if (!cardEl.classList.contains('face-down')) {
      cardEl.className = 'card face-down';
      cardEl.innerHTML = '';
      cardEl.onclick = null;
      cardEl.onpointerdown = null;
      cardEl.onpointerenter = null;
      cardEl.onpointerleave = null;
    }
  } else {
    if (cardEl.classList.contains('face-down')) {
      const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
      cardEl.className = 'card ' + (isRed ? 'red' : 'black') + (card.selected ? ' selected' : '');
      cardEl.innerHTML = '<span class="rank">' + card.rank + '</span><span class="suit">' + card.suitSymbol + '</span>';
      cardEl.onclick = (e) => {
        if (!cardEl._dragged) {
          if (navigator.vibrate) navigator.vibrate(10);
          cardEl.classList.remove('tapped');
          void cardEl.offsetWidth;
          cardEl.classList.add('tapped');
          setTimeout(() => cardEl.classList.remove('tapped'), 200);
          state.selectCard(playerIdx, parseInt(cardEl.dataset.idx));
        }
      };
      cardEl.onpointerenter = () => cardEl.classList.add('card-hovered');
      cardEl.onpointerleave = () => cardEl.classList.remove('card-hovered');
    } else {
      const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
      const expectedClass = 'card ' + (isRed ? 'red' : 'black') + (card.selected ? ' selected' : '');
      if (cardEl.className !== expectedClass) cardEl.className = expectedClass;
      if (!cardEl.onclick) {
        cardEl.onclick = (e) => {
          if (!cardEl._dragged) {
            if (navigator.vibrate) navigator.vibrate(10);
            cardEl.classList.remove('tapped');
            void cardEl.offsetWidth;
            cardEl.classList.add('tapped');
            setTimeout(() => cardEl.classList.remove('tapped'), 200);
            state.selectCard(playerIdx, parseInt(cardEl.dataset.idx));
          }
        };
        cardEl.onpointerenter = () => cardEl.classList.add('card-hovered');
        cardEl.onpointerleave = () => cardEl.classList.remove('card-hovered');
      }
    }
  }

  return cardEl;
}

export function render(state) {
  const { hands, currentPlayer, trick, gameOver, playerNames, finishedOrder } = state;
  const isHuman = state.isHuman || [];
  const playerId = state._playerId;

  if (currentPlayer !== state._lastActive) {
    for (let i = 0; i < 4; i++) {
      (hands[i] || []).forEach(c => c.selected = false);
    }
    state._lastActive = currentPlayer;
  }

  updateScoreboard(state);
  renderLog(state);

  // Test hook: expose current turn on the table area so E2E tests can poll
  // it without module scope access.
  const tableArea = document.getElementById('table-area');
  if (tableArea) {
    tableArea.dataset.currentPlayer = String(currentPlayer ?? '');
    tableArea.dataset.phase = String(state.phase ?? '');
  }

  // Position players relative to human player (always bottom)
  // offset from self: 0=bottom, 1=right, 2=top, 3=left
  const posToPlayer = [0, 1, 2, 3].map(offset => (playerId + offset) % 4);
  const playerToPos = [0, 0, 0, 0];
  posToPlayer.forEach((pid, pos) => { playerToPos[pid] = pos; });
  const posNames = ['bottom', 'right', 'top', 'left'];

  for (let pos = 0; pos < 4; pos++) {
    const i = posToPlayer[pos]; // player ID at this visual position
    const area = document.getElementById('player-' + pos);
    if (!area) continue;

    const isActive = i === currentPlayer && !gameOver && state.phase && state.phase !== 'lobby';
    const isHumanPlayer = isHuman[i];
    const hand = hands[i] || [];
    const isFinished = finishedOrder.includes(i);
    const isSelf = i === playerId;

    // Opponents' card faces are private: the server masks their `hand` to []
    // and only sends the public `handCount`. That count is the truth for both
    // the label below and the number of face-down cards rendered per seat.
    const publicCount = (state.handCounts && state.handCounts[i] != null)
      ? state.handCounts[i]
      : hand.length;

    area.classList.toggle('active-player', isActive);

    const handClass = pos === 2 ? 'hand-top' : pos === 3 ? 'hand-left' : pos === 1 ? 'hand-right' : 'hand-bottom';
    // Side seats are narrow columns (28-48px). A 13-card strip overflows and
    // forces scrollbars/microscopic cards, so they render a compact 3-card
    // deck fan and the full count lives in a badge. The top seat is wide
    // enough to show the full strip of backs.
    const isSideSeat = pos === 1 || pos === 3;

    // Update or create player-label
    let labelEl = area.querySelector('.player-label');
    // A seat is "occupied" only once the server has added a player there
    // (bots are only created at game start, so empty lobby seats must not
    // render as "undefined" + a fake BOT badge).
    const occupied = playerNames[i] != null;
    let label = '';
    if (isActive && !gameOver) {
      label = '<span class="turn-badge">' + (isHumanPlayer ? 'YOUR TURN' : 'THINKING...') + '</span>';
    }
    if (occupied && !isHumanPlayer) {
      label += ' <span class="bot-badge">BOT</span>';
    }
    if (isFinished) {
      label += ' <span class="finished-badge">FINISHED</span>';
    }
    const expectedLabel =
      '<div class="player-label">' +
        '<span class="player-name">' + (occupied ? playerNames[i] : 'Empty') + '</span>' +
        (occupied
          ? ' <span class="count-badge" data-count="' + (isSelf ? hand.length : publicCount) + '">' + (isSelf ? hand.length : publicCount) + '</span>'
          : '') +
        label +
      '</div>';
    if (!labelEl || labelEl.outerHTML !== expectedLabel) {
      if (labelEl) labelEl.remove();
      area.insertAdjacentHTML('afterbegin', expectedLabel);
    }

    // Get or create hand container
    let handEl = area.querySelector('.hand');
    if (!handEl) {
      handEl = document.createElement('div');
      handEl.className = 'hand ' + handClass;
      handEl.id = 'hand-' + i;
      area.appendChild(handEl);
    } else if (handEl.className !== ('hand ' + handClass)) {
      handEl.className = 'hand ' + handClass;
    }

    const hideCards = !isSelf;

    // What we actually render in this seat. For opponents the masked hand is
    // empty, so instead we synthesize `publicCount` face-down placeholders —
    // the number of cards an opponent still holds is public in Poker Banting.
    // Side seats cap at 3 (deck fan; the badge carries the exact count), the top
    // seat shows the full strip.
    const sideCap = 3;
    const backCount = hideCards ? (isSideSeat ? Math.min(sideCap, publicCount) : publicCount) : 0;
    const renderCards = hideCards
      ? Array.from({ length: backCount }, (_, b) => ({ backKey: 'back-' + i + '-' + b }))
      : hand;

    // Diff cards: build set of keys in hand, reuse existing DOM nodes
    const handKeys = new Set(renderCards.map(c => (c.backKey || cardKey(c))));
    const existing = handEl.querySelectorAll('.card');
    existing.forEach(el => {
      if (!handKeys.has(el.dataset.key)) el.remove();
    });

    // Build map of existing cards by key for reuse
    const existingByKey = {};
    handEl.querySelectorAll('.card').forEach(el => { existingByKey[el.dataset.key] = el; });

    // Reorder / append cards to match hand order
    const fragment = document.createDocumentFragment();
    renderCards.forEach((card, idx) => {
      const key = card.backKey || cardKey(card);
      let cardEl = existingByKey[key];
      if (cardEl) {
        cardEl.dataset.idx = idx;
        if (!hideCards) {
          const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
          const expectedClass = 'card ' + (isRed ? 'red' : 'black') + (card.selected ? ' selected' : '');
          if (cardEl.className !== expectedClass) cardEl.className = expectedClass;
        }
        fragment.appendChild(cardEl);
      } else {
        fragment.appendChild(ensureCardEl(card, hideCards, isSelf, i, idx, state, handEl));
      }
    });
    handEl.appendChild(fragment);
  }

  renderCenter(state);
  renderActionBar(state);
  adjustHandSizing();
}

let lastCenterKey = '';
function centerKey(state) {
  const tc = state.trick.combo;
  if (!tc) return 'empty:' + state.currentPlayer;
  return tc.cards.map(cardKey).join(',');
}

function renderCenter(state) {
  const centerCards = document.getElementById('center-cards');
  const centerInfo = document.getElementById('center-info');
  const passMarkers = document.getElementById('pass-markers');
  if (!centerCards || !centerInfo || !passMarkers) return;

  const key = centerKey(state);
  const tableCombo = state.trick.combo;
  const playerNames = state.playerNames;

  // Only rebuild if combo changed
  const expectedInfo = tableCombo
    ? comboName(tableCombo) + ' by ' + playerNames[state.trick.comboPlayer]
    : (state.gameOver ? 'Game Over' : 'New trick — ' + playerNames[state.currentPlayer] + ' plays first');

  if (centerInfo.textContent !== expectedInfo) centerInfo.textContent = expectedInfo;

  if (key !== lastCenterKey) {
    lastCenterKey = key;
    centerCards.innerHTML = '';
    if (tableCombo) {
      tableCombo.cards.forEach(card => {
        const cardEl = document.createElement('div');
        const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
        cardEl.className = 'card ' + (isRed ? 'red' : 'black');
        cardEl.style.cursor = 'default';
        cardEl.innerHTML = '<span class="rank">' + card.rank + '</span><span class="suit">' + card.suitSymbol + '</span>';
        centerCards.appendChild(cardEl);
      });
    }
  }

  const expectedPassKey = state.trick.passed.map(p => String(p)).join(',');
  const currentPassKey = passMarkers.dataset.passKey || '';
  if (expectedPassKey !== currentPassKey) {
    passMarkers.dataset.passKey = expectedPassKey;
    passMarkers.innerHTML = '';
    state.trick.passed.forEach(p => {
      const tag = document.createElement('span');
      tag.className = 'pass-tag';
      tag.textContent = playerNames[p] + ' Pass';
      passMarkers.appendChild(tag);
    });
  }
}

function renderActionBar(state) {
  const actionBar = document.getElementById('action-bar');
  if (!actionBar) return;

  const playerId = state._playerId;
  const isMyTurn = playerId !== null && state.currentPlayer === playerId && !state.gameOver && !state.threePhase;
  const gameStarted = state.phase && state.phase !== 'lobby';

  // The center trick area doubles as a drag-to-play drop zone; only show it
  // as a target when it can actually accept a card (your turn, playing).
  const dropZone = document.getElementById('center-cards');
  if (dropZone) dropZone.classList.toggle('play-dropzone', isMyTurn && gameStarted);

  // Gesture hint (mobile only, CSS): shown while it's your turn so the three
  // touch gestures are discoverable; hidden otherwise (also by CSS on
  // desktop, where the mouse makes them optional).
  const gestureHint = document.getElementById('gesture-hint');
  if (gestureHint) gestureHint.style.display = (isMyTurn && gameStarted) ? '' : 'none';

  if (state.gameOver || !isMyTurn || !gameStarted) {
    actionBar.classList.remove('visible');
    const btnSort = document.getElementById('btn-sort');
    if (btnSort) btnSort.disabled = true;
    // The turn hint now lives in the always-visible table center (it used to
    // ride inside this bar, so it auto-hid with the bar). Clear stale
    // preview/error text when the bar hides — updatePlayButton() only runs
    // on the human's turn, so this is the only place it gets reset.
    const preview = document.getElementById('combo-preview');
    const errorMsg = document.getElementById('error-msg');
    if (preview) preview.textContent = '';
    if (errorMsg) errorMsg.textContent = '';
  } else {
    actionBar.classList.add('visible');
    const btnSort = document.getElementById('btn-sort');
    if (btnSort) btnSort.disabled = false;
    if (state.updatePlayButton) state.updatePlayButton();
  }
}

export function renderThreePhaseOverlay(state) {
  const { threePhaseCards, threePhaseOrder, threePhaseIndex, threePhaseDiscarded, threePhaseCounts, currentPlayer, threePhase, playerNames, isHuman, _playerId } = state;

  const overlay = document.getElementById('three-phase-overlay');
  const grid = document.getElementById('three-discard-grid');
  const centerInfo = document.getElementById('three-phase-center-info');
  if (!overlay || !grid) return;

  overlay.classList.add('show');
  grid.innerHTML = '';

  const posToPlayer = [0, 1, 2, 3].map(offset => (_playerId + offset) % 4);
  for (let pos = 0; pos < 4; pos++) {
    const i = posToPlayer[pos];
    const playerDiv = document.createElement('div');
    playerDiv.className = 'three-discard-player';

    const nameDiv = document.createElement('div');
    const isActive = i === currentPlayer && threePhase;
    const isDiscarded = threePhaseDiscarded[i];
    nameDiv.className = 'tdp-name' + (isActive ? ' active' : '') + (isDiscarded ? ' discarded' : '');
    nameDiv.textContent = playerNames[i];

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'tdp-cards';

    const threes = threePhaseCards[i] || [];
    if (threes.length > 0) {
      threes.forEach(card => {
        const cardEl = document.createElement('div');
        const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
        cardEl.className = 'card ' + (isRed ? 'red' : 'black');
        if (isDiscarded) cardEl.classList.add('discarding');
        cardEl.innerHTML = '<span class="rank">' + card.rank + '</span><span class="suit">' + card.suitSymbol + '</span>';
        cardsDiv.appendChild(cardEl);
      });
    } else if (isDiscarded) {
      const emptyEl = document.createElement('span');
      emptyEl.style.cssText = 'color:#666;font-size:12px;';
      emptyEl.textContent = '—';
      cardsDiv.appendChild(emptyEl);
    } else {
      const emptyEl = document.createElement('span');
      emptyEl.style.cssText = 'color:#666;font-size:12px;';
      // The 3s themselves are public during the discard phase (removed from
      // all hands up front, never re-enter play), so normally the real cards
      // render above. This branch only hits when the server omits a player's
      // 3s — fall back to the public count via threeDiscard.playerCounts.
      const cnt = threePhaseCounts ? (threePhaseCounts[i] || 0) : 0;
      emptyEl.textContent = cnt > 0 ? (cnt + (cnt === 1 ? ' 3' : ' 3s')) : 'no 3s';
      cardsDiv.appendChild(emptyEl);
    }

    playerDiv.appendChild(nameDiv);
    playerDiv.appendChild(cardsDiv);
    grid.appendChild(playerDiv);
  }

  if (centerInfo) {
    if (threePhase) {
      const activeIdx = threePhaseOrder[threePhaseIndex];
      centerInfo.textContent = isHuman[activeIdx] ? 'Your turn — discard your 3s' : playerNames[activeIdx] + ' is discarding 3s...';
    } else {
      centerInfo.textContent = 'All 3s discarded. Game begins!';
    }
  }
}

export function updateScoreboard(state) {
  const { playerNames, scores, isHuman, _playerId } = state;
  const sb = document.getElementById('scoreboard');
  if (!sb) return;

  const scoreKey = scores.join(',');
  if (sb.dataset.scoreKey === scoreKey && sb.dataset.playerId === String(_playerId)) return;
  sb.dataset.scoreKey = scoreKey;
  sb.dataset.playerId = String(_playerId);

  sb.innerHTML = '';
  const posToPlayer = [0, 1, 2, 3].map(offset => (_playerId + offset) % 4);
  for (let pos = 0; pos < 4; pos++) {
    const i = posToPlayer[pos];
    // Empty seats (lobby, before bots are added) have no name/score yet —
    // render them as a dim "Empty" row instead of "undefined pts".
    const has = playerNames[i] != null;
    const name = has ? playerNames[i] : 'Empty';
    const pts = (scores[i] != null ? scores[i] : 0);
    const badge = (has && !isHuman[i]) ? ' <span style="color:#64b5f6;font-size:10px;">[BOT]</span>' : '';
    const row = document.createElement('div');
    row.className = 'score-row' + (has ? '' : ' empty-seat');
    row.innerHTML = '<span class="name">' + name + badge + '</span><span class="pts">' + pts + ' pts</span>';
    sb.appendChild(row);
  }
}

export function renderLobby(state) {
  // No-op — party screen handles player list rendering
}

// Renders new log entries into every log container: the desktop sidebar
// (#log, hidden on mobile) and the mobile bottom sheet (#sheet-log, hidden
// on desktop). Both track their own renderedCount so incremental appends
// work independently.
function renderLog(state) {
  const logEntries = state.log || [];
  const targets = ['log', 'sheet-log'].map(id => document.getElementById(id)).filter(Boolean);
  for (const logEl of targets) {
    const renderedCount = parseInt(logEl.dataset.renderedCount || '0');
    if (logEntries.length <= renderedCount) continue;
    for (let i = renderedCount; i < logEntries.length; i++) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = logEntries[i];
      logEl.appendChild(entry);
    }
    logEl.dataset.renderedCount = logEntries.length;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

let sizingRAFId = null;

export function adjustHandSizing() {
  if (sizingRAFId) cancelAnimationFrame(sizingRAFId);
  sizingRAFId = requestAnimationFrame(performHandSizing);
}

function performHandSizing() {
  sizingRAFId = null;

  // Set paddingBottom on table-area for mobile to clear action bar + sidebar
  const tableArea = document.getElementById('table-area');
  if (!tableArea) return;

  const isMobilePortrait = window.matchMedia('(max-width: 768px) and (orientation: portrait)').matches;
  const isMobileLandscape = window.matchMedia('(max-height: 768px) and (orientation: landscape) and (min-width: 480px) and (max-width: 820px)').matches;
  const isShortLandscape = window.matchMedia('(max-height: 400px) and (orientation: landscape)').matches;
  const isMobile = isMobilePortrait || isMobileLandscape || isShortLandscape;

  if (!isMobile) {
    tableArea.style.paddingBottom = '';
    clearAllSizing();
    return;
  }

  // --- Batch all reads first ---
  const sidebar = document.getElementById('sidebar');
  const actionBar = document.getElementById('action-bar');
  const sidebarHeight = sidebar ? sidebar.offsetHeight : 60;
  const actionBarHeight = actionBar && actionBar.classList.contains('visible') ? actionBar.offsetHeight : 44;
    const clearance = sidebarHeight + actionBarHeight + 4;

  const handBottom = document.querySelector('.hand-bottom');
  let cardW = 0, cardH = 0, rankFontSize = 0, suitFontSize = 0;
  let needSizing = false;

  if (handBottom) {
    const cards = handBottom.querySelectorAll('.card');
    if (cards.length > 0) {
      const handRect = handBottom.getBoundingClientRect();
      const style = getComputedStyle(handBottom);
      const paddingL = parseFloat(style.paddingLeft) || 0;
      const paddingR = parseFloat(style.paddingRight) || 0;
      const availWidth = handRect.width - paddingL - paddingR;
      const gap = 1;
      const overlap = -6;
      const effectiveGap = cards.length > 1 ? Math.max(gap, overlap) : 0;
      const totalGap = effectiveGap * (cards.length - 1);
      cardW = Math.max(16, Math.min(44, Math.floor((availWidth - totalGap) / cards.length)));
      cardH = Math.round(cardW * 1.375);
      rankFontSize = Math.max(7, Math.round(cardW * 0.44));
      suitFontSize = Math.max(8, Math.round(cardW * 0.56));
      needSizing = true;
    }
  }

  // --- Batch all writes after reads ---
  tableArea.style.paddingBottom = clearance + 'px';

  if (!needSizing) {
    clearAllSizing();
    return;
  }

  const allCards = document.querySelectorAll('.card');
  allCards.forEach(c => {
    if (c.closest('.hand-bottom')) {
      c.style.width = cardW + 'px';
      c.style.height = cardH + 'px';
      c.style.minWidth = cardW + 'px';
      const rankEl = c.querySelector('.rank');
      const suitEl = c.querySelector('.suit');
      if (rankEl) rankEl.style.fontSize = rankFontSize + 'px';
      if (suitEl) suitEl.style.fontSize = suitFontSize + 'px';
    } else {
      c.style.width = ''; c.style.height = ''; c.style.minWidth = '';
      const rankEl = c.querySelector('.rank');
      const suitEl = c.querySelector('.suit');
      if (rankEl) rankEl.style.fontSize = '';
      if (suitEl) suitEl.style.fontSize = '';
    }
  });

  const allHands = document.querySelectorAll('.hand-top, .hand-bottom, .hand-left, .hand-right');
  allHands.forEach(h => {
    h.style.gap = '';
    h.style.justifyContent = '';
    h.style.overflowX = '';
    h.style.overflowY = '';
  });

}

// Shrink the opponent hand strips so they fit their seats. The base CSS gives
// side cards a fixed box with -6px margins; at 13 face-down cards in a short
// viewport that overflows the seat and clips. We measure the real strip extent
// and, if it doesn't fit, shrink per-card size (keeping the card ratio) until
// the computed extent fits, so no seat ever clips its strip.
function clearAllSizing() {
  const allCards = document.querySelectorAll('.card');
  allCards.forEach(c => {
    c.style.width = ''; c.style.height = ''; c.style.minWidth = '';
    const rankEl = c.querySelector('.rank');
    const suitEl = c.querySelector('.suit');
    if (rankEl) rankEl.style.fontSize = '';
    if (suitEl) suitEl.style.fontSize = '';
  });

  const allHands = document.querySelectorAll('.hand-top, .hand-bottom, .hand-left, .hand-right');
  allHands.forEach(h => {
    h.style.gap = '';
    h.style.justifyContent = '';
    h.style.overflowX = '';
    h.style.overflowY = '';
  });
}
