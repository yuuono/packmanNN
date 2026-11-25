// The board, rules and controls run independently of rendering and wall-clock time.
export const MAZE = Object.freeze([
  '###################',
  '#o.......#.......o#',
  '#.##.###.#.###.##.#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#.......#....#',
  '###.##.## ##.##.###',
  '#......     ......#',
  '###.##.#####.##.###',
  '#....#.......#....#',
  '#.##.#.#####.#.##.#',
  '#........ ........#',
  '#.##.###.#.###.##.#',
  '#o.......#.......o#',
  '###################',
]);

export const WIDTH = MAZE[0].length;
export const HEIGHT = MAZE.length;
export const TICK_MS = 160;
export const POWER_TICKS = 50;
export const STAGE_ID = 'maze-01';
export const ENGINE_VERSION = 'maze-chase-1';

const moves = {
  up: [0, -1],
  left: [-1, 0],
  down: [0, 1],
  right: [1, 0],
};
const reverse = { up: 'down', left: 'right', down: 'up', right: 'left' };
const headings = Object.keys(moves);
const id = (x, y) => y * WIDTH + x;
const positionId = actor => id(actor.x, actor.y);
// Roster order is stable across a game, its snapshots and individual respawns.
const ghostStarts = [
  { kind: 'chaser', x: 8 }, { kind: 'ambusher', x: 10 },
  { kind: 'chaser', x: 7 }, { kind: 'ambusher', x: 11 },
];
export const DEFAULT_GHOST_COUNT = 2;
export const MAX_GHOST_COUNT = ghostStarts.length;

// All corridors are fixed. Cache their neighbors and shortest-path distances
// once, so ghosts can evaluate turns without searching on every tick.
const exits = Array.from({ length: WIDTH * HEIGHT }, () => ({}));
for (let y = 1; y < HEIGHT - 1; y++) {
  for (let x = 1; x < WIDTH - 1; x++) {
    if (MAZE[y][x] === '#') continue;
    for (const [direction, [dx, dy]] of Object.entries(moves)) {
      if (MAZE[y + dy][x + dx] !== '#') {
        exits[id(x, y)][direction] = id(x + dx, y + dy);
      }
    }
  }
}

const distances = exits.map((edges, start) => {
  const distance = new Int16Array(WIDTH * HEIGHT).fill(-1);
  if (!Object.keys(edges).length) return distance;
  const frontier = [start];
  distance[start] = 0;
  for (let i = 0; i < frontier.length; i++) {
    const current = frontier[i];
    for (const neighbor of Object.values(exits[current])) {
      if (distance[neighbor] !== -1) continue;
      distance[neighbor] = distance[current] + 1;
      frontier.push(neighbor);
    }
  }
  return distance;
});

// The pathfinding graph used by all agents is the same one used by the ghosts.
exits.forEach(Object.freeze);
export function neighborsOf(tile) { return exits[tile]; }
export function corridorDistance(from, to) { return distances[from][to]; }

function createGhost(index, delay = 4 + index * 5) {
  const { kind, x } = ghostStarts[index];
  return { kind, x, y: 7, direction: kind === 'chaser' ? 'left' : 'right', homeTicks: delay };
}

function resetActors(game, ghostCount) {
  game.player = { x: 9, y: 11, direction: 'left' };
  game.ghosts = Array.from({ length: ghostCount }, (_, index) => createGhost(index));
  game.powerTicks = 0;
  game.ghostCombo = 0;
}

export function createGame({ ghostCount = DEFAULT_GHOST_COUNT } = {}) {
  if (!Number.isInteger(ghostCount) || ghostCount < 0 || ghostCount > MAX_GHOST_COUNT) {
    throw new RangeError('ghostCount must be an integer between 0 and ' + MAX_GHOST_COUNT);
  }
  const dots = new Set();
  const powers = new Set();
  MAZE.forEach((row, y) => {
    [...row].forEach((tile, x) => {
      if (tile === '.') dots.add(id(x, y));
      if (tile === 'o') powers.add(id(x, y));
    });
  });
  const game = {
    dots, powers, totalDots: dots.size + powers.size, score: 0, lives: 3,
    ticks: 0, queuedDirection: null, phase: 'ready',
  };
  resetActors(game, ghostCount);
  return game;
}

function copyState(state, dots, powers) {
  return {
    ...state, dots, powers, player: { ...state.player },
    ghosts: state.ghosts.map(ghost => ({ ...ghost })),
  };
}

// Versions and stage IDs are stored alongside the snapshot in each data record.
export function snapshotGame(game) {
  return copyState(game, [...game.dots], [...game.powers]);
}

export function restoreGame(snapshot) {
  if (!Array.isArray(snapshot.dots) || !Array.isArray(snapshot.powers)) {
    throw new TypeError('A game snapshot must contain arrays of remaining dots and power pellets.');
  }
  return copyState(snapshot, new Set(snapshot.dots), new Set(snapshot.powers));
}

export function startGame(game) {
  if (game.phase === 'lifeLost') resetActors(game, game.ghosts.length);
  if (game.phase === 'ready' || game.phase === 'lifeLost') game.phase = 'playing';
}

export function queueTurn(game, direction) {
  if (headings.includes(direction)) game.queuedDirection = direction;
}

function moveActor(actor, direction) {
  const destination = exits[positionId(actor)][direction];
  if (destination === undefined) return;
  actor.x = destination % WIDTH;
  actor.y = Math.floor(destination / WIDTH);
  actor.direction = direction;
}

function movePlayer(game) {
  const player = game.player;
  if (exits[positionId(player)][game.queuedDirection] !== undefined) {
    player.direction = game.queuedDirection;
    game.queuedDirection = null;
  }
  moveActor(player, player.direction);
}

function aheadOfPlayer(player) {
  let target = positionId(player);
  for (let i = 0; i < 4; i++) {
    const next = exits[target][player.direction];
    if (next === undefined) break;
    target = next;
  }
  return target;
}

function moveGhost(game, ghost) {
  // Chaser moves 3/4 turns, ambusher 2/3 turns, frightened ghosts every other turn.
  const skipPeriod = ghost.kind === 'chaser' ? 4 : 3;
  if (game.ticks % (game.powerTicks ? 2 : skipPeriod) === 0) return;
  const adjacent = exits[positionId(ghost)];
  const frightened = game.powerTicks > 0;
  const target = ghost.kind === 'ambusher' && !frightened
    ? aheadOfPlayer(game.player) : positionId(game.player);
  const options = Object.keys(adjacent);
  const onward = options.filter(direction => direction !== reverse[ghost.direction]);
  // A frightened ghost may reverse immediately; a pursuer commits to its tunnel.
  const candidates = frightened || !onward.length ? options : onward;
  const value = direction => {
    const distance = distances[target][adjacent[direction]];
    return frightened ? distance : -distance;
  };
  const best = candidates.reduce((choice, candidate) =>
    value(candidate) > value(choice) ? candidate : choice);
  moveActor(ghost, best);
}

function collectPellet(game, events) {
  const tile = positionId(game.player);
  if (game.dots.delete(tile)) {
    game.score += 10;
    events.push('dot');
  }
  if (game.powers.delete(tile)) {
    game.score += 50;
    game.powerTicks = POWER_TICKS;
    game.ghostCombo = 0;
    events.push('power');
  }
}

function collide(game, ghostIndex, events) {
  if (game.powerTicks) {
    game.score += 200 * 2 ** Math.min(game.ghostCombo, 3);
    game.ghostCombo++;
    Object.assign(game.ghosts[ghostIndex], createGhost(ghostIndex, 15));
    events.push('ghost');
    return;
  }
  game.lives--;
  game.queuedDirection = null;
  game.phase = game.lives > 0 ? 'lifeLost' : 'gameOver';
  events.push(game.phase);
}

export function tick(game) {
  if (game.phase !== 'playing') return [];
  const events = [];
  game.ticks++;
  const playerBefore = positionId(game.player);
  movePlayer(game);
  const playerAfter = positionId(game.player);
  collectPellet(game, events);
  if (game.dots.size + game.powers.size === 0) {
    game.phase = 'won';
    events.push('won');
    return events;
  }
  for (const [index, ghost] of game.ghosts.entries()) {
    if (ghost.homeTicks > 0) {
      ghost.homeTicks--;
      continue;
    }
    const ghostBefore = positionId(ghost);
    moveGhost(game, ghost);
    const ghostAfter = positionId(ghost);
    const crossed = ghostBefore === playerAfter && ghostAfter === playerBefore;
    if (ghostAfter === playerAfter || crossed) {
      collide(game, index, events);
      if (game.phase !== 'playing') break;
    }
  }
  if (game.powerTicks > 0 && !events.includes('power')) game.powerTicks--;
  return events;
}
