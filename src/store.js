// -----------------------------------------------------------------------------
// What the integration keeps under /data, the only writable directory of the
// container: the Neviweb session (a secret: the files are readable by the
// container user only), the request counter of the day, and the signature of
// each Neviweb device (one request per device, asked once).
//
// Writes go through a temporary file and a rename, so a container stopped in
// the middle of one leaves the previous version, never half a file.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';

export class Store {
  /** @param {string} [dir] */
  constructor(dir = DEFAULT_DATA_DIR) {
    this.dir = dir;
    this.writes = Promise.resolve();
  }

  /** @returns {Promise<any|null>} null when the file is missing or unreadable */
  async readJson(name) {
    try {
      return JSON.parse(await readFile(join(this.dir, name), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Writes run one after the other: the last one called wins. */
  writeJson(name, value) {
    const write = async () => {
      await mkdir(this.dir, { recursive: true });
      const path = join(this.dir, name);
      const temporary = `${path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      await rename(temporary, path);
    };
    const run = this.writes.then(write, write);
    this.writes = run.catch(() => {});
    return run;
  }

  remove(name) {
    const run = this.writes.then(() => rm(join(this.dir, name), { force: true }));
    this.writes = run.catch(() => {});
    return run;
  }

  /** Resolves once the writes in progress are done. */
  flush() {
    return this.writes;
  }
}
