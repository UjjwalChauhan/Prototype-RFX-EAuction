/**
 * The supplier's form.
 *
 * Lifted out of the portal screen because the buyer needs to see it too: the
 * Questionnaire Library has a preview that shows a template exactly as a
 * supplier will meet it, and a preview drawn by a second renderer is a
 * preview of something that does not exist. One component, two callers, so
 * the promise the preview makes is the thing that ships.
 *
 * Nothing here reads the store or the portal theme — it takes questions and a
 * draft and renders controls. What a supplier must never see is absent by
 * construction rather than by filtering: no weight, no rubric, no knockout
 * flag reaches this file.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Button } from '../design-system/components/primitives';
import { optionsOf } from '../domain/questionTypes';
import type { Answer, Question, QuestionOption } from '../domain/types';
import type { AnswerDraft, AskedCell, SupplierGroup } from '../domain/vendorPortal';

export function PerLineAnswers({
  index, question, cells, draft, readOnly, missingKeys, onValue, onAttachment,
}: {
  index: number;
  question: Question;
  cells: AskedCell[];
  draft: AnswerDraft;
  readOnly: boolean;
  missingKeys: string[];
  onValue: (key: string, value: Answer['value']) => void;
  onAttachment: (key: string, name: string | null) => void;
}) {
  const answered = cells.filter((cell) => draft[cell.key] !== undefined
    && draft[cell.key].value !== null && draft[cell.key].value !== '').length;
  return (
    // The same number column as an ordinary question, so a form holding both
    // kinds still reads as one numbered list rather than two.
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontSize: 13, color: color.textMuted, minWidth: 18 }}>{index}.</span>
      <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{question.title}</span>
        {question.isRequired && <span style={{ color: color.dangerText, fontSize: 15 }}>*</span>}
        <span
          style={{
            fontSize: 11.5, fontWeight: 600, color: color.brandPrimary,
            background: color.brandPrimarySoft, borderRadius: radius.pill, padding: '1px 8px',
          }}
        >
          per item
        </span>
      </div>
      {question.helpText && (
        <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 3 }}>{question.helpText}</div>
      )}
      <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 3 }}>
        Answer this for each of the {cells.length} items below — {answered} of {cells.length} done.
      </div>
      <div className="rfx-stack" style={{ gap: 12, marginTop: 12 }}>
        {cells.map((cell) => (
          <div
            key={cell.key}
            style={{
              borderLeft: `2px solid ${missingKeys.includes(cell.key) ? color.danger : color.border}`,
              paddingLeft: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>{cell.lineLabel}</div>
            <AnswerField
              bare
              index={0}
              question={question}
              entry={draft[cell.key]}
              readOnly={readOnly}
              flagged={missingKeys.includes(cell.key)}
              onValue={(value) => onValue(cell.key, value)}
              onAttachment={(name) => onAttachment(cell.key, name)}
            />
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

/**
 * One question, with the control its type calls for.
 *
 * Read-only once the ask is closed rather than hidden: a supplier should be
 * able to see what they sent, which is half of why the Past pile exists.
 */
export function AnswerField({
  index, question, entry, readOnly, flagged, bare, onValue, onAttachment,
}: {
  index: number;
  question: Question;
  entry: AnswerDraft[string] | undefined;
  readOnly: boolean;
  flagged: boolean;
  /** Inside a per-line block, where the number, title and help are already up. */
  bare?: boolean;
  onValue: (value: Answer['value']) => void;
  onAttachment: (name: string | null) => void;
}) {
  const value = entry?.value ?? null;
  // An event-level question carries its answer format optionally — a question
  // copied from a template that never needed one simply has no options.
  const options = optionsOf({ type: question.type, config: question.config ?? {} });
  const inputStyle: React.CSSProperties = {
    width: '100%', maxWidth: 520, border: `1px solid ${flagged ? color.danger : color.border}`,
    borderRadius: radius.control, padding: '9px 11px', fontSize: 14.5,
    background: readOnly ? color.neutralSoft : '#fff', color: color.textPrimary,
  };

  const control = () => {
    if (readOnly) {
      return (
        <div style={{ fontSize: 14.5, fontWeight: 500 }}>
          {formatAnswer(value, options) || <em style={{ color: color.textMuted }}>not answered</em>}
        </div>
      );
    }

    switch (question.type) {
      case 'long_text':
      case 'compliance_statement':
        return (
          <textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onValue(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        );

      case 'number':
      case 'capacity_declaration':
      case 'lead_time':
        return (
          <input
            type="number"
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onValue(e.target.value === '' ? null : Number(e.target.value))}
            style={{ ...inputStyle, maxWidth: 220 }}
          />
        );

      case 'date':
        return (
          <input
            type="date"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onValue(e.target.value)}
            style={{ ...inputStyle, maxWidth: 220 }}
          />
        );

      case 'yes_no':
        return (
          <div style={{ display: 'flex', gap: 8 }}>
            {[true, false].map((option) => (
              <button
                key={String(option)}
                type="button"
                onClick={() => onValue(option)}
                style={{
                  border: `1px solid ${value === option ? color.brandPrimary : color.border}`,
                  background: value === option ? color.brandPrimarySoft : '#fff',
                  color: value === option ? color.brandPrimary : color.textBody,
                  fontWeight: value === option ? 600 : 400,
                  borderRadius: radius.control, padding: '9px 22px',
                  fontSize: 14.5, cursor: 'pointer',
                }}
              >
                {option ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        );

      case 'multiple_choice': {
        const chosen = Array.isArray(value) ? value : [];
        return (
          <div className="rfx-stack" style={{ gap: 7 }}>
            {options.map((option) => (
              <label
                key={option.id}
                style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14.5, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(option.id)}
                  onChange={(e) =>
                    onValue(
                      e.target.checked
                        ? [...chosen, option.id]
                        : chosen.filter((id) => id !== option.id),
                    )
                  }
                  style={{ width: 16, height: 16, accentColor: color.brandPrimary }}
                />
                {option.label}
              </label>
            ))}
          </div>
        );
      }

      default:
        if (options.length > 0) {
          return (
            <select
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onValue(e.target.value || null)}
              style={{ ...inputStyle, maxWidth: 360 }}
            >
              <option value="">Select…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          );
        }
        return (
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onValue(e.target.value)}
            style={inputStyle}
          />
        );
    }
  };

  const wantsAttachment = question.allowAttachment
    || question.type === 'certificate'
    || question.type === 'file_upload';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        {!bare && (
          <span style={{ fontSize: 13, color: color.textMuted, minWidth: 18 }}>{index}.</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!bare && (
            <>
              <div style={{ fontSize: 15, fontWeight: 500 }}>
                {question.title}
                {question.isRequired && <span style={{ color: color.dangerText, marginLeft: 5 }}>*</span>}
              </div>
              {question.helpText && (
                <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 3 }}>
                  {question.helpText}
                </div>
              )}
            </>
          )}
          <div style={{ marginTop: bare ? 0 : 9 }}>{control()}</div>

          {wantsAttachment && (
            <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              {entry?.attachmentName ? (
                <>
                  <span style={{ fontSize: 13.5, color: color.brandPrimary }}>
                    📎 {entry.attachmentName}
                  </span>
                  {!readOnly && (
                    <Button variant="tertiary" size="small" onClick={() => onAttachment(null)}>
                      Remove
                    </Button>
                  )}
                </>
              ) : readOnly ? (
                <span style={{ fontSize: 13, color: color.textMuted }}>No document attached</span>
              ) : (
                <label style={{ fontSize: 13.5, color: color.brandPrimary, cursor: 'pointer' }}>
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    onChange={(e) => onAttachment(e.target.files?.[0]?.name ?? null)}
                  />
                  📎 Attach a document
                </label>
              )}
            </div>
          )}

          {flagged && (
            <div style={{ fontSize: 13, color: color.dangerText, marginTop: 6 }}>
              This one is required.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** An answer as a person reads it, rather than as it is stored. */
function formatAnswer(value: Answer['value'], options: QuestionOption[]): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value
      .map((id) => options.find((o) => o.id === id)?.label ?? String(id))
      .join(', ');
  }
  const option = options.find((o) => o.id === value);
  return option ? option.label : String(value);
}

export function PortalPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#fff', border: `1px solid ${color.border}`,
        borderRadius: radius.card, overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 18px', borderBottom: `1px solid ${color.border}`,
          fontSize: 15, fontWeight: 600,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </section>
  );
}

/**
 * A whole questionnaire as the supplier meets it.
 *
 * One component for two callers: the portal renders it live, and the buyer's
 * Questionnaire Library renders it as a preview. A preview drawn by a second
 * renderer is a preview of something that does not exist, so there is only
 * this one.
 *
 * Section names travel; section weights do not. Nothing a supplier must not
 * see is filtered out here — it simply never arrives.
 */
export function SupplierQuestionnaire({
  groups, draft, readOnly, missingKeys = [], startIndex = 0, onValue, onAttachment,
}: {
  groups: SupplierGroup[];
  draft: AnswerDraft;
  readOnly: boolean;
  missingKeys?: string[];
  /** Numbering runs across the whole submission, not per section. */
  startIndex?: number;
  onValue: (key: string, value: Answer['value']) => void;
  onAttachment: (key: string, name: string | null) => void;
}) {
  let index = startIndex;
  return (
    <div className="rfx-stack" style={{ gap: 22 }}>
      {groups.map((group) => (
        <div key={group.id}>
          {group.name && (
            <div
              style={{
                display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
                borderBottom: `1px solid ${color.border}`, paddingBottom: 6, marginBottom: 14,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{group.name}</span>
              {group.askedPer === 'LINE' && (
                <span
                  style={{
                    fontSize: 11.5, fontWeight: 600, color: color.brandPrimary,
                    background: color.brandPrimarySoft, borderRadius: radius.pill,
                    padding: '1px 8px',
                  }}
                >
                  asked for each item
                </span>
              )}
            </div>
          )}
          <div className="rfx-stack" style={{ gap: 20 }}>
            {group.questions.map((question) => {
              index += 1;
              const cells = group.cells.filter((cell) => cell.question.id === question.id);
              if (question.askedPer === 'LINE' && cells.length > 1) {
                return (
                  <PerLineAnswers
                    key={question.id}
                    index={index}
                    question={question}
                    cells={cells}
                    draft={draft}
                    readOnly={readOnly}
                    missingKeys={missingKeys}
                    onValue={onValue}
                    onAttachment={onAttachment}
                  />
                );
              }
              const cell = cells[0];
              if (!cell) return null;
              return (
                <AnswerField
                  key={cell.key}
                  index={index}
                  question={question}
                  entry={draft[cell.key]}
                  readOnly={readOnly}
                  flagged={missingKeys.includes(cell.key)}
                  onValue={(value) => onValue(cell.key, value)}
                  onAttachment={(name) => onAttachment(cell.key, name)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
