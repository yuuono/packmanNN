// Compare two full continuations from the earliest saved junction of each test episode.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ENGINE_VERSION, STAGE_ID, queueTurn, restoreGame, startGame, tick } from '../game.js';
import { FEATURE_VERSION, POLICY_VERSION, PRESETS, chooseAction } from '../ai/utility.js';
import { validateModel } from '../ai/model.js';
import { makeWeightSelector } from '../ai/controller.js';
import { readRecords } from './jsonl.mjs';

function playContinuation(state, weightFactory, maxSteps) {
  const game = restoreGame(state);
  const remainingAtStart = game.dots.size + game.powers.size;
  let weights = weightFactory();
  let steps = 0;
  while (steps < maxSteps && game.phase === 'playing') {
    queueTurn(game, chooseAction(game, weights(game)));
    tick(game);
    steps++;
    if (game.phase === 'lifeLost') {
      startGame(game);
      weights = weightFactory();
    }
  }
  const collected = remainingAtStart - game.dots.size - game.powers.size;
  return {
    cleared: game.phase === 'won',
    game_over: game.phase === 'gameOver',
    timed_out: game.phase === 'playing',
    lives_lost: state.lives - game.lives,
    collected, available: remainingAtStart,
    score_delta: game.score - state.score, steps,
  };
}

function summarize(results) {
  const mean = fn => results.reduce((sum, result) => sum + fn(result), 0) / results.length;
  return {
    games: results.length,
    clear_rate: mean(r => Number(r.cleared)),
    game_over_rate: mean(r => Number(r.game_over)),
    timeout_rate: mean(r => Number(r.timed_out)),
    mean_lives_lost: mean(r => r.lives_lost),
    mean_collection_rate: mean(r => r.collected / r.available),
    mean_score_delta: mean(r => r.score_delta),
    mean_steps: mean(r => r.steps),
  };
}

export async function evaluate(records, model, maxSteps = 600) {
  validateModel(model);
  const preset = PRESETS.find(candidate => candidate.id === model.best_fixed_policy_id);
  if (!preset) throw new Error('Missing or unknown fixed baseline in model');
  if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new Error('max-steps must be a positive integer');
  const groups = model.split_episode_ids;
  const allIds = ['train', 'val', 'test'].flatMap(split => {
    if (!Array.isArray(groups?.[split]) || !groups[split].length) throw new Error('Missing episode split: ' + split);
    return groups[split];
  });
  if (new Set(allIds).size !== allIds.length) throw new Error('Episode splits overlap');
  const test = new Set(groups.test);
  const starts = new Map();
  for await (const record of records) {
    if (!test.has(record.episode_id)) continue;
    if (record.stage_id !== STAGE_ID || record.engine_version !== ENGINE_VERSION ||
        record.feature_version !== FEATURE_VERSION || record.policy_version !== POLICY_VERSION ||
        record.schema_version !== 1 || record.state?.phase !== 'playing') {
      throw new Error('Incompatible test snapshot: ' + record.snapshot_id);
    }
    const current = starts.get(record.episode_id);
    if (!current || record.state.ticks < current.state.ticks) starts.set(record.episode_id, record);
  }
  if (starts.size !== test.size) throw new Error('The input does not contain all held-out episodes in the model');
  const episodes = Array.from(starts.values(), record => ({
    episode_id: record.episode_id, snapshot_id: record.snapshot_id,
    fixed: playContinuation(record.state, () => () => preset.weights, maxSteps),
    neural: playContinuation(record.state, () => makeWeightSelector(model), maxSteps),
  }));
  return {
    max_steps: maxSteps, fixed_policy_id: preset.id,
    fixed: summarize(episodes.map(pair => pair.fixed)),
    neural: summarize(episodes.map(pair => pair.neural)),
    episodes,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: {
      input: { type: 'string' }, model: { type: 'string' }, 'max-steps': { type: 'string', default: '600' },
      help: { type: 'boolean' },
    } });
    const usage = 'node training/evaluate.mjs --input FILE --model MODEL.json [--max-steps 600]';
    if (values.help) console.log(usage);
    else {
      if (!values.input || !values.model) throw new Error(usage);
      const model = JSON.parse(await readFile(values.model, 'utf8'));
      const report = await evaluate(readRecords(values.input), model, Number(values['max-steps']));
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
