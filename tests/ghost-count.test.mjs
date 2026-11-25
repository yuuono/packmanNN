import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_GHOST_COUNT, MAZE, createGame, restoreGame, snapshotGame, startGame, tick } from '../game.js';

test('the original two ghosts remain the default, and supported counts start at distinct homes', () => {
  assert.deepEqual(createGame().ghosts, [
    { kind: 'chaser', x: 8, y: 7, direction: 'left', homeTicks: 4 },
    { kind: 'ambusher', x: 10, y: 7, direction: 'right', homeTicks: 9 },
  ]);
  for (let ghostCount = 0; ghostCount <= MAX_GHOST_COUNT; ghostCount++) {
    const game = createGame({ ghostCount });
    assert.equal(game.ghosts.length, ghostCount);
    assert.equal(new Set(game.ghosts.map(g => g.x + ',' + g.y)).size, ghostCount);
    for (const ghost of game.ghosts) assert.equal(MAZE[ghost.y][ghost.x], ' ');
    const roster = structuredClone(game.ghosts);
    startGame(game);
    const restored = restoreGame(JSON.parse(JSON.stringify(snapshotGame(game))));
    for (let i = 0; i < 25; i++) {
      assert.deepEqual(tick(game), tick(restored));
      assert.deepEqual(snapshotGame(game), snapshotGame(restored));
    }
    restored.phase = 'lifeLost';
    startGame(restored);
    assert.deepEqual(restored.ghosts, roster);
  }
  for (const ghostCount of [-1, MAX_GHOST_COUNT + 1, 1.5, NaN, '2']) {
    assert.throws(() => createGame({ ghostCount }), RangeError);
  }
});

test('each captured ghost in a four-ghost snapshot returns to its own home', () => {
  const game = createGame({ ghostCount: 4 });
  startGame(game);
  for (const [index, original] of game.ghosts.entries()) {
    const restored = restoreGame(snapshotGame(game));
    restored.powerTicks = 8;
    restored.ticks = 1; // Frightened ghosts stand still on the next tick.
    Object.assign(restored.ghosts[index], { x: 8, y: 11, homeTicks: 0 });
    assert.ok(tick(restored).includes('ghost'));
    assert.deepEqual(restored.ghosts[index], { ...original, homeTicks: 15 });
    assert.equal(restored.ghosts.length, 4);
  }
});
