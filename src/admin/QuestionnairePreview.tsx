/**
 * The questionnaire as a supplier will meet it.
 *
 * A buyer writes a form in a screen full of weights, rubrics and knockout
 * flags, and then publishes something that contains none of those. The gap
 * between the two is where unanswerable questions come from: a help text that
 * only makes sense beside a rubric, an "other (please specify)" with nothing
 * to specify in, a per-line block nobody realised would be asked eleven times.
 *
 * So this is the supplier's own renderer, not a drawing of it. Everything a
 * supplier must not see is absent because it was never passed in, which is a
 * stronger guarantee than filtering it out would be.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Chip } from '../design-system/components/primitives';
import { SupplierQuestionnaire } from '../portal/SupplierForm';
import { supplierGroups } from '../domain/vendorPortal';
import { effectiveScope, pointLabel } from '../domain/questionnaireTemplates';
import type {
  LineItem, Question, TemplateQuestion, TemplateSection, VendorInputPoint,
} from '../domain/types';

/**
 * Two lines to expand the per-line blocks against, where the screen has no
 * real basket to hand. Named as examples on the page, so nobody mistakes
 * them for the event's own items.
 */
const EXAMPLE_LINES: LineItem[] = [
  {
    id: 'preview-line-1', lotId: 'preview', lineNumber: 1, itemCode: 'ITEM-001',
    description: 'First item in the basket', specification: '', quantity: 100, uom: 'each',
    deliveryLocation: '', deliveryDate: null, incoterm: null, taxClass: null,
    baselinePrice: null, baselineSource: null, currency: 'INR', isOptional: false,
    allowAlternate: false, category: '', superCategory: null, sourcePrLineId: null,
  },
  {
    id: 'preview-line-2', lotId: 'preview', lineNumber: 2, itemCode: 'ITEM-002',
    description: 'Second item in the basket', specification: '', quantity: 40, uom: 'each',
    deliveryLocation: '', deliveryDate: null, incoterm: null, taxClass: null,
    baselinePrice: null, baselineSource: null, currency: 'INR', isOptional: false,
    allowAlternate: false, category: '', superCategory: null, sourcePrLineId: null,
  },
];

/**
 * A template question, as the event-level question it becomes.
 *
 * The scope is resolved here rather than carried: a question inherits the
 * grain of the section it sits in, and the preview has to show the grain that
 * will actually be published, not the one stored on the row.
 */
function asPublished(
  question: TemplateQuestion, sections: TemplateSection[],
): Question {
  return {
    ...question,
    questionnaireId: 'preview',
    askedPer: effectiveScope(question, sections),
  };
}

export function QuestionnairePreview({
  name, point, sections, questions, lines,
}: {
  name: string;
  /** Where in the journey this goes out, when the screen knows. */
  point?: VendorInputPoint | null;
  sections: TemplateSection[];
  questions: TemplateQuestion[];
  /** The event's own basket. Omitted in the library, which has no event. */
  lines?: LineItem[];
}) {
  const basket = lines && lines.length > 0 ? lines : EXAMPLE_LINES;
  const illustrative = !(lines && lines.length > 0);

  const groups = React.useMemo(
    () => supplierGroups(questions.map((q) => asPublished(q, sections)), sections, basket),
    [questions, sections, basket],
  );
  const perLine = groups.filter((g) => g.askedPer === 'LINE');
  const total = groups.reduce((sum, g) => sum + g.cells.length, 0);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          border: `1px solid ${color.border}`, background: color.surfacePage,
          borderRadius: radius.control, padding: '9px 12px', fontSize: 12,
        }}
      >
        <strong>This is the supplier's screen.</strong>
        <span style={{ color: color.textSecondary }}>
          Weights, rubrics and knockout flags are not on it — they never leave the buyer side.
        </span>
        <span style={{ flex: 1 }} />
        <Chip tone="neutral">{total} {total === 1 ? 'box' : 'boxes'} to fill in</Chip>
        {perLine.length > 0 && (
          <Chip tone="brand" title={perLine.map((g) => g.name).filter(Boolean).join(' · ')}>
            {perLine.length} per-item {perLine.length === 1 ? 'section' : 'sections'}
          </Chip>
        )}
      </div>

      {illustrative && perLine.length > 0 && (
        <div style={{ fontSize: 11.5, color: color.warningText, lineHeight: 1.6 }}>
          The per-item blocks are expanded against two example lines. On a real event they repeat
          once for every line in the basket, so a six-line basket asks each of those questions six
          times.
        </div>
      )}

      {/* The supplier's own renderer, made inert: a preview that accepted
          typing would look like a draft somebody could lose. */}
      <div
        aria-label="Questionnaire preview"
        style={{
          border: `1px solid ${color.border}`, borderRadius: radius.card,
          background: color.surfacePage, padding: 18,
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{name || 'Untitled questionnaire'}</div>
          <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 3 }}>
            {point ? `${pointLabel(point)} · ` : ''}
            Everything marked with an asterisk has to be answered before this can be submitted.
          </div>
        </div>
        {total === 0 ? (
          <div style={{ fontSize: 12.5, color: color.textMuted }}>
            Nothing is being asked yet, so a supplier would open this and find an empty form.
          </div>
        ) : (
          <div style={{ pointerEvents: 'none' }} aria-disabled>
            <SupplierQuestionnaire
              groups={groups}
              draft={{}}
              readOnly={false}
              onValue={() => {}}
              onAttachment={() => {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}
