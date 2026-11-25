import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, MAX_GHOST_COUNT, STAGE_ID } from '../game.js';
import { FEATURE_NAMES, features } from '../ai/utility.js';
import { generateRecords, replayRecord } from '../training/rollouts.mjs';

test('the network observes the nearest active ghost of each kind and handles an empty maze', () => {
  const game = createGame({ ghostCount: 4 });
  game.player = { x: 4, y: 3, direction: 'left' };
  for (const [index, ghost] of game.ghosts.entries()) {
    Object.assign(ghost, { x: [10, 11, 5, 6][index], y: 3, direction: 'left', homeTicks: 0 });
  }
  const read = name => features(game)[FEATURE_NAMES.indexOf(name)];
  assert.equal(read('chaser_proximity'), 1 / (1 + 1 / 4));
  assert.equal(read('ambusher_proximity'), 1 / (1 + 2 / 4));
  assert.equal(read('approaching_ghost_fraction'), 1);
  game.ghosts[2].homeTicks = 1;
  assert.equal(read('chaser_proximity'), 1 / (1 + 6 / 4));
  assert.equal(read('approaching_ghost_fraction'), 3 / 4);

  const empty = features(createGame({ ghostCount: 0 }));
  assert.ok(empty.every(Number.isFinite));
  for (const name of ['chaser_proximity', 'ambusher_proximity', 'approaching_ghost_fraction']) {
    assert.equal(empty[FEATURE_NAMES.indexOf(name)], 0);
  }
});

test('each ghost count generates replayable junctions with distinct episode IDs', () => {
  const options = { seed: 18, horizon: 2, count: 1 };
  const episodes = new Set();
  for (let ghostCount = 0; ghostCount <= MAX_GHOST_COUNT; ghostCount++) {
    const [record] = generateRecords({ ...options, ghostCount });
    assert.equal(record.state.ghosts.length, ghostCount);
    assert.ok(record.features.every(Number.isFinite));
    replayRecord(JSON.parse(JSON.stringify(record)));
    assert.ok(!episodes.has(record.episode_id));
    episodes.add(record.episode_id);
    if (ghostCount === 2) assert.equal(record.episode_id, STAGE_ID + '-18-1');
  }
});
