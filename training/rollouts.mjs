import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  DEFAULT_GHOST_COUNT, ENGINE_VERSION, STAGE_ID, createGame, startGame, queueTurn, tick, snapshotGame, restoreGame,
} from '../game.js';
import {
  FEATURE_VERSION, FEATURE_NAMES, POLICY_VERSION, PRESETS,
  features, legalActions, chooseAction, teacherAction, endMetrics,
} from '../ai/utility.js';

export const SCHEMA_VERSION = 1;
const DIRECTIONS = ['up', 'down', 'left', 'right'];

// Independent of the order of JSON object keys in other readers/writers.
function stateDigest(state) {
  const value = JSON.stringify(state, (key, item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]));
  });
  return createHash('sha256').update(value).digest('hex');
}

function positiveInteger(number, name) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(name + ' must be a positive integer');
}

function movedDirection(before, after) {
  if (before.x !== after.x) return after.x > before.x ? 'right' : 'left';
  if (before.y !== after.y) return after.y > before.y ? 'down' : 'up';
  return null;
}

// All five policies start from independent, fully restored copies. For replay,
// apply the recorded inputs and verify them against the versioned policy too.
function runCandidate(state, preset, horizon, replayInputs) {
  const game = restoreGame(state);
  const initialDots = game.dots.size;
  const initialPowers = game.powers.size;
  const inputs = [];
  const events = [];
  let firstMove = null;
  let ghosts = 0;
  for (let i = 0; i < horizon && game.phase === 'playing'; i++) {
    const suggested = chooseAction(game, preset.weights);
    const input = replayInputs === undefined ? suggested : replayInputs[i];
    if (!DIRECTIONS.includes(input) || input !== suggested) {
      throw new Error(preset.id + ': invalid policy input at step ' + (i + 1));
    }
    const before = { x: game.player.x, y: game.player.y };
    queueTurn(game, input);
    const stepEvents = tick(game);
    inputs.push(input);
    if (i === 0) firstMove = movedDirection(before, game.player);
    if (stepEvents.length) events.push({ step: i + 1, events: stepEvents });
    ghosts += stepEvents.filter(event => event === 'ghost').length;
  }
  const lost = state.lives - game.lives;
  const cleared = game.phase === 'won';
  return {
    policy_id: preset.id,
    weights: [...preset.weights],
    first_input: inputs[0],
    first_move: firstMove,
    inputs,
    events,
    metrics: {
      steps: inputs.length,
      end_reason: lost ? 'caught' : cleared ? 'clear' : 'horizon',
      death_step: lost ? inputs.length : null,
      dots: initialDots - game.dots.size,
      powers: initialPowers - game.powers.size,
      ghosts,
      score_delta: game.score - state.score,
      lives_lost: lost,
      cleared,
      ...endMetrics(game),
    },
    end_state_sha256: stateDigest(snapshotGame(game)),
  };
}

export function buildRecord(state, episodeId, horizon = 32) {
  positiveInteger(horizon, 'horizon');
  const game = restoreGame(state);
  const directions = legalActions(game);
  if (game.phase !== 'playing' || directions.length < 3) {
    throw new Error('A rollout must start at a live junction with at least three exits');
  }
  if (!episodeId || typeof episodeId !== 'string') throw new Error('Missing episode ID');
  return {
    schema_version: SCHEMA_VERSION,
    stage_id: STAGE_ID,
    engine_version: ENGINE_VERSION,
    feature_version: FEATURE_VERSION,
    policy_version: POLICY_VERSION,
    feature_names: [...FEATURE_NAMES],
    episode_id: episodeId,
    snapshot_id: episodeId + '@' + game.ticks,
    horizon,
    state,
    start_state_sha256: stateDigest(state),
    features: features(game),
    legal_actions: directions,
    candidates: PRESETS.map(preset => runCandidate(state, preset, horizon)),
  };
}

function checkStateVersion(record) {
  if (record.schema_version !== SCHEMA_VERSION) throw new Error('Unsupported schema_version');
  if (record.engine_version !== ENGINE_VERSION) throw new Error('Incompatible engine_version');
  if (record.stage_id !== STAGE_ID) throw new Error('Unsupported stage_id');
  if (!record.snapshot_id || !record.episode_id) throw new Error('Missing record IDs');
  positiveInteger(record.horizon, 'horizon');
  if (record.start_state_sha256 !== stateDigest(record.state)) throw new Error('Starting state checksum mismatch');
}

export function refreshFeatures(record) {
  checkStateVersion(record);
  return {
    ...record,
    feature_version: FEATURE_VERSION,
    feature_names: [...FEATURE_NAMES],
    features: features(restoreGame(record.state)),
  };
}

export function replayRecord(record) {
  checkStateVersion(record);
  if (record.policy_version !== POLICY_VERSION) throw new Error('Incompatible policy_version');
  if (record.feature_version !== FEATURE_VERSION) throw new Error('Incompatible feature_version');
  const game = restoreGame(record.state);
  if (game.phase !== 'playing' || legalActions(game).length < 3) throw new Error('Invalid starting junction');
  for (const [name, actual] of [
    ['features', features(game)], ['feature_names', FEATURE_NAMES], ['legal_actions', legalActions(game)],
  ]) {
    if (!isDeepStrictEqual(record[name], actual)) throw new Error('Mismatch in ' + name);
  }
  if (record.snapshot_id !== record.episode_id + '@' + game.ticks) throw new Error('Mismatched snapshot_id');
  if (record.candidates?.length !== PRESETS.length) throw new Error('Incorrect number of candidates');
  for (const [index, preset] of PRESETS.entries()) {
    const saved = record.candidates[index];
    if (!Array.isArray(saved?.inputs)) throw new Error('Missing inputs for ' + preset.id);
    const actual = runCandidate(record.state, preset, record.horizon, saved.inputs);
    if (!isDeepStrictEqual(actual, saved)) throw new Error('Replay mismatch for ' + preset.id);
  }
}

function randomStream(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function situation(game) {
  if (game.powerTicks > 0) return 'powered';
  if (game.dots.size + game.powers.size <= game.totalDots / 3) return 'late';
  const distance = endMetrics(game).nearest_threat_distance;
  if (distance !== null && distance <= 4) return 'threatened';
  return 'ordinary';
}

function sampleEpisode(seed, episodeNumber, alreadyUsed, ghostCount) {
  const episodeSeed = seed ^ Math.imul(episodeNumber, 0x9e3779b1);
  const drive = randomStream(episodeSeed);
  const sample = randomStream(episodeSeed ^ 0x85ebca6b);
  const game = createGame({ ghostCount });
  startGame(game);
  const preset = PRESETS[episodeNumber % PRESETS.length];
  const buckets = new Map();
  for (let i = 0; i < 512; i++) {
    const actions = legalActions(game);
    if (actions.length >= 3) {
      const category = situation(game);
      if (!buckets.has(category)) buckets.set(category, { seen: 0, selected: null });
      const bucket = buckets.get(category);
      bucket.seen++;
      // Reservoir sampling lets late junctions displace the common early ones.
      if (sample() < 1 / bucket.seen) {
        const state = snapshotGame(game);
        const key = stateDigest(state);
        if (!alreadyUsed.has(key)) bucket.selected = { state, key, category };
      }
    }
    let action;
    if (actions.length >= 3 && drive() < 0.14) {
      action = actions[Math.floor(drive() * actions.length)];
    } else if (episodeNumber % 3 === 0) {
      action = chooseAction(game, preset.weights);
    } else {
      action = teacherAction(game);
    }
    queueTurn(game, action);
    tick(game);
    if (game.phase === 'lifeLost') startGame(game);
    if (game.phase !== 'playing') break;
  }
  return Array.from(buckets.values(), bucket => bucket.selected).filter(Boolean);
}

export function* generateRecords({ count = 100, seed = 42, horizon = 32, ghostCount = DEFAULT_GHOST_COUNT } = {}) {
  positiveInteger(count, 'count');
  positiveInteger(horizon, 'horizon');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('seed must be an unsigned 32-bit integer');
  }
  const used = new Set();
  // Keep IDs stable for existing data and distinct when combining difficulty settings.
  const episodePrefix = ghostCount === DEFAULT_GHOST_COUNT ? STAGE_ID : STAGE_ID + '-g' + ghostCount;
  let consecutiveEmpty = 0;
  for (let episode = 1; used.size < count; episode++) {
    const episodeId = episodePrefix + '-' + seed + '-' + episode;
    const samples = sampleEpisode(seed, episode, used, ghostCount);
    consecutiveEmpty = samples.length ? 0 : consecutiveEmpty + 1;
    if (consecutiveEmpty >= 100) throw new Error('No more distinct junctions found in the collection runs');
    for (const { state, key, category } of samples) {
      used.add(key);
      yield { ...buildRecord(state, episodeId, horizon), collection_situation: category };
      if (used.size === count) return;
    }
  }
}
