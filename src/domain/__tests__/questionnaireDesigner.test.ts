import { describe, expect, it } from 'vitest';
import {
  answerDesignProbe, designQuestionnaire, emptyDesignBrief, planRows, readEvent,
  type EventSight,
} from '../questionnaireDesigner';
import { importQuestionnaire } from '../questionnaireImport';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import { COUNTERPARTIES } from '../../data/seed';

const sight: EventSight = {
  point: 'RFI', category: 'Facilities & MRO', categories: ['Facilities & MRO'],
  lines: Array.from({ length: 6 }, (_, i) => ({
    id: `l${i}`, description: `Item ${i}`, specification: i % 2 ? 'Grade A' : '',
    quantity: 100, uom: 'ea', category: 'Facilities & MRO',
  })),
  suppliers: COUNTERPARTIES.slice(0, 3),
};
const template = TENANT_TEMPLATES[0];

function planFor(max: number) {
  const reading = readEvent(sight);
  let brief = emptyDesignBrief(sight);
  brief = answerDesignProbe(brief, 'max', [String(max)]);
  brief = answerDesignProbe(brief, 'concerns', ['QUALITY', 'RISK', 'COMPLIANCE', 'CAPABILITY']);
  brief = answerDesignProbe(brief, 'perItem', ['YES']);
  brief = answerDesignProbe(brief, 'newSuppliers', ['YES']);
  return designQuestionnaire({ brief, reading, library: TENANT_TEMPLATES });
}

describe('questionnaire designer', () => {
  it('never exceeds the buyer ceiling', () => {
    for (const max of [3, 5, 8, 15]) {
      expect(planFor(max).questions.length).toBeLessThanOrEqual(max);
    }
    expect(planFor(8).questions.length).toBeGreaterThan(0);
  });

  it('produces rows the upload importer accepts with no errors', () => {
    const plan = planFor(10);
    const result = importQuestionnaire(
      [{ name: 'Questions', rows: planRows(plan) }],
      { template, mode: 'replace', fileName: 'x.xlsx' },
    );
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.questionsRead).toBe(plan.questions.length);
  });

  it('does not draft without a ceiling', () => {
    const brief = answerDesignProbe(emptyDesignBrief(sight), 'concerns', ['RISK']);
    expect(designQuestionnaire({ brief, reading: readEvent(sight), library: [] }).questions).toEqual([]);
  });
});
