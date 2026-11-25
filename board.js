import { HEIGHT, MAZE, TICK_MS, WIDTH } from './game.js';

// Trace the edges of joined wall tiles once, keeping the wall on the right.
// At a vertex where two walls only touch diagonally, the right turn keeps
// their contours independent.
function traceWalls() {
  const stride = WIDTH + 1;
  const outgoing = new Map();
  const edges = [];
  function add(x, y, direction, dx, dy) {
    const start = y * stride + x;
    const edge = { start, end: (y + dy) * stride + x + dx, direction, used: false };
    if (!outgoing.has(start)) outgoing.set(start, []);
    outgoing.get(start).push(edge);
    edges.push(edge);
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (MAZE[y][x] !== '#') continue;
      if (MAZE[y - 1]?.[x] !== '#') add(x, y, 0, 1, 0);
      if (MAZE[y][x + 1] !== '#') add(x + 1, y, 1, 0, 1);
      if (MAZE[y + 1]?.[x] !== '#') add(x + 1, y + 1, 2, -1, 0);
      if (MAZE[y][x - 1] !== '#') add(x, y + 1, 3, 0, -1);
    }
  }
  const contours = [];
  for (const first of edges) {
    if (first.used) continue;
    const loop = [];
    let edge = first;
    do {
      edge.used = true;
      loop.push(edge);
      const options = outgoing.get(edge.end);
      edge = [1, 0, 3].map(turn => (edge.direction + turn) % 4)
        .map(direction => options.find(candidate => candidate.direction === direction))
        .find(Boolean);
    } while (edge !== first);
    contours.push(loop.filter((current, index) =>
      current.direction !== loop[(index + loop.length - 1) % loop.length].direction)
      .map(({ start }) => ({ x: start % stride, y: Math.floor(start / stride) })));
  }
  return contours;
}

const contours = traceWalls();
const surfaces = new WeakMap();
const ghostColors = { chaser: '#ff667f', ambusher: '#56dfe5' };
const angles = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

function shiftedCorners(contour, inset, map) {
  return contour.map((point, i, list) => {
    const previous = list[(i + list.length - 1) % list.length];
    const next = list[(i + 1) % list.length];
    const nx = -Math.sign(point.y - previous.y) - Math.sign(next.y - point.y);
    const ny = Math.sign(point.x - previous.x) + Math.sign(next.x - point.x);
    return {
      x: map.left + point.x * map.cw + nx * inset,
      y: map.top + point.y * map.ch + ny * inset,
    };
  });
}

function wallPath(map, inset, radius) {
  const path = new Path2D();
  for (const contour of contours) {
    const vertices = shiftedCorners(contour, inset, map);
    for (let i = 0; i < vertices.length; i++) {
      const point = vertices[i];
      const prev = vertices[(i + vertices.length - 1) % vertices.length];
      const next = vertices[(i + 1) % vertices.length];
      const r = Math.min(radius,
        (Math.abs(prev.x - point.x) + Math.abs(prev.y - point.y)) / 2,
        (Math.abs(next.x - point.x) + Math.abs(next.y - point.y)) / 2);
      const beforeX = point.x + Math.sign(prev.x - point.x) * r;
      const beforeY = point.y + Math.sign(prev.y - point.y) * r;
      if (i === 0) path.moveTo(beforeX, beforeY);
      else path.lineTo(beforeX, beforeY);
      path.quadraticCurveTo(point.x, point.y,
        point.x + Math.sign(next.x - point.x) * r,
        point.y + Math.sign(next.y - point.y) * r);
    }
    path.closePath();
  }
  return path;
}

function makeSurface(canvas, width, height, dpr) {
  const backing = canvas.ownerDocument.createElement('canvas');
  backing.width = canvas.width = Math.round(width * dpr);
  backing.height = canvas.height = Math.round(height * dpr);
  const ctx = backing.getContext('2d');
  ctx.scale(dpr, dpr);
  const pad = Math.min(width / WIDTH, height / HEIGHT) * 0.13;
  const cw = (width - 2 * pad) / WIDTH;
  const ch = (height - 2 * pad) / HEIGHT;
  const map = { cw, ch, left: pad, top: pad, unit: Math.min(cw, ch) };
  const { unit } = map;
  const background = ctx.createRadialGradient(width / 2, height / 2, 0,
    width / 2, height / 2, Math.max(width, height) * 0.65);
  background.addColorStop(0, '#141020');
  background.addColorStop(1, '#090a12');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const path = wallPath(map, unit * 0.12, unit * 0.22);
  ctx.fillStyle = '#23193b';
  ctx.fill(path, 'evenodd');
  const neon = ctx.createLinearGradient(0, 0, width, height);
  neon.addColorStop(0, '#a88aff');
  neon.addColorStop(0.55, '#926ff3');
  neon.addColorStop(1, '#8566e6');
  ctx.strokeStyle = neon;
  ctx.lineWidth = Math.max(1.25, unit * 0.071);
  ctx.shadowColor = 'rgba(127,80,255,.66)';
  ctx.shadowBlur = unit * 0.17 * dpr;
  ctx.stroke(path);
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(0.55, unit * 0.027);
  ctx.strokeStyle = 'rgba(164,131,252,.18)';
  ctx.stroke(wallPath(map, unit * 0.23, unit * 0.15));
  return { width, height, dpr, backing, map, dots: null, count: -1, pellets: null };
}

function center(actor, map) {
  return { x: map.left + (actor.x + 0.5) * map.cw, y: map.top + (actor.y + 0.5) * map.ch };
}

function between(prev, next, progress) {
  if (!prev || Math.abs(prev.x - next.x) + Math.abs(prev.y - next.y) !== 1) return next;
  return { x: prev.x + (next.x - prev.x) * progress, y: prev.y + (next.y - prev.y) * progress };
}

function drawPellets(ctx, state, surface, time) {
  const { map } = surface;
  const { unit } = map;
  if (state.dots !== surface.dots || state.dots.size !== surface.count) {
    const path = new Path2D();
    const size = Math.max(2, unit * 0.115);
    for (const id of state.dots) {
      const x = map.left + (id % WIDTH + 0.5) * map.cw;
      const y = map.top + (Math.floor(id / WIDTH) + 0.5) * map.ch;
      path.rect(x - size / 2, y - size / 2, size, size);
    }
    surface.dots = state.dots;
    surface.count = state.dots.size;
    surface.pellets = path;
  }
  ctx.fillStyle = '#ffe0c2';
  ctx.fill(surface.pellets);
  const wave = (1 + Math.sin(time / 230)) / 2;
  for (const id of state.powers) {
    const x = map.left + (id % WIDTH + 0.5) * map.cw;
    const y = map.top + (Math.floor(id / WIDTH) + 0.5) * map.ch;
    ctx.beginPath();
    ctx.arc(x, y, unit * (0.23 + 0.025 * wave), 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(255,216,166,${0.15 + wave * 0.23})`;
    ctx.lineWidth = Math.max(0.8, unit * 0.038);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, unit * (0.15 + 0.016 * wave), 0, 2 * Math.PI);
    ctx.fillStyle = '#ffe2ad';
    ctx.fill();
  }
}

const ghostShape = new Path2D('M5 0H9V1H11V2H12V3H13V5H14V14H12V12H10V13H9V14H7V12H5V14H3V13H2V12H0V5H1V3H2V2H3V1H5Z');

function drawGhost(ctx, ghost, at, map, powerTicks, time) {
  const frightened = powerTicks > 0 && ghost.homeTicks <= 0;
  const flashing = frightened && powerTicks <= 12 && Math.floor(time / 220) % 2 === 1;
  const color = frightened ? (flashing ? '#e4ddff' : '#6559ff') : ghostColors[ghost.kind];
  const scale = map.unit * 0.85 / 14;
  ctx.save();
  ctx.translate(at.x - 7 * scale, at.y - 7 * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = map.unit * 0.11;
  ctx.fill(ghostShape);
  ctx.shadowBlur = 0;
  if (frightened) {
    ctx.fillStyle = flashing ? '#51419c' : '#fbf4de';
    ctx.fillRect(3, 5, 2, 2);
    ctx.fillRect(9, 5, 2, 2);
    for (let x = 2; x < 12; x++) ctx.fillRect(x, 9 + Math.floor(x / 2) % 2, 1, 1);
  } else {
    const gazeX = ghost.direction === 'left' ? -0.85 : ghost.direction === 'right' ? 0.85 : 0;
    const gazeY = ghost.direction === 'up' ? -1 : ghost.direction === 'down' ? 1 : 0;
    for (const x of [2, 8]) {
      ctx.fillStyle = '#fffaed';
      ctx.fillRect(x, 4, 4.4, 5);
      ctx.fillStyle = '#262141';
      ctx.fillRect(x + 1.2 + gazeX, 5.4 + gazeY, 2.1, 2.35);
    }
  }
  ctx.restore();
}

function drawPlayer(ctx, player, at, unit, time) {
  const radius = unit * 0.43;
  const mouth = 0.14 + 0.56 * (0.5 + Math.sin(time / TICK_MS * Math.PI * 2) / 2);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angles[player.direction] ?? 0);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, mouth, Math.PI * 2 - mouth);
  ctx.closePath();
  ctx.fillStyle = '#ffdc47';
  ctx.shadowColor = '#ffc42e';
  ctx.shadowBlur = unit * 0.19;
  ctx.fill();
  ctx.restore();
}

export function captureActors(game) {
  const copy = ({ x, y }) => ({ x, y });
  return { player: copy(game.player), ghosts: game.ghosts.map(copy) };
}

export function drawBoard(canvas, game, { previous, progress = 1, time = 0, reducedMotion = false } = {}) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  let surface = surfaces.get(canvas);
  if (!surface || surface.width !== rect.width || surface.height !== rect.height || surface.dpr !== dpr) {
    surface = makeSurface(canvas, rect.width, rect.height, dpr);
    surfaces.set(canvas, surface);
  }
  const layout = surface.map;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(surface.backing, 0, 0, surface.width, surface.height);
  const animationTime = reducedMotion ? 0 : time;
  const t = reducedMotion ? 1 : Math.max(0, Math.min(1, progress));
  drawPellets(ctx, game, surface, animationTime);
  game.ghosts.forEach((ghost, i) => {
    const position = between(previous?.ghosts[i], ghost, t);
    drawGhost(ctx, ghost, center(position, layout), layout, game.powerTicks, animationTime);
  });
  const position = between(previous?.player, game.player, t);
  drawPlayer(ctx, game.player, center(position, layout), layout.unit, animationTime);
}
