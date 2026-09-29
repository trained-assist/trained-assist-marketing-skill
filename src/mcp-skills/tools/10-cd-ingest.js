'use strict';

// cd_ingest — нормализация и накопление сырых материалов Customer Development.
//
// Задача шага: превратить разношёрстные куски (сообщения из чата, дампы, файлы)
// в один durable-файл `cd/messages.json` со стабильными id и дедупликацией, чтобы
// повторный прогон ДОБАВЛЯЛ к накопленному, а не терял и не дублировал.
//
// Механическое и детерминированное — модель тут не нужна: парсинг, нормализация
// текста/автора/времени, дедуп. Семантику (identity resolution авторов, извлечение
// потребностей) делает агент на следующих шагах.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const normText = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
const normAuthor = (a) => normText(a) || 'неизвестный';

function sha12(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}

// Время → ms epoch. Принимает unix-секунды, ms, ISO-строку или Date.parse-able.
function parseTs(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
}

// Текст сообщения из Telegram-подобных форматов (строка | массив частей).
function textOf(raw) {
  const t = raw.text != null ? raw.text : raw.message;
  if (Array.isArray(t)) {
    return t.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('');
  }
  return normText(t);
}

function toMessage(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const text = textOf(raw);
  if (!text) return null;
  const from = normAuthor(raw.from != null ? raw.from : (raw.author != null ? raw.author : raw.user));
  const ts = parseTs(raw.at != null ? raw.at : (raw.date != null ? raw.date : (raw.time != null ? raw.time : raw.timestamp)));
  const src = normText(raw.source) || source || 'unknown';
  const id = sha12(`${src}|${ts == null ? '?' : ts}|${from}|${text}`);
  return { id, ts, from, text, source: src };
}

// Разбор строкового файла: каждая непустая строка — сообщение. Если строка вида
// "Автор: текст" — автор берётся оттуда, иначе defaultAuthor.
const LINE_RE = /^([^:\n]{1,60}):\s+(.+)$/;
function fromTextLines(content, source, defaultAuthor) {
  const out = [];
  for (const line of String(content).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const m = s.match(LINE_RE);
    if (m) out.push(toMessage({ from: m[1], text: m[2], source }, source));
    else out.push(toMessage({ from: defaultAuthor, text: s, source }, source));
  }
  return out.filter(Boolean);
}

function fromJsonContent(raw, source, defaultAuthor) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return fromTextLines(raw, source, defaultAuthor); }
  }
  const list = Array.isArray(data) ? data
    : Array.isArray(data && data.messages) ? data.messages
      : Array.isArray(data && data.entries) ? data.entries
        : null;
  if (!list) return [];
  return list.map((m) => toMessage({ ...m, source: (m && m.source) || source }, source)).filter(Boolean);
}

function collectFromInput(arg, source, defaultAuthor) {
  const out = [];
  const abs = path.resolve(arg);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  const files = st.isDirectory()
    ? fs.readdirSync(abs).filter((f) => /\.(json|txt|md)$/i.test(f)).sort().map((f) => path.join(abs, f))
    : [abs];
  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const src = source || path.basename(f);
    if (/\.json$/i.test(f)) out.push(...fromJsonContent(content, src, defaultAuthor));
    else out.push(...fromTextLines(content, src, defaultAuthor));
  }
  return out;
}

function readStore(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data && data.messages) ? data.messages : [];
  } catch { return []; }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o644 });
  fs.renameSync(tmp, file);
}

function summarizeAuthors(messages) {
  const map = new Map();
  for (const m of messages) {
    let a = map.get(m.from);
    if (!a) { a = { name: m.from, count: 0, first_seen: null, last_seen: null, sample: [] }; map.set(m.from, a); }
    a.count += 1;
    if (m.ts != null) { if (a.first_seen == null || m.ts < a.first_seen) a.first_seen = m.ts; if (a.last_seen == null || m.ts > a.last_seen) a.last_seen = m.ts; }
    if (a.sample.length < 3 && m.text) a.sample.push(m.text.slice(0, 160));
  }
  return [...map.values()].sort((x, y) => y.count - x.count);
}

function iso(ms) { return ms == null ? null : new Date(ms).toISOString(); }

const handler = async ({ messages, path: inputPath, out_dir, source, author } = {}) => {
  const outDir = path.resolve(out_dir || process.cwd());
  const cdDir = path.join(outDir, 'cd');
  const msgFile = path.join(cdDir, 'messages.json');
  const authorsFile = path.join(cdDir, 'authors.raw.json');

  const incoming = [];
  if (Array.isArray(messages)) {
    for (const m of messages) {
      const norm = toMessage({ ...m, source: (m && m.source) || source }, source);
      if (norm) incoming.push(norm);
    }
  }
  const paths = Array.isArray(inputPath) ? inputPath : (inputPath ? [inputPath] : []);
  for (const p of paths) incoming.push(...collectFromInput(p, source, author));

  const existing = readStore(msgFile);
  const seen = new Set(existing.map((m) => m.id));
  const fresh = [];
  for (const m of incoming) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    fresh.push(m);
  }

  const all = [...existing, ...fresh].sort((a, b) => {
    if (a.ts == null && b.ts == null) return 0;
    if (a.ts == null) return 1;
    if (b.ts == null) return -1;
    return a.ts - b.ts;
  });

  const store = {
    version: 1,
    updatedAt: new Date().toISOString(),
    count: all.length,
    messages: all,
  };
  writeJson(msgFile, store);

  const authors = summarizeAuthors(all);
  const authorsRaw = {
    version: 1,
    updatedAt: store.updatedAt,
    note: 'Сырой список имён авторов (как в источнике). Канонизацию/сшивание делает агент → cd/authors.json.',
    authors,
  };
  writeJson(authorsFile, authorsRaw);

  if (!incoming.length && !existing.length) {
    return {
      ok: false,
      error: 'Не передано ни одного сообщения: передай messages[] (например из get_group_history) или path к файлу/папке с дампом.',
      file: msgFile,
    };
  }

  return {
    ok: true,
    file: path.relative(outDir, msgFile) || 'cd/messages.json',
    authors_file: path.relative(outDir, authorsFile) || 'cd/authors.raw.json',
    added: fresh.length,
    skipped_duplicates: incoming.length - fresh.length,
    total: all.length,
    authors: authors.length,
    window: { first: iso(all[0] && all[0].ts), last: iso(all.length ? all[all.length - 1].ts : null) },
    next: 'Следующий шаг — identity resolution: прочитать cd/authors.raw.json + cd/messages.json и записать cd/authors.json (canonical + confidence, без молчаливого слияния).',
  };
};

module.exports = {
  tools: {
    cd_ingest: {
      description:
        'Customer Development: нормализовать и НАКОПИТЬ сырые материалы в cd/messages.json ' +
        '(+ cd/authors.raw.json). Принимает messages[] (например из get_group_history) и/или ' +
        'path к файлу/папке с дампом (.json/.txt/.md). Детерминированно: нормализует текст, ' +
        'автора и время, дедуплицирует по стабильному id, повторный вызов добавляет новое и не дублирует. ' +
        'Семантику (сшивание авторов, потребности) делает агент на следующих шагах.',
      inputSchema: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            description: 'Сырые сообщения: [{from, text, at?, source?}]. Поддерживаются поля from/author/user, text/message, at/date/time/timestamp.',
            items: { type: 'object' },
          },
          path: {
            description: 'Файл или папка (.json/.txt/.md) с дампом материалов. Можно массив путей.',
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          },
          out_dir: { type: 'string', description: 'Корень проекта (по умолчанию — текущая рабочая директория). Пишет в <out_dir>/cd/.' },
          source: { type: 'string', description: 'Метка источника (например chat:<id>, telegram-export, call).' },
          author: { type: 'string', description: 'Автор по умолчанию для строк без явного «Имя:».' },
        },
      },
      handler,
    },
  },
};
