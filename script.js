(() => {
  'use strict';

  const STORAGE_KEY = 'the-ninth-square-v1';
  const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  const emptyScores = () => ({ x: 0, o: 0, draws: 0 });
  const freshPreferences = () => ({
    mode: 'local',
    difficulty: 'medium',
    sound: false,
    scores: { local: emptyScores(), computer: emptyScores() }
  });

  const cells = [...document.querySelectorAll('.cell')];
  const boardElement = document.querySelector('#board');
  const status = document.querySelector('#game-status');
  const turnCopy = document.querySelector('#turn-copy');
  const turnMark = document.querySelector('#turn-mark');
  const turnIndicator = document.querySelector('#turn-indicator');
  const xRow = document.querySelector('#x-row');
  const oRow = document.querySelector('#o-row');
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const difficultyButtons = [...document.querySelectorAll('[data-difficulty]')];
  const difficultySetting = document.querySelector('#difficulty-setting');
  const soundToggle = document.querySelector('#sound-toggle');
  const soundState = document.querySelector('#sound-state');

  function loadPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return freshPreferences();
      const safeCount = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
      return {
        mode: saved.mode === 'computer' ? 'computer' : 'local',
        difficulty: ['easy', 'medium', 'hard'].includes(saved.difficulty) ? saved.difficulty : 'medium',
        sound: saved.sound === true,
        scores: {
          local: {
            x: safeCount(saved.scores?.local?.x),
            o: safeCount(saved.scores?.local?.o),
            draws: safeCount(saved.scores?.local?.draws)
          },
          computer: {
            x: safeCount(saved.scores?.computer?.x),
            o: safeCount(saved.scores?.computer?.o),
            draws: safeCount(saved.scores?.computer?.draws)
          }
        }
      };
    } catch {
      return freshPreferences();
    }
  }

  const preferences = loadPreferences();
  let mode = preferences.mode;
  let difficulty = preferences.difficulty;
  let soundEnabled = preferences.sound;
  let scores = preferences.scores;
  let board = Array(9).fill(null);
  let currentMark = 'X';
  let gameOver = false;
  let computerThinking = false;
  let computerTimer = null;
  let resetAnimationTimer = null;
  let audioContext;

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, difficulty, sound: soundEnabled, scores }));
    } catch {
      // The game remains playable when browser storage is unavailable.
    }
  }

  function playerName(mark) {
    if (mode === 'computer') return mark === 'X' ? 'You' : 'The house';
    return `Player ${mark}`;
  }

  function updateScoreboard() {
    const roundScores = scores[mode];
    document.querySelector('#score-context').textContent = mode === 'computer' ? 'VS. THE HOUSE' : 'WITH A FRIEND';
    document.querySelector('#x-label').textContent = playerName('X');
    document.querySelector('#o-label').textContent = playerName('O');
    updateScore('#x-score', roundScores.x);
    updateScore('#o-score', roundScores.o);
    updateScore('#draw-score', roundScores.draws);
  }

  function updateScore(selector, value) {
    const score = document.querySelector(selector);
    const nextValue = String(value);
    if (score.textContent === nextValue) return;
    score.textContent = nextValue;
    score.classList.remove('is-updated');
    void score.offsetWidth;
    score.classList.add('is-updated');
  }

  function updateModeControls() {
    modeButtons.forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function updateDifficultyControls() {
    difficultyButtons.forEach((button) => {
      const active = button.dataset.difficulty === difficulty;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function updateTurn() {
    const name = playerName(currentMark);
    turnCopy.textContent = computerThinking ? 'The house is choosing' : `${name} to move`;
    turnMark.classList.toggle('mark-o', currentMark === 'O');
    turnIndicator.dataset.turn = currentMark;
    boardElement.dataset.turn = currentMark;
    xRow.setAttribute('aria-current', String(!gameOver && currentMark === 'X'));
    oRow.setAttribute('aria-current', String(!gameOver && currentMark === 'O'));
    cells.forEach((cell, index) => {
      cell.disabled = gameOver || Boolean(board[index]) || computerThinking || (mode === 'computer' && currentMark === 'O');
    });
  }

  function setStatus(message, result = false) {
    status.textContent = message;
    status.classList.toggle('is-result', result);
  }

  function renderCell(index, mark) {
    const cell = cells[index];
    const glyph = cell.querySelector('span');
    board[index] = mark;
    cell.classList.remove('is-x', 'is-o', 'just-played');
    cell.classList.add(mark === 'X' ? 'is-x' : 'is-o', 'just-played');
    glyph.textContent = '';
    cell.setAttribute('aria-label', `Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}, ${mark}`);
    playSound(mark === 'X' ? 510 : 380);
  }

  function winningLine(state) {
    return WIN_LINES.find(([a, b, c]) => state[a] && state[a] === state[b] && state[a] === state[c]) || null;
  }

  function finishRound() {
    const line = winningLine(board);
    if (line) {
      gameOver = true;
      line.forEach((index, order) => {
        const cell = cells[index];
        cell.style.setProperty('--win-delay', `${order * 85}ms`);
        cell.classList.add('is-winning');
      });
      scores[mode][currentMark.toLowerCase()] += 1;
      setStatus(`${playerName(currentMark)} takes the round. Nicely played.`, true);
      updateScoreboard();
      persist();
      return true;
    }
    if (board.every(Boolean)) {
      gameOver = true;
      scores[mode].draws += 1;
      setStatus('A draw. Nobody gives an inch.', true);
      updateScoreboard();
      persist();
      return true;
    }
    return false;
  }

  function takeTurn(index, fromComputer = false) {
    if (gameOver || board[index] || (computerThinking && !fromComputer)) return;
    if (mode === 'computer' && currentMark === 'O' && !fromComputer) return;
    renderCell(index, currentMark);
    if (finishRound()) {
      updateTurn();
      return;
    }
    currentMark = currentMark === 'X' ? 'O' : 'X';
    if (mode === 'computer' && currentMark === 'O') {
      computerThinking = true;
      updateTurn();
      setStatus('The house is weighing its options…');
      computerTimer = window.setTimeout(() => {
        computerTimer = null;
        const move = chooseComputerMove(board, difficulty);
        computerThinking = false;
        takeTurn(move, true);
      }, 420);
    } else {
      updateTurn();
      setStatus(`${playerName(currentMark)} to move.`);
    }
  }

  function chooseComputerMove(state, level) {
    const open = state.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
    if (level === 'easy') return open[Math.floor(Math.random() * open.length)];
    const immediate = (mark) => open.find((index) => {
      const trial = [...state];
      trial[index] = mark;
      return Boolean(winningLine(trial));
    });
    const winningMove = immediate('O');
    if (winningMove !== undefined) return winningMove;
    const blockingMove = immediate('X');
    if (blockingMove !== undefined) return blockingMove;
    if (level === 'hard') return bestMove(state);
    if (state[4] === null) return 4;
    const corners = open.filter((index) => [0, 2, 6, 8].includes(index));
    const choices = corners.length ? corners : open;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function bestMove(state) {
    let bestScore = -Infinity;
    let bestIndex = -1;
    state.forEach((value, index) => {
      if (value) return;
      const trial = [...state];
      trial[index] = 'O';
      const score = minimax(trial, false, 0);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    return bestIndex;
  }

  function minimax(state, maximizing, depth) {
    const line = winningLine(state);
    if (line) return state[line[0]] === 'O' ? 10 - depth : depth - 10;
    const open = state.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
    if (!open.length) return 0;
    if (maximizing) {
      let best = -Infinity;
      for (const index of open) {
        const next = [...state]; next[index] = 'O';
        best = Math.max(best, minimax(next, false, depth + 1));
      }
      return best;
    }
    let best = Infinity;
    for (const index of open) {
      const next = [...state]; next[index] = 'X';
      best = Math.min(best, minimax(next, true, depth + 1));
    }
    return best;
  }

  function resetBoard(announce = true) {
    const animateReset = announce && board.some(Boolean);
    if (computerTimer !== null) {
      window.clearTimeout(computerTimer);
      computerTimer = null;
    }
    if (resetAnimationTimer !== null) {
      window.clearTimeout(resetAnimationTimer);
      resetAnimationTimer = null;
    }
    board = Array(9).fill(null);
    currentMark = 'X';
    gameOver = false;
    computerThinking = false;
    cells.forEach((cell, index) => {
      cell.disabled = false;
      cell.className = 'cell';
      cell.querySelector('span').textContent = '';
      cell.setAttribute('aria-label', `Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}, empty`);
    });
    boardElement.classList.remove('is-resetting');
    if (animateReset) {
      void boardElement.offsetWidth;
      boardElement.classList.add('is-resetting');
      resetAnimationTimer = window.setTimeout(() => {
        boardElement.classList.remove('is-resetting');
        resetAnimationTimer = null;
      }, 560);
    }
    updateTurn();
    setStatus(announce ? 'New round. X starts.' : 'A clean sheet. X starts.');
  }

  function playSound(frequency) {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext ||= new AudioContextClass();
      if (audioContext.state === 'suspended') audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.045, audioContext.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.095);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch {
      // Audio is an optional enhancement; failed audio never blocks a move.
    }
  }

  cells.forEach((cell) => cell.addEventListener('click', () => takeTurn(Number(cell.dataset.index))));
  document.querySelector('#rematch').addEventListener('click', () => resetBoard());
  modeButtons.forEach((button) => button.addEventListener('click', () => {
    const nextMode = button.dataset.mode;
    if (nextMode === mode) return;
    mode = nextMode;
    difficultySetting.hidden = mode !== 'computer';
    updateModeControls();
    resetBoard(false);
    updateScoreboard();
    persist();
  }));
  difficultyButtons.forEach((button) => button.addEventListener('click', () => {
    const nextDifficulty = button.dataset.difficulty;
    if (nextDifficulty === difficulty) return;
    difficulty = nextDifficulty;
    updateDifficultyControls();
    resetBoard(false);
    persist();
  }));
  document.querySelector('#reset-scores').addEventListener('click', () => {
    scores = { local: emptyScores(), computer: emptyScores() };
    updateScoreboard();
    persist();
    setStatus('The tally is clear. Ready for a new streak.');
  });
  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggle.setAttribute('aria-pressed', String(soundEnabled));
    soundState.textContent = soundEnabled ? 'on' : 'off';
    persist();
    setStatus(soundEnabled ? 'Sound is on.' : 'Sound is off.');
    if (soundEnabled) playSound(510);
  });

  difficultySetting.hidden = mode !== 'computer';
  updateModeControls();
  updateDifficultyControls();
  soundToggle.setAttribute('aria-pressed', String(soundEnabled));
  soundState.textContent = soundEnabled ? 'on' : 'off';
  updateScoreboard();
  updateTurn();
})();
