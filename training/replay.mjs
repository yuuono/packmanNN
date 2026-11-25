import { parseArgs } from 'node:util';
import { refreshFeatures, replayRecord } from './rollouts.mjs';
import { readRecords, writeRecords } from './jsonl.mjs';

async function* processRows(path, featureOnly) {
  const ids = new Set();
  for await (const record of readRecords(path)) {
    try {
      if (ids.has(record.snapshot_id)) throw new Error('Duplicate snapshot_id');
      ids.add(record.snapshot_id);
      if (featureOnly) yield refreshFeatures(record);
      else {
        replayRecord(record);
        yield record;
      }
    } catch (error) {
      throw new Error((record?.snapshot_id ?? 'unknown snapshot') + ': ' + error.message);
    }
  }
}

const usage = 'node training/replay.mjs --input FILE [--features-out NEW_FILE]';
try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, 'features-out': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log(usage);
  } else {
    if (!values.input) throw new Error(usage);
    const output = values['features-out'];
    const rows = processRows(values.input, Boolean(output));
    if (output) {
      const count = await writeRecords(output, rows);
      console.log(`Recomputed features for ${count} snapshots in ${output}`);
    } else {
      let count = 0;
      for await (const record of rows) count++;
      console.log(`Verified all recorded candidates in ${count} snapshots`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
