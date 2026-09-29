'use strict';
// Empty tool result guard test (node:test) — mirrors the sales/hh skill contract.
const { test } = require('node:test');
const assert = require('node:assert');
const { isEmptyToolResult, toolResultText } = require('../src/mcp-skills/tool-result.js');

test('empty results are reported as an explicit notice, never blank', () => {
  for (const v of [undefined, null, '', '   ', [], {}]) {
    assert.equal(isEmptyToolResult(v), true);
    const text = toolResultText('cd_ingest', v);
    assert.ok(text.trim().length > 0, 'never blank');
    assert.ok(text.includes('cd_ingest'), 'names the tool');
  }
});

test('non-empty results pass through', () => {
  assert.equal(isEmptyToolResult({ ok: 1 }), false);
  assert.match(toolResultText('cd_ingest', { ok: 1 }), /"ok": 1/);
});
