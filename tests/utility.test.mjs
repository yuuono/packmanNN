import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POWER_TICKS, createGame, queueTurn, restoreGame, snapshotGame, startGame, tick,
} from '../game.js';
import {
  FEATURE_NAMES, PRESETS, chooseAction, endMetrics, features, legalActions, rankActions, teacherAction,
} from '../ai/utility.js';

test('JSON snapshot preserves queued input, ghost timers, pellets, combo and independent simulations', () => {
  const original = createGame();
  startGame(original);
  tick(original);
  original.powerTicks = 7;
  original.ghostCombo = 2;
  queueTurn(original, 'up');
  const saved = JSON.parse(JSON.stringify(snapshotGame(original)));
  const copy = restoreGame(saved);
  assert.deepEqual(copy, original);
  assert.notEqual(copy.player, saved.player);
  assert.notEqual(copy.ghosts[0], saved.ghosts[0]);
  for (let i = 0; i < 12; i++) {
    assert.deepEqual(tick(copy), tick(original));
    assert.deepEqual(snapshotGame(copy), snapshotGame(original));
  }
  copy.dots.clear();
  assert.ok(original.dots.size > 0);
  assert.equal(saved.powerTicks, 7);
  assert.equal(saved.queuedDirection, 'up');
});

test('a waiting or frightened ghost is excluded from dangerous-distance metrics', () => {
  const game = createGame();
  const legal = legalActions(game);
  assert.deepEqual(endMetrics(game), {
    nearest_threat_distance: null, escape_count: legal.length, power_ticks: 0,
  });
  Object.assign(game.ghosts[0], { x: game.player.x - 1, y: game.player.y, homeTicks: 0 });
  assert.equal(endMetrics(game).nearest_threat_distance, 1);
  assert.ok(endMetrics(game).escape_count < legal.length);
  game.powerTicks = POWER_TICKS;
  assert.deepEqual(endMetrics(game), {
    nearest_threat_distance: null, escape_count: legal.length, power_ticks: POWER_TICKS,
  });
});

test('all policies return legal, explainable choices and respect the power timer', () => {
  const game = createGame();
  startGame(game);
  game.player = { x: 4, y: 11, direction: 'right' };
  Object.assign(game.ghosts[0], { x: 5, y: 11, homeTicks: 0 });
  const legal = legalActions(game);
  assert.ok(legal.length >= 3);
  for (const weights of PRESETS.map(preset => preset.weights)) {
    const ranked = rankActions(game, weights);
    assert.deepEqual(new Set(ranked.map(row => row.action)), new Set(legal));
    assert.equal(chooseAction(game, weights), ranked[0].action);
    for (const row of ranked) {
      assert.ok(row.components.every(value => value >= 0 && value <= 1));
      assert.equal(row.score, row.components.reduce((sum, v, i) => sum + v * weights[i], 0));
    }
  }
  assert.notEqual(teacherAction(game), 'right');
  game.powerTicks = POWER_TICKS;
  assert.equal(teacherAction(game), 'right');
  assert.equal(chooseAction(game, [0,0,0,1]), 'right');
  assert.equal(features(game).length, FEATURE_NAMES.length);
  assert.equal(FEATURE_NAMES.length, 12);
  assert.ok(features(game).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
});
