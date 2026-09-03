import { comboName } from './game.js';

// Live view of the app state (index.html wires it to the app's state var).
// Drag handlers must read state THROUGH this at release time, not through
// their closure: a server frame can replace `state` mid-drag, and the
// closure copy would then be stale.
const liveState = () => (typeof window !== 'undefined' && window.__app_state)
  ? window.__app_state() : null;

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
          // Own cards handle every gesture in JS (tap, swipe OUT OF THE
          // ACTIVE BOX = play, drag between cards = manual sort, drag to
          // center = play). 'pan-x' would let the browser steal vertical
          // swipes into page scrolling, so claim all pointer deltas —
          // pointercancel still fires if the OS takes the touch away and
          // cleans the drag up.
          cardEl.style.touchAction = 'none';
          cardEl._dragged = false;
          const start = { x: e.clientX, y: e.clientY };
          const fromIdx = parseInt(cardEl.dataset.idx);
          try { cardEl.setPointerCapture(e.pointerId); } catch (_) { /* synthetic/ended pointers */ }

          const rect = cardEl.getBoundingClientRect();
          const follower = cardEl.cloneNode(true);
          follower.className = cardEl.className.replace(/\s*(drag-placeholder|selected|card-hovered|tapped)/g, '').trim() + ' drag-follower';
          // Wipe the source card's fan positioning — the follower is
          // pointer-tracked; left/top are set on every pointermove.
          follower.style.cssText = '';
          follower.style.width = rect.width + 'px';
          follower.style.height = rect.height + 'px';
          follower.style.left = (rect.left + rect.width / 2) + 'px';
          follower.style.top = (rect.top + rect.height / 2) + 'px';
          document.body.appendChild(follower);
          cardEl.classList.add('drag-placeholder');

          let targetIdx = -1;
          let playArmed = false; // set once the card leaves the active box
          const dropZone = document.getElementById('center-cards');
          // Swipe-to-play boundary: the gold "active box" is this seat's
          // #player-bottom area. The play fires when the DRAGGED CARD has
          // left the box — i.e. its top edge crosses the box's top border
          // (the follower is pointer-centered, so card top = pointer y -
          // cardH/2). A small 8px margin avoids firing on a pixel of jitter.
          // Self-relative geometry, so it holds at any resolution.
          const boxEl = cardEl.closest('#player-0') || cardEl.parentElement;
          const boxRect = boxEl ? boxEl.getBoundingClientRect() : null;
          const playExitY = boxRect ? (boxRect.top - rect.height / 2 - 8) : (rect.top - rect.height);

          // Fan slots: the x-position of every card's visual center. Dropping
          // "on a card" is decided by nearest slot (geometric), not by
          // elementFromPoint — with a fanned, overlapping hand the topmost
          // element at the pointer is often NOT the card you're aiming at.
          const slotXs = () => Array.from(document.querySelectorAll('.hand-bottom > .card'))
            .map(el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
          const nearestSlot = (x) => {
            const xs = slotXs();
            let best = -1, bestD = Infinity;
            for (let i = 0; i < xs.length; i++) {
              const d = Math.abs(xs[i] - x);
              if (d < bestD) { bestD = d; best = i; }
            }
            // Generous: a drop anywhere in the hand strip lands on the closest slot.
            return (best >= 0 && bestD < 90) ? best : -1;
          };

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

            // SWIPE-TO-PLAY (the primary play gesture): the card has left the
            // active yellow box — its top edge crossed the box's top border.
            // Fires immediately on the crossing, no release needed (real card
            // flick). Requires a near-vertical move so horizontal manual-sort
            // drags and side flicks can never arm it. Once armed the gesture
            // is committed: any later release location is ignored (onUp).
            if (!playArmed && dy < 0 && Math.abs(dx) < Math.abs(dy) * 0.75
                && ev.clientY <= playExitY) {
              playArmed = true;
              clearHighlights();
              if (dropZone) dropZone.classList.add('play-drop-active');
              const live = liveState() || state;
              if (live.dragToPlay) live.dragToPlay(playerIdx, parseInt(cardEl.dataset.idx));
              return;
            }

            clearHighlights();
            const elUnder = document.elementFromPoint(ev.clientX, ev.clientY);
            if (elUnder) {
              const overDrop = elUnder.closest ? elUnder.closest('#center-cards') : null;
              if (overDrop) {
                if (dropZone) dropZone.classList.add('play-drop-active');
                return;
              }
            }
            const slot = nearestSlot(ev.clientX);
            if (slot >= 0 && slot !== fromIdx) {
              const targetEl = document.querySelector('.hand-bottom > .card:nth-child(' + (slot + 1) + ')');
              if (targetEl) targetEl.classList.add('drag-target');
              targetIdx = slot;
            } else {
              targetIdx = -1;
            }
          };

          const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            follower.remove();
            cardEl.classList.remove('drag-placeholder');
            clearHighlights();

            // The play already fired while the card was leaving the box.
            if (playArmed) return;

            if (!cardEl._dragged) return; // plain tap -> onclick handles select

            // The gesture may outlive a server frame: a frame replaces the app
            // state with a FRESH object while this handler still closes over the
            // old one. Reading `state` here would splice a stale hands array and
            // render() the stale object over the fresh one — the hand visibly
            // resets and the manual move is lost. Always resolve the CURRENT
            // state (and the card's CURRENT index — a frame may have re-indexed
            // the hand) at release time.
            const live = liveState() || state;
            const connIdx = parseInt(cardEl.dataset.idx);
            const hand = (live.hands && live.hands[playerIdx]) || [];
            const movedCard = hand[connIdx];
            if (!movedCard || cardKey(movedCard) !== cardEl.dataset.key) {
              // Card no longer exists in the live hand (played away mid-drag,
              // redeal, ...): the DOM self-corrects on the next real frame.
              return;
            }
            const dragToPlay = live.dragToPlay;
            const onManualReorder = live.onManualReorder;

            const dx = ev.clientX - start.x;
            const elUnder = document.elementFromPoint(ev.clientX, ev.clientY);
            const overDrop = elUnder && elUnder.closest ? elUnder.closest('#center-cards') : null;

            // 1) Dropped on the center play zone -> drag & drop to play.
            if (overDrop) {
              if (dragToPlay) dragToPlay(playerIdx, connIdx);
              return;
            }

            // 2) Dropped anywhere along the hand -> manual sort: the card
            //    takes the nearest slot (index = slot number).
            const slot = nearestSlot(ev.clientX);
            if (slot >= 0 && slot !== connIdx) {
              const [moved] = hand.splice(connIdx, 1);
              hand.splice(slot, 0, moved);
              if (onManualReorder) {
                onManualReorder(hand.map(c => c.rank + ':' + c.suit));
              }
              render(live);
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
    // Every opponent seat shows its FULL count (stacked fan; layoutOppFan
    // sizes them to fit the seat at any resolution).
    const backCount = hideCards ? publicCount : 0;
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
          let expectedClass = 'card ' + (isRed ? 'red' : 'black') + (card.selected ? ' selected' : '');
          // Mid-drag: this seat is being mutated in place. Keep the drag
          // markers (placeholder on the source, target highlight on the drop
          // slot) alive through the rebuild — wiping them would both break the
          // sizing guards and reset the highlight mid-gesture.
          if (cardEl.classList.contains('drag-placeholder')) expectedClass += ' drag-placeholder';
          if (cardEl.classList.contains('drag-target')) expectedClass += ' drag-target';
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

  if (state.gameOver || !isMyTurn || !gameStarted) {
    // Hiding = fade out, NOT display:none: the bar keeps its layout box so
    // performHandSizing() measures a stable clearance. A per-frame state
    // update (bots discarding 3s, turn cycling) flipping display:none ↔
    // flex changed the table's padding-bottom every frame, which repositioned
    // the whole hand — the "blink" under a touch drag.
    actionBar.classList.remove('visible');
    actionBar.classList.add('hidden');
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
    actionBar.classList.remove('hidden');
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

  // Mid-drag: the hand is being mutated in place; do NOT re-flow any fan or
  // change the table's bottom clearance. The drag follower lives on <body>
  // (tracks the pointer), the placeholder lives inside the hand container.
  // Shifting the container (via paddingBottom → grid row shift) disconnects
  // them → the hand "jumps" under the dragged card. Skip the entire re-layout;
  // it re-runs on the next non-drag frame.
  if (document.querySelector('.drag-placeholder')) return;

  // Set paddingBottom on table-area for mobile to clear action bar + sidebar
  const tableArea = document.getElementById('table-area');
  if (!tableArea) return;

  const isMobilePortrait = window.matchMedia('(max-width: 768px) and (orientation: portrait)').matches;
  const isMobileLandscape = window.matchMedia('(max-height: 768px) and (orientation: landscape) and (min-width: 480px) and (max-width: 820px)').matches;
  const isShortLandscape = window.matchMedia('(max-height: 400px) and (orientation: landscape)').matches;
  const isMobile = isMobilePortrait || isMobileLandscape || isShortLandscape;

  const sidebar = document.getElementById('sidebar');
  const actionBar = document.getElementById('action-bar');
  const sidebarHeight = sidebar ? sidebar.offsetHeight : 60;
  // The action bar always keeps its layout box (display:flex; opacity/
  // visibility toggled via .visible), so offsetHeight is stable regardless of
  // whether the bar is "shown". Measuring it unconditionally keeps the table's
  // bottom clearance constant across turn changes — no per-frame grid shift.
  const actionBarHeight = actionBar ? actionBar.offsetHeight : 44;
  const clearance = sidebarHeight + actionBarHeight + 4;
  tableArea.style.paddingBottom = isMobile ? (clearance + 'px') : '';

  layoutBottomFan();

  // Opponent seats: fan out the FULL face-down count. Top seat = horizontal
  // fan bowing toward the table; side seats = vertical fans whose center card
  // reaches furthest toward the table center.
  layoutOppFan(document.getElementById('player-2'), 2);
  layoutOppFan(document.getElementById('player-3'), 3);
  layoutOppFan(document.getElementById('player-1'), 1);
}

// Lay the human's own hand (bottom seat) out as a FAN: every card is
// absolutely positioned on a shallow arc, rotated around a common pivot
// below the hand (like holding cards). Cards are sized from the available
// width so a full 13-card hand still fits — and at readable size — on a
// phone. The geometry (slot centers, card widths) is also what the
// drag-to-reorder gesture uses as its drop targets (see ensureCardEl).
function layoutBottomFan() {
  const handEl = document.querySelector('.hand-bottom');
  if (!handEl) return;
  const cards = Array.from(handEl.querySelectorAll(':scope > .card'));
  const n = cards.length;
  if (n === 0) { handEl.style.height = '66px'; handEl.removeAttribute('data-ready'); return; }
  // Mid-drag: the hand is being mutated in place; do not re-flow the fan
  // (the drag follower tracks the pointer, the placeholder must not slide).
  if (handEl.querySelector('.drag-placeholder')) return;

  const style = getComputedStyle(handEl);
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const innerW = handEl.clientWidth - padL - padR;

  // Height budget: the fan's LAYOUT height is bounded by the viewport, but its
  // visual top may overlap the (visually empty) bottom of the center row —
  // the fan is z-indexed above it (CSS), so we claim `overlap` px of headroom
  // on top of the budget. Rule of thumb: ~17% of the viewport (portrait
  // phones), ~15% on short/landscape ones.
  let budget = Math.min(140, Math.round(window.innerHeight * 0.17));
  if (window.innerHeight < 520) budget = Math.max(60, Math.round(window.innerHeight * 0.15));
  const overlap = 22;

  const pitchRatio = n >= 8 ? 0.75 : n >= 5 ? 0.85 : 1;
  const maxSpan = Math.min(innerW - 4, 560);
  const totalTilt = (n >= 10 ? 18 : n >= 6 ? 14 : 8) * Math.PI / 180; // full fan spread
  const fit = (w) => {
    const h = Math.round(w * 1.4);
    const span = (n - 1) * w * pitchRatio;
    const R = span / 2 / Math.sin(totalTilt / 2);
    const lift = R * (1 - Math.cos(totalTilt / 2));
    return { h, span, R, lift };
  };
  let cardW = Math.max(28, Math.min(44, Math.floor(maxSpan / ((n - 1) * pitchRatio + 1))));
  let { h: cardH, span, R, lift: arcLift } = fit(cardW);
  // Shrink until the whole fan (card + arc rise + margin) fits the row.
  while (cardW > 28 && cardH + arcLift + 12 - overlap > budget) {
    cardW -= 2;
    ({ h: cardH, span, R, lift: arcLift } = fit(cardW));
  }

  handEl.style.height = Math.round(cardH + arcLift + 12) + 'px';
  // Arc math: card i's BOTTOM-center sits at (cx + R*sin θ, pivotY - R*cos θ).
  // The pivot is R below the fan, so pivotY = H - 6 + R puts the center card's
  // bottom 6px above the hand's bottom edge and the edge cards `lift` lower.
  const H = Math.round(cardH + arcLift + 12);
  const pivotY = R + H - 6;
  const cx = padL + innerW / 2;
  cards.forEach((c, i) => {
    const t = n === 1 ? 0 : (i / (n - 1)) - 0.5; // -0.5 .. 0.5
    const theta = t * totalTilt;
    const x = R * Math.sin(theta);
    const y = -R * Math.cos(theta); // up from pivot (center card highest)
    c.style.width = cardW + 'px';
    c.style.height = cardH + 'px';
    c.style.minWidth = cardW + 'px';
    c.style.left = (cx + x - cardW / 2) + 'px';
    c.style.top = (pivotY + y - cardH) + 'px';
    c.style.transform = 'rotate(' + (theta * 180 / Math.PI).toFixed(2) + 'deg)';
    const rankEl = c.querySelector('.rank');
    const suitEl = c.querySelector('.suit');
    if (rankEl) rankEl.style.fontSize = Math.max(9, Math.round(cardW * 0.30)) + 'px';
    if (suitEl) suitEl.style.fontSize = Math.max(10, Math.round(cardW * 0.37)) + 'px';
  });
  // Mark the fan as laid out: enables the shuffle/turn-change transitions
  // (CSS `.hand-bottom[data-ready] .card`) from the NEXT render onward, so
  // the initial deal snaps into place instead of animating from (0,0).
  handEl.setAttribute('data-ready', '1');
}

// Opponent seat fan: the top/left/right seats render their FULL face-down
// count as a compact stacked fan (same "holding cards" arc as the bottom
// hand, sized to the seat box instead of the viewport).
//   top (pos 2)   : horizontal fan, pivot ABOVE the hand → center card bows
//                   DOWN toward the table, edge cards higher + tilted.
//   left (pos 3)  : vertical fan, pivot on the SCREEN-EDGE side → center card
//                   reaches furthest RIGHT (toward table), edges curl back.
//   right (pos 1) : mirror of left.
// Cards are element-box cardShort×cardLong (portrait); side seats add a 90deg
// base rotation so their visual is landscape — same look as today's backs.
// Sizing: pitch (gap between cards) starts at ~60% of the card (40% overlap,
// the "numpuk" look) and shrinks toward a 3px dense stack as the seat gets
// tighter; if even that overflows, card + pitch scale down proportionally.
// The count is never truncated — the badge next to the name still carries
// the exact number.
function layoutOppFan(areaEl, pos) {
  if (!areaEl) return;
  const handEl = areaEl.querySelector(':scope > .hand');
  if (!handEl) return;
  const cards = Array.from(handEl.querySelectorAll(':scope > .card'));
  const n = cards.length;
  if (n === 0) { handEl.style.width = ''; handEl.style.height = ''; handEl.style.transform = ''; return; }

  // Budget comes from the player-area (CSS-stable), not the hand box — the
  // hand box gets our inline sizes, so measuring it would feed back.
  const aBox = areaEl.getBoundingClientRect();
  const cs = getComputedStyle(areaEl);
  const padH = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const labelEl = areaEl.querySelector(':scope > .player-label');
  const labelH = labelEl ? labelEl.getBoundingClientRect().height : 0;
  const centerEl = document.getElementById('center-area');
  const bandH = centerEl ? centerEl.getBoundingClientRect().height : aBox.height;

  const vertical = pos !== 2;
  const bw = Math.max(24, aBox.width - padH - 2);
  const cellH = Math.max(14, aBox.height - padV - labelH - 2);
  // Side seats in tight landscape get a hand box far shorter than the middle
  // band; let the fan use up to ~72% of the band height (it overflows the
  // hand box — overflow is visible — but stays within the table's middle row).
  const bh = vertical ? Math.max(cellH, Math.round(bandH * 0.72)) : cellH;

  // One shared card size for ALL opponent seats — a top-vs-side mismatch was
  // a visible cosmetic bug. The limiting dimension is the SIDE column's width:
  // the side fans' visual width equals cardLong (after their 90deg base
  // rotation), and the top row is always at least that wide (the grid gives
  // the middle column 1fr), so the same card size always fits up top.
  //
  // Never cap by the top row's HEIGHT — that row is `auto`-sized to the fan,
  // so reading it is circular (row tracks card, card caps to row → converges
  // to a tiny 13x18 card), and it is order-dependent (layoutOppFan sizes the
  // top before the sides, so each seat would measure a different DOM state).
  // The side column width is a stable grid constant, so the result is
  // deterministic for every seat in a given viewport.
  const seatSide = document.getElementById('player-3');
  const sideBw = seatSide
    ? Math.max(10, Math.round(seatSide.clientWidth
        - (parseFloat(getComputedStyle(seatSide).paddingLeft) || 0)
        - (parseFloat(getComputedStyle(seatSide).paddingRight) || 0) - 2))
    : 28;
  const cardLong = Math.min(28, bw, sideBw);
  let cardShort = Math.round(cardLong * (20 / 28));

  // Spread axis length for THIS seat: side seats fan vertically (bounded by
  // the column/band height `bh`), the top fans horizontally (bounded by `bw`).
  const avail = vertical ? bh : bw;
  let pitch = Math.min(Math.round(cardShort * 0.6), Math.floor((avail - cardShort) / Math.max(1, n - 1)));
  pitch = Math.max(2, pitch);
  let span = (n - 1) * pitch + cardShort;
  // Overflow even at the densest pitch (tiny seat): scale the card down. Same
  // formula for every seat, so the shared size is preserved.
  if (span > avail) {
    const k = avail / span;
    cardShort = Math.max(6, Math.round(cardShort * k));
    pitch = Math.max(2, Math.round(pitch * k));
  }

  const totalTilt = (n >= 10 ? 18 : n >= 5 ? 12 : 8) * Math.PI / 180;
  span = (n - 1) * pitch + cardShort; // recompute after the overflow scale-down
  // R comes from the CENTER-TO-CENTER spread ((n-1)*pitch), not the full span
  // — the chord of the arc is between the outermost card centers.
  const spread = (n - 1) * pitch;
  const R = n > 1 ? (spread / 2) / Math.sin(totalTilt / 2) : 0;
  const lift = n > 1 ? R * (1 - Math.cos(totalTilt / 2)) : 0;

  // Container = exact fan bounding box, so the flex column (align-items:
  // center) lands it dead-center in the seat cell.
  const cw = vertical ? Math.round(cardLong + lift + 2) : Math.round(span + 2);
  const ch = vertical ? Math.round(span + 2) : Math.round(cardLong + lift + 2);
  handEl.style.width = cw + 'px';
  handEl.style.height = ch + 'px';
  handEl.style.transform = '';

  cards.forEach((c, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 .. 0.5
    const th = t * totalTilt;
    const s = Math.sin(th), co = Math.cos(th);
    let x, y, rot;
    if (vertical) {
      y = ch / 2 + R * s; // spread vertically
      // Center card (th=0) is the one furthest toward the table; edges curl
      // back R(1-cos th) toward the screen edge.
      x = pos === 3
        ? (cw - 1 - cardLong / 2) - R * (1 - co)
        : (1 + cardLong / 2) + R * (1 - co);
      // LEFT (pos 3): rot = 90 + th. RIGHT (pos 1) is the horizontal mirror of
      // LEFT — a mirror across the vertical axis negates the tilt term, so the
      // right fan must use -90 - th (NOT -90 + th, which made its edges curl
      // the wrong way and look ragged/stacked next to the tidy left fan).
      rot = pos === 3 ? 90 + th * 180 / Math.PI : -90 - th * 180 / Math.PI;
    } else {
      x = cw / 2 + R * s; // spread horizontally
      y = (ch - 2 - cardLong / 2) - R * (1 - co); // center card lowest (bows down)
      rot = 180 - th * 180 / Math.PI;
    }
    c.style.width = cardShort + 'px';
    c.style.height = cardLong + 'px';
    c.style.margin = '0';
    c.style.left = (x - cardShort / 2) + 'px';
    c.style.top = (y - cardLong / 2) + 'px';
    c.style.transform = 'rotate(' + rot.toFixed(2) + 'deg)';
  });
}

// Reset inline fan styles (called from the no-hand / lobby paths).
function clearAllSizing() {
  const allCards = document.querySelectorAll('.card');
  allCards.forEach(c => {
    c.style.width = ''; c.style.height = ''; c.style.minWidth = '';
    c.style.left = ''; c.style.top = ''; c.style.transform = '';
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
