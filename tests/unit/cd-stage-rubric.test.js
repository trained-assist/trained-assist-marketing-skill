import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rubric = require('../../src/mcp-skills/tools/11-cd-stage-rubric.js');
const handler = rubric.tools.cd_stage_rubric.handler;

describe('cd_stage_rubric', () => {
  it('returns the whole rubric without a stage', async () => {
    const r = await handler({});
    expect(r.ok).toBe(true);
    expect(r.stages.map((s) => s.id)).toEqual(['alpha', 'closed-beta', 'product', 'rollout']);
    expect(r.needs_unit_fields).toContain('frequency');
  });

  it('returns one stage with questions and signals', async () => {
    const r = await handler({ stage: 'closed-beta' });
    expect(r.ok).toBe(true);
    expect(r.stage.id).toBe('closed-beta');
    expect(r.stage.questions.length).toBeGreaterThan(0);
    expect(r.stage.signals.length).toBeGreaterThan(0);
  });

  it('errors with the available stages on an unknown stage', async () => {
    const r = await handler({ stage: 'pre-seed' });
    expect(r.ok).toBe(false);
    expect(r.available_stages).toContain('alpha');
  });
});
