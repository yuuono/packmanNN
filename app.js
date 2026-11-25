import { createGame, startGame, queueTurn, tick, TICK_MS, POWER_TICKS, DEFAULT_GHOST_COUNT, MAX_GHOST_COUNT } from './game.js';
import { captureActors, drawBoard } from './board.js';

const byId = id => document.getElementById(id);
const canvas = byId('maze');
const screen = byId('screen');
const play = byId('play');
const restart = byId('restart');
const dialog = byId('restart-dialog');
const ghostCountSelect = byId('ghost-count');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const directions = {
  ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left',
  w: 'up', d: 'right', s: 'down', a: 'left',
};
const storagePrefix = 'dot-arcade.maze-chase.';
const query = new URLSearchParams(location.search);
const requestedAgent = query.get('agent');
const lab = ['utility', 'nn'].includes(requestedAgent);
let pilot = null;
function readSetting(key) {
  try { return localStorage.getItem(storagePrefix + key); } catch { return null; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(storagePrefix + key, String(value)); } catch { /* Storage is optional. */ }
}

for (let count = 0; count <= MAX_GHOST_COUNT; count++) {
  ghostCountSelect.add(new Option(count + '体', String(count)));
}
ghostCountSelect.value = query.get('ghosts') ?? String(DEFAULT_GHOST_COUNT);
if (ghostCountSelect.selectedIndex < 0) ghostCountSelect.value = String(DEFAULT_GHOST_COUNT);
let game = createGame({ ghostCount: Number(ghostCountSelect.value) });
let previous = captureActors(game);
let paused = false;
let lastTick = performance.now();
let best = 0;
let muted = readSetting('sound') !== 'on';
let audio = null;
let restartWasRunning = false;

function bestKey() {
  const key = lab ? 'ai-best' : 'best';
  return game.ghosts.length === DEFAULT_GHOST_COUNT ? key : key + '-ghosts-' + game.ghosts.length;
}

function syncGameSettings() {
  const count = game.ghosts.length;
  ghostCountSelect.value = String(count);
  best = Math.max(0, Number(readSetting(bestKey())) || 0);
  const url = new URL(location.href);
  if (count === DEFAULT_GHOST_COUNT) url.searchParams.delete('ghosts');
  else url.searchParams.set('ghosts', String(count));
  if (url.href !== location.href) history.replaceState(null, '', url);
  if (lab) url.searchParams.delete('agent');
  else url.searchParams.set('agent', 'utility');
  byId('lab-link').href = url.href;
}

function newGame() {
  game = createGame({ ghostCount: Number(ghostCountSelect.value) });
  pilot?.reset();
  paused = false;
  syncGameSettings();
}

function setIcon(button, name) {
  button.querySelector('use').setAttribute('href', '#i-' + name);
}

function prepareSound() {
  if (muted) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio && !audio) audio = new Audio();
    if (audio?.state === 'suspended') audio.resume().catch(() => {});
  } catch { /* Audio playback may be unavailable on this device. */ }
}

function beep(frequency, endFrequency, duration, delay = 0) {
  if (muted || audio?.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const at = audio.currentTime + delay;
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(frequency, at);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.032, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(at);
  oscillator.stop(at + duration + 0.01);
}

function soundFor(events) {
  if (events.includes('won')) {
    [523, 659, 784, 1046].forEach((note, i) => beep(note, note, 0.11, i * 0.095));
  } else if (events.includes('lifeLost') || events.includes('gameOver')) {
    beep(420, 85, 0.35);
  } else if (events.includes('ghost')) {
    beep(320, 980, 0.18);
  } else if (events.includes('power')) {
    beep(240, 810, 0.2);
  } else if (events.includes('dot')) {
    const note = game.ticks % 2 ? 215 : 275;
    beep(note, note * 1.6, 0.055);
  }
}

function syncSound() {
  const control = byId('sound');
  control.setAttribute('aria-pressed', String(!muted));
  byId('sound-value').textContent = muted ? 'OFF' : 'ON';
  setIcon(control, muted ? 'muted' : 'volume');
}
byId('sound').addEventListener('click', () => {
  muted = !muted;
  saveSetting('sound', muted ? 'off' : 'on');
  prepareSound();
  beep(530, 710, 0.1);
  syncSound();
});

const phaseText = {
  ready: ['スタンバイ', 'READY!', '', 'ゲーム開始'],
  paused: ['一時停止', 'PAUSED', '再開ボタンまたはスペースで続行', '再開する'],
  lifeLost: ['ミス', 'TRY AGAIN!', '残りライフでプレイを続けよう', '続ける'],
  won: ['クリア', 'MAZE CLEAR!', 'すべてのドットを回収しました', 'もう一度遊ぶ'],
  gameOver: ['ゲーム終了', 'GAME OVER', 'もう一度迷路に挑戦しよう', 'もう一度遊ぶ'],
};

function updateHUD() {
  const phase = paused ? 'paused' : game.phase;
  const labels = phaseText[phase];
  const powered = game.powerTicks > 0;
  const status = byId('status');
  const statusText = labels?.[0] ?? (powered ? 'パワーアップ中' : 'プレイ中');
  if (status.textContent !== statusText) status.textContent = statusText;
  status.dataset.mode = phase === 'paused' ? 'paused' : ['lifeLost', 'gameOver'].includes(phase) ? 'lost' : powered ? 'power' : 'normal';
  byId('overlay').hidden = !labels;
  byId('overlay').classList.toggle('scene', phase !== 'ready');
  if (labels) {
    byId('screen-title').textContent = labels[1];
    byId('screen-detail').textContent = labels[2];
    byId('screen-detail').hidden = !labels[2];
  }
  play.querySelector('span').textContent = labels?.[3] ?? '一時停止';
  setIcon(play, labels ? 'play' : 'pause');
  restart.disabled = game.phase === 'ready';
  if (game.score > best) {
    best = game.score;
    saveSetting(bestKey(), best);
  }
  byId('score').textContent = String(game.score).padStart(6, '0');
  byId('best').textContent = String(best).padStart(6, '0');
  byId('dots').textContent = game.dots.size + game.powers.size;
  const lives = byId('lives');
  if (lives.dataset.count !== String(game.lives)) {
    lives.dataset.count = game.lives;
    lives.setAttribute('aria-label', game.lives + ' 機');
    lives.replaceChildren(...Array.from({length:3}, (_, i) => {
      const life = document.createElement('span');
      life.className = i < game.lives ? 'life' : 'life spent';
      return life;
    }));
  }
  byId('power-strip').hidden = !powered;
  byId('power-strip').firstElementChild.style.transform = 'scaleX(' + game.powerTicks / POWER_TICKS + ')';
}

function resetClock() {
  previous = captureActors(game);
  lastTick = performance.now();
}

function playOrPause() {
  if (dialog.open) return;
  prepareSound();
  if (game.phase === 'won' || game.phase === 'gameOver') {
    newGame();
  }
  if (game.phase === 'playing') paused = !paused;
  else {
    paused = false;
    if (game.phase === 'lifeLost') pilot?.reset();
    startGame(game);
    beep(350, 560, 0.12);
  }
  resetClock();
  updateHUD();
  pilot?.decision(game);
}

play.addEventListener('click', playOrPause);

function turn(direction) {
  if (lab || dialog.open || paused || ['won', 'gameOver'].includes(game.phase)) return;
  if (game.phase === 'ready' || game.phase === 'lifeLost') playOrPause();
  queueTurn(game, direction);
}

window.addEventListener('keydown', event => {
  if (dialog.open || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (event.target.closest?.('input, select, textarea')) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (Object.hasOwn(directions, key)) {
    event.preventDefault();
    if (!event.repeat) turn(directions[key]);
  } else if (event.code === 'Space') {
    // Buttons keep their native keyboard activation.
    if (event.target.closest?.('button')) return;
    event.preventDefault();
    if (!event.repeat) playOrPause();
  }
});

for (const button of document.querySelectorAll('[data-turn]')) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    turn(button.dataset.turn);
  });
  button.addEventListener('click', event => {
    if (event.detail === 0) turn(button.dataset.turn);
  });
}

let swipeStart = null;
screen.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  screen.setPointerCapture(event.pointerId);
  swipeStart = {x:event.clientX, y:event.clientY, id:event.pointerId};
});
screen.addEventListener('pointercancel', () => { swipeStart = null; });
screen.addEventListener('pointerup', event => {
  if (!swipeStart || swipeStart.id !== event.pointerId) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 14) return;
  turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});

function confirmRestart(title) {
  byId('reset-title').textContent = title;
  restartWasRunning = game.phase === 'playing' && !paused;
  if (restartWasRunning) { paused = true; updateHUD(); }
  dialog.showModal();
}
restart.addEventListener('click', () => confirmRestart('最初から遊びますか？'));
ghostCountSelect.addEventListener('change', () => {
  if (['ready', 'won', 'gameOver'].includes(game.phase)) {
    newGame();
    resetClock();
    updateHUD();
    pilot?.decision(game);
  } else {
    confirmRestart('ゴースト' + ghostCountSelect.value + '体で最初から遊びますか？');
  }
});
byId('again-cancel').addEventListener('click', () => dialog.close('cancel'));
byId('again-confirm').addEventListener('click', () => dialog.close('restart'));
dialog.addEventListener('cancel', () => { dialog.returnValue = 'cancel'; });
dialog.addEventListener('close', () => {
  if (dialog.returnValue === 'restart') {
    newGame();
    startGame(game);
    screen.focus({preventScroll:true});
  } else {
    ghostCountSelect.value = String(game.ghosts.length);
    if (restartWasRunning && !document.hidden) paused = false;
  }
  restartWasRunning = false;
  resetClock();
  updateHUD();
  pilot?.decision(game);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.phase === 'playing') {
    paused = true;
    restartWasRunning = false;
    resetClock();
    updateHUD();
  }
});

function frame(now) {
  const running = game.phase === 'playing' && !paused;
  if (running && now - lastTick >= TICK_MS) {
    previous = captureActors(game);
    if (pilot) queueTurn(game, pilot.decision(game));
    const events = tick(game);
    if (pilot && game.phase !== 'playing') pilot.decision(game);
    // Preserve the sub-tick remainder without fast-forwarding a suspended tab.
    lastTick = now - (now - lastTick) % TICK_MS;
    soundFor(events);
    updateHUD();
  }
  drawBoard(canvas, game, {
    previous, progress: running && game.phase === 'playing' ? (now - lastTick) / TICK_MS : 1,
    time: now, reducedMotion: reducedMotion.matches || !running,
  });
  requestAnimationFrame(frame);
}

// Small original pixel illustrations used in the header and scoring guide.
const ghostSprite = [
  '    ####    ', '  ########  ', ' ########## ', '############',
  '##ww###ww###', '##wb###wb###', '##wb###wb###', '############',
  '############', '############', '### #  # ###', '##  #  #  ##',
];
const pacSprite = [
  '   ######   ', '  ########  ', ' ########## ', '#########   ',
  '#######     ', '#####       ', '######      ', '########    ',
  ' ########## ', '  ########  ', '   ######   ',
];
function pixelSprite(ctx, pattern, x, y, scale, color) {
  pattern.forEach((row, j) => [...row].forEach((pixel, i) => {
    if (pixel === ' ') return;
    ctx.fillStyle = pixel === 'w' ? '#fff9e5' : pixel === 'b' ? '#26203d' : color;
    ctx.fillRect(x + i * scale, y + j * scale, scale, scale);
  }));
}
function drawIllustrations() {
  const ctx = byId('parade').getContext('2d');
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ['#393145', '#584565', '#796384'][i];
    ctx.fillRect(8 + i * 10, 37, 4, 4);
  }
  pixelSprite(ctx, pacSprite, 46, 14, 4, '#ffda56');
  ctx.fillStyle = '#f4d1a6';
  for (const x of [115, 137, 159, 181]) ctx.fillRect(x, 36, 5, 5);
  pixelSprite(ctx, ghostSprite, 208, 13, 4, '#ff869e');
  pixelSprite(ctx, ghostSprite, 274, 13, 4, '#68dfdf');
  const guide = byId('guide-ghost').getContext('2d');
  pixelSprite(guide, ghostSprite, 4, 4, 2, '#8274ff');
}
syncSound();
syncGameSettings();
updateHUD();
drawIllustrations();
if (lab) {
  document.body.classList.add('ai-lab');
  byId('lab-link').textContent = '手動プレイに戻る';
  screen.setAttribute('aria-label', '自動操縦の迷路。スペースで開始・一時停止。');
  const { mountPanel } = await import('./ai/panel.js');
  pilot = mountPanel(() => game, requestedAgent);
}
requestAnimationFrame(frame);
