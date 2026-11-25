import { parseArgs } from 'node:util';
import { DEFAULT_GHOST_COUNT, MAX_GHOST_COUNT } from '../game.js';
import { generateRecords } from './rollouts.mjs';
import { writeRecords } from './jsonl.mjs';

const usage = `node training/generate.mjs --out FILE [--count 100] [--seed 42] [--horizon 32] [--ghosts 0..${MAX_GHOST_COUNT}] (default ghosts: ${DEFAULT_GHOST_COUNT})`;
try {
  const { values } = parseArgs({ options: {
    out: { type: 'string' }, count: { type: 'string', default: '100' },
    seed: { type: 'string', default: '42' }, horizon: { type: 'string', default: '32' },
    ghosts: { type: 'string', default: String(DEFAULT_GHOST_COUNT) },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log(usage);
  } else {
    if (!values.out) throw new Error(usage);
    const records = generateRecords({
      count: Number(values.count), seed: Number(values.seed), horizon: Number(values.horizon),
      ghostCount: values.ghosts.trim() ? Number(values.ghosts) : NaN,
    });
    const started = performance.now();
    const count = await writeRecords(values.out, records);
    console.log(`Wrote ${count} snapshots to ${values.out} (${((performance.now() - started) / 1000).toFixed(2)} s)`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
