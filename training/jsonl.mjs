import { createReadStream } from 'node:fs';
import { access, link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

export async function* readRecords(path) {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of reader) {
      lineNumber++;
      try {
        yield JSON.parse(line);
      } catch (error) {
        throw new Error(path + ':' + lineNumber + ': ' + error.message);
      }
    }
    if (lineNumber === 0) throw new Error(path + ': empty JSONL');
  } finally {
    reader.close();
    stream.destroy();
  }
}

// A failed generator/transform leaves no partial dataset at the destination.
// link() publishes the completed file only if the destination is still absent.
export async function writeRecords(path, records) {
  try {
    await access(path);
    throw new Error('Output already exists: ' + path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.partial-' + randomUUID();
  const handle = await open(temporary, 'wx');
  let count = 0;
  try {
    for await (const record of records) {
      await handle.writeFile(JSON.stringify(record) + '\n');
      count++;
    }
    await handle.sync();
    await link(temporary, path);
    return count;
  } finally {
    try { await handle.close(); }
    finally { await unlink(temporary); }
  }
}
