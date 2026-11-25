import { MAZE, WIDTH, POWER_TICKS, neighborsOf, corridorDistance } from '../game.js';

export const FEATURE_VERSION = 'maze-features-1';
export const POLICY_VERSION = 'utility-1';
export const FEATURE_NAMES = Object.freeze([
  'pellets_remaining_fraction', 'power_pellets_remaining_fraction', 'power_time_fraction',
  'nearest_dot_proximity', 'nearest_power_pellet_proximity',
  'chaser_proximity', 'ambusher_proximity', 'approaching_ghost_fraction',
  'exit_fraction', 'escape_fraction', 'local_dot_density', 'mean_pellet_distance',
]);

// Components and model outputs use this order: local, global, cautious, power.
export const PRESETS = Object.freeze([
  { id: 'local', weights: [0.70, 0.10, 0.15, 0.05] },
  { id: 'global', weights: [0.10, 0.70, 0.15, 0.05] },
  { id: 'cautious', weights: [0.15, 0.10, 0.70, 0.05] },
  { id: 'power', weights: [0.10, 0.05, 0.15, 0.70] },
  { id: 'balanced', weights: [0.25, 0.25, 0.25, 0.25] },
].map(preset => Object.freeze({ ...preset, weights: Object.freeze(preset.weights) })));

const clamp = value => Math.max(0, Math.min(value, 1));
const tileOf = actor => actor.y * WIDTH + actor.x;
const near = distance => 1 / (1 + distance / 4);
const tiles = MAZE.flatMap((row, y) => Array.from(row, (cell, x) => cell === '#' ? -1 : y * WIDTH + x))
  .filter(tile => tile >= 0);
const powerCount = MAZE.join('').split('o').length - 1;

// Distances and ordering depend only on the maze. Resolve equal distances by
// tile ID so a JSON round trip, browser, and Node all choose the same route.
const nearestTiles = [];
const neighborhoods = [];
for (const from of tiles) {
  nearestTiles[from] = [...tiles].sort((a, b) =>
    corridorDistance(from, a) - corridorDistance(from, b) || a - b);
  neighborhoods[from] = nearestTiles[from].filter(to => corridorDistance(from, to) <= 4);
}

function corridorFrom(origin, first) {
  const path = [first];
  let previous = origin;
  let current = first;
  while (current !== origin && Object.keys(neighborsOf(current)).length === 2) {
    const next = Object.values(neighborsOf(current)).find(tile => tile !== previous);
    path.push(next);
    previous = current;
    current = next;
  }
  return path;
}

// Every possible non-reversing path in the four moves after choosing an exit.
function fourMovePaths(previous, path) {
  const onward = Object.values(neighborsOf(path.at(-1)))
    .filter(tile => tile !== previous && !path.includes(tile));
  if (path.length === 4 || !onward.length) return [path];
  return onward.flatMap(tile => fourMovePaths(path.at(-1), [...path, tile]));
}

const choices = [];
for (const origin of tiles) {
  choices[origin] = Object.entries(neighborsOf(origin)).map(([action, first]) => ({
    action, first,
    corridor: corridorFrom(origin, first),
    shortPaths: fourMovePaths(origin, [first]),
  }));
}

export function legalActions(game) {
  return choices[tileOf(game.player)].map(choice => choice.action);
}

function nearestItem(from, contains) {
  for (const tile of nearestTiles[from]) {
    if (contains(tile)) return corridorDistance(from, tile);
  }
  return Infinity;
}

function activeGhostTiles(game) {
  return game.ghosts.filter(ghost => ghost.homeTicks === 0).map(tileOf);
}

function nearestGhost(from, ghosts) {
  let closest = Infinity;
  for (const ghost of ghosts) closest = Math.min(closest, corridorDistance(from, ghost));
  return closest;
}

// Conservative lead, in tiles, before a ghost could intercept this corridor.
// A power pellet immediately protects the player on the tile where it is eaten.
function arrivalMargin(game, choice, threats) {
  let margin = Infinity;
  for (const [index, tile] of choice.corridor.entries()) {
    if (game.powers.has(tile)) break;
    margin = Math.min(margin, nearestGhost(tile, threats) - (index + 1));
  }
  return margin;
}

export function endMetrics(game) {
  const origin = tileOf(game.player);
  const threats = game.powerTicks ? [] : activeGhostTiles(game);
  const distance = nearestGhost(origin, threats);
  return {
    nearest_threat_distance: Number.isFinite(distance) ? distance : null,
    escape_count: choices[origin].filter(choice => arrivalMargin(game, choice, threats) > 0).length,
    power_ticks: game.powerTicks,
  };
}

export function features(game) {
  const origin = tileOf(game.player);
  const remaining = game.dots.size + game.powers.size;
  const nearby = neighborhoods[origin];
  const ghosts = game.ghosts.filter(ghost => ghost.homeTicks === 0);
  const proximityOf = kind => {
    const ghost = ghosts.find(actor => actor.kind === kind);
    return ghost ? near(corridorDistance(origin, tileOf(ghost))) : 0;
  };
  const approaching = ghosts.filter(ghost => {
    const tile = tileOf(ghost);
    const next = neighborsOf(tile)[ghost.direction];
    return next !== undefined && corridorDistance(origin, next) < corridorDistance(origin, tile);
  }).length;
  let distanceSum = 0;
  for (const group of [game.dots, game.powers]) {
    for (const tile of group) distanceSum += corridorDistance(origin, tile);
  }
  return [
    remaining / game.totalDots,
    game.powers.size / Math.max(1, powerCount),
    game.powerTicks / POWER_TICKS,
    near(nearestItem(origin, tile => game.dots.has(tile))),
    near(nearestItem(origin, tile => game.powers.has(tile))),
    proximityOf('chaser'), proximityOf('ambusher'), approaching / game.ghosts.length,
    choices[origin].length / 4, endMetrics(game).escape_count / 4,
    nearby.filter(tile => game.dots.has(tile)).length / nearby.length,
    remaining ? clamp(distanceSum / remaining / 32) : 0,
  ];
}

function localScore(game, choice) {
  let best = 0;
  for (const path of choice.shortPaths) {
    const count = path.filter(tile => game.dots.has(tile) || game.powers.has(tile)).length;
    best = Math.max(best, count);
  }
  const distance = nearestItem(choice.first, tile => game.dots.has(tile) || game.powers.has(tile));
  return 0.65 * best / 4 + 0.35 / (1 + distance);
}

// Approximate the walk to clear all remaining pellets from each candidate
// by greedily visiting the nearest remaining pellet in corridor distance.
function sweepLength(game, first) {
  const remaining = new Uint8Array(WIDTH * MAZE.length);
  for (const tile of game.dots) remaining[tile] = 1;
  for (const tile of game.powers) remaining[tile] = 1;
  let count = game.dots.size + game.powers.size - remaining[first];
  remaining[first] = 0;
  let from = first;
  let length = 1;
  while (count > 0) {
    const next = nearestTiles[from].find(tile => remaining[tile]);
    length += corridorDistance(from, next);
    remaining[next] = 0;
    from = next;
    count--;
  }
  return length;
}

function powerScore(game, first, ghosts) {
  if (game.powerTicks) {
    const untilGhost = nearestGhost(first, ghosts);
    // The first step costs one tick. Only reward pursuits within the time remaining.
    return untilGhost + 1 <= game.powerTicks ? near(untilGhost) : 0;
  }
  const untilPower = nearestItem(first, tile => game.powers.has(tile));
  const urgency = near(nearestGhost(tileOf(game.player), ghosts));
  return near(untilPower) * (0.55 + 0.45 * urgency);
}

export function rankActions(game, weights) {
  if (!Array.isArray(weights) || weights.length !== 4 ||
      !weights.every(weight => Number.isFinite(weight) && weight >= 0) ||
      !weights.some(weight => weight > 0)) {
    throw new RangeError('Utility AI requires four nonnegative weights with a positive total.');
  }
  const options = choices[tileOf(game.player)];
  const ghosts = activeGhostTiles(game);
  const threats = game.powerTicks ? [] : ghosts;
  const tours = options.map(choice => sweepLength(game, choice.first));
  const longest = Math.max(...tours);
  const range = Math.max(4, longest - Math.min(...tours));
  const ranked = options.map((choice, index) => {
    const margin = arrivalMargin(game, choice, threats);
    const components = [
      localScore(game, choice), (longest - tours[index]) / range,
      clamp((margin + 2) / 9), powerScore(game, choice.first, ghosts),
    ];
    const score = components.reduce((total, value, i) => total + value * weights[i], 0);
    return { action: choice.action, components, score };
  });
  // Keep moving in a tie, then retain the engine's stable directional order.
  return ranked.sort((a, b) => b.score - a.score ||
    Number(b.action === game.player.direction) - Number(a.action === game.player.direction));
}

export function chooseAction(game, weights) {
  return rankActions(game, weights)[0].action;
}

// Reactive priority selector with condition/action sequences. Foraging uses
// nearest-pellet distance to keep collecting in corridors cleared on an earlier visit.
const sequence = (condition, action) => state => condition(state) ? action(state) : null;
const selector = branches => state => {
  for (const branch of branches) {
    const result = branch(state);
    if (result !== null) return result;
  }
  return null;
};
function chooseTeacherMove(state, priority) {
  const origin = tileOf(state.game.player);
  const merit = choice => {
    const distance = nearestItem(choice.first, tile => state.game.dots.has(tile) || state.game.powers.has(tile));
    return [priority(choice), -distance, localScore(state.game, choice), Number(choice.action === state.game.player.direction)];
  };
  const options = choices[origin].map(choice => ({ action: choice.action, merit: merit(choice) }));
  options.sort((a, b) => {
    for (let i = 0; i < a.merit.length; i++) {
      if (a.merit[i] !== b.merit[i]) return b.merit[i] > a.merit[i] ? 1 : -1;
    }
    return 0;
  });
  return options[0].action;
}
const teacher = selector([
  sequence(state => !state.game.powerTicks && state.ghostDistance <= 4,
    state => chooseTeacherMove(state, choice => arrivalMargin(state.game, choice, state.ghosts))),
  sequence(state => state.game.powerTicks > 0 && state.ghostDistance <= Math.min(4, state.game.powerTicks),
    state => chooseTeacherMove(state, choice => -nearestGhost(choice.first, state.ghosts))),
  state => chooseTeacherMove(state, () => 0),
]);

export function teacherAction(game) {
  const ghosts = activeGhostTiles(game);
  return teacher({ game, ghosts, ghostDistance: nearestGhost(tileOf(game.player), ghosts) });
}
