import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ingest = require('../../src/mcp-skills/tools/10-cd-ingest.js');
const handler = ingest.tools.cd_ingest.handler;

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ingest-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

describe('cd_ingest', () => {
  it('normalizes and accumulates, deduping repeat runs', async () => {
    const messages = [
      { from: 'Аня', text: 'Ну это очень больно   каждый день', at: '2026-09-20T10:00:00Z' },
      { from: 'Аня', text: 'делаю вручную в таблице', at: '2026-09-20T10:01:00Z' },
      { from: 'Борис', text: 'у меня та же проблема', at: '2026-09-20T11:00:00Z' },
    ];
    const r1 = await handler({ messages, out_dir: dir, source: 'chat:test' });
    expect(r1.ok).toBe(true);
    expect(r1.added).toBe(3);
    expect(r1.total).toBe(3);

    const store = read('cd/messages.json');
    expect(store.messages).toHaveLength(3);
    expect(store.messages[0].from).toBe('Аня');
    // whitespace collapsed
    expect(store.messages[0].text).not.toMatch(/\s{2,}/);
    // stable id present
    expect(store.messages[0].id).toMatch(/^[0-9a-f]{12}$/);
    // sorted by ts
    expect(store.messages[0].ts).toBeLessThanOrEqual(store.messages[2].ts);

    // repeat: same 3 + 1 new → only the new one is added
    const r2 = await handler({
      messages: [...messages, { from: 'Борис', text: 'совсем невозможно', at: '2026-09-21T09:00:00Z' }],
      out_dir: dir, source: 'chat:test',
    });
    expect(r2.added).toBe(1);
    expect(r2.skipped_duplicates).toBe(3);
    expect(r2.total).toBe(4);

    const authorsRaw = read('cd/authors.raw.json');
    const names = authorsRaw.authors.map((a) => a.name);
    expect(names).toContain('Аня');
    expect(names).toContain('Борис');
    expect(authorsRaw.authors.find((a) => a.name === 'Аня').count).toBe(2);
  });

  it('ingests "Author: text" lines from a dump file', async () => {
    const dump = path.join(dir, 'dump.txt');
    fs.writeFileSync(dump, ['Аня: хочу чтобы было проще', 'Борис: мне норм', '# комментарий игнорируем'].join('\n'));
    const r = await handler({ path: dump, out_dir: dir, source: 'dump' });
    expect(r.ok).toBe(true);
    expect(r.total).toBe(2);
    const store = read('cd/messages.json');
    expect(store.messages.find((m) => m.from === 'Аня').text).toBe('хочу чтобы было проще');
  });

  it('returns an explicit error when nothing is provided', async () => {
    const r = await handler({ out_dir: dir });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ни одного сообщения/i);
  });
});
