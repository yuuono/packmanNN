import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGame, startGame, snapshotGame, WIDTH } from '../game.js';
import { buildRecord, generateRecords, refreshFeatures, replayRecord } from '../training/rollouts.mjs';
import { readRecords, writeRecords } from '../training/jsonl.mjs';

function junction() {
  const game = createGame();
  startGame(game);
  game.player = { x: 4, y: 3, direction: 'left' };
  game.queuedDirection = 'up';
  game.ticks = 35;
  return game;
}

test('each policy can be replayed from the same independent start, including pending input', () => {
  const record = buildRecord(snapshotGame(junction()), 'fixture', 2);
  assert.equal(record.candidates.length, 5);
  assert.ok(record.legal_actions.length >= 3);
  assert.equal(record.state.queuedDirection, 'up');
  assert.equal(record.state.ticks, 35);
  const decoded = JSON.parse(JSON.stringify(record));
  assert.doesNotThrow(() => replayRecord(decoded));
  decoded.candidates[1].end_state_sha256 = 'wrong';
  assert.throws(() => replayRecord(decoded), /Replay mismatch/);
  const editedStart = structuredClone(record);
  editedStart.state.queuedDirection = null;
  assert.throws(() => refreshFeatures(editedStart), /Starting state checksum/);
});

test('clear stops a candidate immediately and is distinct from surviving the whole horizon', () => {
  const game = junction();
  game.powers.clear();
  game.dots = new Set([3 * WIDTH + 3]);
  for (const ghost of game.ghosts) ghost.homeTicks = 20;
  const record = buildRecord(snapshotGame(game), 'fixture-clear', 2);
  const cleared = record.candidates.find(c => c.metrics.cleared);
  assert.ok(cleared);
  assert.equal(cleared.inputs.length, 1);
  assert.equal(cleared.metrics.death_step, null);
  assert.equal(cleared.metrics.end_reason, 'clear');
  assert.equal(cleared.metrics.nearest_threat_distance, null);
});

test('a capture on the last tick is not marked as a horizon completion', () => {
  const game = junction();
  // Chaser stays still on the next tick, directly on the left entrance.
  Object.assign(game.ghosts[0], { x: 3, y: 3, homeTicks: 0 });
  game.dots = new Set([3 * WIDTH + 3, 13 * WIDTH + 1]);
  game.powers.clear();
  const record = buildRecord(snapshotGame(game), 'fixture-danger', 1);
  const caught = record.candidates.find(c => c.metrics.end_reason === 'caught');
  assert.ok(caught);
  assert.equal(caught.metrics.death_step, 1);
  assert.equal(caught.metrics.lives_lost, 1);
});

test('feature refresh preserves saved trajectories and refuses incompatible engine versions', () => {
  const record = buildRecord(snapshotGame(junction()), 'fixture', 1);
  const old = { ...record, feature_version: 'old', feature_names: ['old'], features: [17] };
  assert.throws(() => replayRecord(old), /feature_version/);
  assert.deepEqual(refreshFeatures(old), record);
  assert.throws(() => refreshFeatures({ ...old, engine_version: 'unknown' }), /engine_version/);
});

test('tiny in-memory collection is reproducible and every collected state is an intersection', () => {
  const options = { seed: 18, count: 2, horizon: 1 };
  const first = [...generateRecords(options)];
  assert.equal(first.length, 2);
  assert.deepEqual([...generateRecords(options)], first);
  assert.equal(new Set(first.map(r => r.snapshot_id)).size, 2);
  for (const record of first) {
    assert.ok(record.legal_actions.length >= 3);
    replayRecord(record);
  }
});

test('JSONL is one parent per line; failure preserves the destination and cleans temporary files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maze-jsonl-test-'));
  const out = join(dir, 'sample.jsonl');
  try {
    const record = { snapshot_id: 'fixture', candidates: [{}, {}] };
    assert.equal(await writeRecords(out, [record]), 1);
    assert.equal((await readFile(out, 'utf8')).trim().split('\n').length, 1);
    let loaded;
    for await (const row of readRecords(out)) loaded = row;
    assert.deepEqual(loaded, record);
    await assert.rejects(writeRecords(out, [record]), /already exists/);
    function* interrupted() { yield record; throw new Error('interrupted'); }
    await assert.rejects(writeRecords(join(dir, 'failed.jsonl'), interrupted()), /interrupted/);
    assert.deepEqual(await readdir(dir), ['sample.jsonl']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
