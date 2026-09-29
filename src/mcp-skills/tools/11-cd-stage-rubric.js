'use strict';

// cd_stage_rubric — стадийная рамка Customer Development (данные репо, не хардкод в коде).
// Одна стадия → свои вопросы, сигналы и измеримые критерии. Агент берёт нужную стадию
// (или все) и дальше извлекает ответы/агрегирует. Read-only, без сети.

const path = require('path');

function loadRubric() {
  const file = path.join(__dirname, '..', '..', 'cd', 'stage-rubric.json');
  return JSON.parse(require('fs').readFileSync(file, 'utf8'));
}

const handler = async ({ stage } = {}) => {
  const rubric = loadRubric();
  if (stage) {
    const key = String(stage).trim().toLowerCase();
    const found = (rubric.stages || []).find((s) => s.id === key || String(s.title).toLowerCase().includes(key));
    if (!found) {
      return {
        ok: false,
        error: `Стадия «${stage}» не найдена.`,
        available_stages: (rubric.stages || []).map((s) => s.id),
      };
    }
    return { ok: true, version: rubric.version, stage: found, frameworks: rubric.frameworks, needs_unit_fields: rubric.needs_unit_fields };
  }
  return { ok: true, version: rubric.version, ...rubric };
};

module.exports = {
  tools: {
    cd_stage_rubric: {
      description:
        'Customer Development: стадийная рамка — для стадии (alpha | closed-beta | product | rollout) ' +
        'вернуть фокус, набор вопросов к материалам, сигналы и измеримые критерии; без stage — всю рамку ' +
        'плюс список фреймворков, поля «единицы потребности» и типичные ошибки. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          stage: { type: 'string', description: 'alpha | closed-beta | product | rollout. Пусто — вся рамка.' },
        },
      },
      handler,
    },
  },
};
