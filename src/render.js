import { comboName } from './game.js';

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

    const isActive = i === currentPlayer && !gameOver;
    const isHumanPlayer = isHuman[i];
    const hand = hands[i] || [];
    const isFinished = finishedOrder.includes(i);
    const isSelf = i === playerId;

    area.classList.toggle('active-player', isActive);

    const handClass = pos === 2 ? 'hand-top' : pos === 3 ? 'hand-left' : pos === 1 ? 'hand-right' : 'hand-bottom';

    let label = '';
    if (isActive && !gameOver) {
      label = '<span class="turn-badge">' + (isHumanPlayer ? 'YOUR TURN' : 'THINKING...') + '</span>';
    }
    if (!isHumanPlayer) {
      label += ' <span class="bot-badge">BOT</span>';
    }
    if (isFinished) {
      label += ' <span class="finished-badge">FINISHED</span>';
    }

    area.innerHTML =
      '<div class="player-label">' +
        playerNames[i] +
        ' <span class="card-count">(' + hand.length + ' cards)</span>' +
        label +
      '</div>' +
      '<div class="hand ' + handClass + '" id="hand-' + i + '"></div>';

    const handEl = document.getElementById('hand-' + i);
    const hideCards = !isSelf;

    hand.forEach((card, idx) => {
      const cardEl = document.createElement('div');
      if (hideCards) {
        cardEl.className = 'card face-down';
      } else {
        const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
        cardEl.className = 'card ' + (isRed ? 'red' : 'black') + (card.selected ? ' selected' : '');
        cardEl.innerHTML = '<span class="rank">' + card.rank + '</span><span class="suit">' + card.suitSymbol + '</span>';
        cardEl.onclick = (e) => { if (!cardEl._dragged) state.selectCard(i, idx); };
        cardEl.onpointerenter = () => cardEl.classList.add('card-hovered');
        cardEl.onpointerleave = () => cardEl.classList.remove('card-hovered');

        if (isSelf) {
          cardEl.dataset.idx = idx;
          cardEl.style.cursor = 'grab';
          cardEl.onpointerdown = (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            cardEl._dragged = false;
            const start = { x: e.clientX, y: e.clientY };
            const fromIdx = idx;
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

            const onMove = (ev) => {
              const dx = ev.clientX - start.x;
              const dy = ev.clientY - start.y;
              if (Math.abs(dx) > 4 || Math.abs(dy) > 4) cardEl._dragged = true;
              follower.style.left = ev.clientX + 'px';
              follower.style.top = ev.clientY + 'px';

              document.querySelectorAll('.drag-target').forEach(el => el.classList.remove('drag-target'));
              const elUnder = document.elementFromPoint(ev.clientX, ev.clientY);
              if (elUnder) {
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
              document.querySelectorAll('.drag-target').forEach(el => el.classList.remove('drag-target'));

              if (cardEl._dragged && targetIdx >= 0 && targetIdx !== fromIdx) {
                let adjTarget = targetIdx;
                if (fromIdx < targetIdx) adjTarget = targetIdx - 1;
                const [moved] = hands[i].splice(fromIdx, 1);
                hands[i].splice(adjTarget, 0, moved);
                render(state);
              }
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
          };
        }
      }
      handEl.appendChild(cardEl);
    });
  }

  renderCenter(state);
  renderActionBar(state);
}

function renderCenter(state) {
  const centerCards = document.getElementById('center-cards');
  const centerInfo = document.getElementById('center-info');
  const passMarkers = document.getElementById('pass-markers');
  if (!centerCards || !centerInfo || !passMarkers) return;

  centerCards.innerHTML = '';
  const tableCombo = state.trick.combo;
  const playerNames = state.playerNames;

  if (tableCombo) {
    centerInfo.textContent = comboName(tableCombo) + ' by ' + playerNames[state.trick.comboPlayer];
    tableCombo.cards.forEach(card => {
      const cardEl = document.createElement('div');
      const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
      cardEl.className = 'card ' + (isRed ? 'red' : 'black');
      cardEl.style.cursor = 'default';
      cardEl.innerHTML = '<span class="rank">' + card.rank + '</span><span class="suit">' + card.suitSymbol + '</span>';
      centerCards.appendChild(cardEl);
    });
  } else {
    centerInfo.textContent = state.gameOver ? 'Game Over' : 'New trick — ' + playerNames[state.currentPlayer] + ' plays first';
  }

  passMarkers.innerHTML = '';
  state.trick.passed.forEach(p => {
    const tag = document.createElement('span');
    tag.className = 'pass-tag';
    tag.textContent = playerNames[p] + ' Pass';
    passMarkers.appendChild(tag);
  });
}

function renderActionBar(state) {
  const actionBar = document.getElementById('action-bar');
  if (!actionBar) return;

  const playerId = state._playerId;
  const isMyTurn = playerId !== null && state.currentPlayer === playerId && !state.gameOver && !state.threePhase;

  if (state.gameOver || !isMyTurn) {
    actionBar.classList.remove('visible');
    const btnSort = document.getElementById('btn-sort');
    if (btnSort) btnSort.disabled = true;
  } else {
    actionBar.classList.add('visible');
    const btnSort = document.getElementById('btn-sort');
    if (btnSort) btnSort.disabled = false;
    if (state.updatePlayButton) state.updatePlayButton();
  }
}

export function renderThreePhaseOverlay(state) {
  const { threePhaseCards, threePhaseOrder, threePhaseIndex, threePhaseDiscarded, currentPlayer, threePhase, playerNames, isHuman, _playerId } = state;

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
      emptyEl.textContent = 'no 3s';
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

  sb.innerHTML = '';
  const posToPlayer = [0, 1, 2, 3].map(offset => (_playerId + offset) % 4);
  for (let pos = 0; pos < 4; pos++) {
    const i = posToPlayer[pos];
    const row = document.createElement('div');
    row.className = 'score-row';
    const badge = isHuman[i] ? '' : ' <span style="color:#64b5f6;font-size:10px;">[BOT]</span>';
    row.innerHTML = '<span class="name">' + playerNames[i] + badge + '</span><span class="pts">' + scores[i] + ' pts</span>';
    sb.appendChild(row);
  }
}

export function renderLobby(state) {
  const list = document.getElementById('lobby-player-list');
  if (!list || !state || !state.players) return;

  list.innerHTML = '';
  state.players.forEach((p, i) => {
    if (!p) return;
    const div = document.createElement('div');
    div.className = 'lobby-player';
    const isBot = p.isBot || !p.connected;
    div.textContent = p.name + (isBot ? ' (Bot)' : '');
    list.appendChild(div);
  });
}

function renderLog(state) {
  const logEl = document.getElementById('log');
  if (!logEl) return;

  const logEntries = state.log || [];
  const renderedCount = parseInt(logEl.dataset.renderedCount || '0');

  if (logEntries.length <= renderedCount) return;

  for (let i = renderedCount; i < logEntries.length; i++) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = logEntries[i];
    logEl.appendChild(entry);
  }

  logEl.dataset.renderedCount = logEntries.length;
  logEl.scrollTop = logEl.scrollHeight;
}
