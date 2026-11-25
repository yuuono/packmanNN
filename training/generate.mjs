import { parseArgs } from 'node:util';
import { generateRecords } from './rollouts.mjs';
import { writeRecords } from './jsonl.mjs';

const usage = 'node training/generate.mjs --out FILE [--count 100] [--seed 42] [--horizon 32]';
try {
  const { values } = parseArgs({ options: {
    out: { type: 'string' }, count: { type: 'string', default: '100' },
    seed: { type: 'string', default: '42' }, horizon: { type: 'string', default: '32' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log(usage);
  } else {
    if (!values.out) throw new Error(usage);
    const records = generateRecords({
      count: Number(values.count), seed: Number(values.seed), horizon: Number(values.horizon),
    });
    const started = performance.now();
    const count = await writeRecords(values.out, records);
    console.log(`Wrote ${count} snapshots to ${values.out} (${((performance.now() - started) / 1000).toFixed(2)} s)`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
