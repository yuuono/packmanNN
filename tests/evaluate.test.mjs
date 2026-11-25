import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, ENGINE_VERSION, snapshotGame, STAGE_ID, startGame, WIDTH } from '../game.js';
import { FEATURE_NAMES, FEATURE_VERSION, POLICY_VERSION } from '../ai/utility.js';
import { WEIGHT_NAMES } from '../ai/model.js';
import { evaluate } from '../training/evaluate.mjs';

function balancedFixture() {
  const zeros = Array(FEATURE_NAMES.length).fill(0);
  return {
    format: 'maze-personality-v1', engine_version: ENGINE_VERSION,
    feature_version: FEATURE_VERSION, policy_version: POLICY_VERSION,
    feature_names: FEATURE_NAMES, weight_names: WEIGHT_NAMES,
    layers: [{weights: [zeros], bias: [0]}, {weights: [[0],[0],[0],[0]], bias: [0,0,0,0]}],
    parity: { input: zeros, output: [0.25,0.25,0.25,0.25] },
    best_fixed_policy_id: 'balanced', split_episode_ids: {train:['a'], val:['b'], test:['c']},
  };
}

function fixtureRecord() {
  const game = createGame();
  startGame(game);
  game.player = {x:4, y:3, direction:'left'};
  game.dots = new Set([3 * WIDTH + 3]);
  game.powers.clear();
  return {
    stage_id: STAGE_ID, engine_version: ENGINE_VERSION, feature_version: FEATURE_VERSION,
    policy_version: POLICY_VERSION, schema_version: 1,
    snapshot_id: 'c@0', episode_id: 'c', state: snapshotGame(game),
  };
}

test('paired game evaluation uses one held-out start per episode and compares identical controls fairly', async () => {
  const record = fixtureRecord();
  const later = {...record, snapshot_id:'c@12', state:{...record.state, ticks:12}};
  const result = await evaluate([later, record, {...record, episode_id:'a'}], balancedFixture(), 5);
  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].snapshot_id, 'c@0');
  assert.deepEqual(result.neural, result.fixed);
  assert.equal(result.fixed.clear_rate, 1);
  assert.equal(result.neural.mean_collection_rate, 1);
});

test('evaluation rejects missing, overlapping or incompatible held-out data', async () => {
  const model = balancedFixture();
  await assert.rejects(evaluate([], model), /held-out/);
  await assert.rejects(evaluate([{...fixtureRecord(), engine_version:'changed'}], model), /Incompatible/);
  model.split_episode_ids.test = ['a'];
  await assert.rejects(evaluate([], model), /overlap/);
});
