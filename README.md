# trained-assist-marketing-skill

**GCP VM exit (05.10.2026):** New work on `alesa-personal-assistent/us-central1-a/alesa-vm` is prohibited. Use serverless by default; the existing French VM only for a proven persistent or local requirement. Other Google services remain allowed. See [the exit plan](https://github.com/trained-assist/trained-agent-architecture/issues/145).


Marketing domain skill of [trained-assist-agent](https://github.com/trained-assist/trained-assist-agent).
Mounted by core as the `marketing-skills` MCP sibling: core's `scripts/deploy.sh` checks it
out next to the release, `src/skill-siblings.js` wires it into each session's `.mcp.json`,
and core reads `src/prompt-domains/*.md` for the prompt rules. Playbooks under `playbooks/`
are resolved as sibling (system-scope) playbooks.

First process: **Customer Development** — сырые материалы клиентского чата (заметки со
звонков, переписка, опросы) → агрегированная карта потребностей, с разными вопросами/
сигналами на разных стадиях (alpha → closed beta → product → rollout).

## Contents
- `src/mcp-skills/tools/10-cd-ingest.js` — `cd_ingest`: детерминированная нормализация и
  накопление материалов в `cd/messages.json` (+ `cd/authors.raw.json`).
- `src/mcp-skills/tools/11-cd-stage-rubric.js` — `cd_stage_rubric`: стадийная рамка
  (вопросы/сигналы/метрики) из `src/cd/stage-rubric.json`.
- `src/prompt-domains/customer-development.md` — правила процесса для промпта.
- `playbooks/customer-development-collect.json` — плейбук v1: материалы → авторы → стадия
  → сигналы → потребности → отчёт.

## Develop
```bash
npm run check   # every tool module loads
npm test        # offline unit tests
```

## Claude Code Instructions
- One copy of the domain code lives here; core must not keep copies.
- Tool files export `{ tools, isReady?, setupTools? }`; keep tool names stable (core prompts
  refer to them).
- Every outbound HTTP call needs a timeout.
