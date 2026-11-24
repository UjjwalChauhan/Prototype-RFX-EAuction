/**
 * The agent on the wizard's Questionnaire step.
 *
 * It opens by saying what it can see in the basket and the shortlist, asks the
 * buyer questions one at a time — the first being the most questions they want
 * — and ends with a spreadsheet in the upload format. Nothing is written to the
 * event until the buyer presses "Load into questionnaire", and that goes
 * through the same importer the Upload button uses.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Button, Checkbox, Chip, TextInput } from '../design-system/components/primitives';
import { Drawer, ValidationBanner } from '../design-system/components/domain';
import { AGENT_CATALOGUE } from '../domain/agents';
import { QUESTIONNAIRE_AGENT } from '../domain/questionnaireAgent';
import {
  answerDesignProbe, canDesign, clampMax, designQuestionnaire, emptyDesignBrief,
  nextDesignProbe, planFileName, planRows, readEvent,
  type DesignBrief, type DesignPlan, type DesignProbe, type EventSight,
} from '../domain/questionnaireDesigner';
import { importCsv, importQuestionnaire, importWorkbook } from '../domain/questionnaireImport';
import type { QuestionnaireTemplate } from '../domain/types';
import { XLSX_MIME, download } from './QuestionnaireImport';

interface Turn { id: string; who: 'AGENT' | 'BUYER'; text: string }

export function QuestionnaireDesignerDrawer({
  open, sight, template, library, onClose, onApply,
}: {
  open: boolean;
  sight: EventSight;
  /** The event's current questionnaire, which the file is loaded against. */
  template: QuestionnaireTemplate;
  library: QuestionnaireTemplate[];
  onClose: () => void;
  onApply: (next: QuestionnaireTemplate) => void;
}) {
  const agent = AGENT_CATALOGUE[QUESTIONNAIRE_AGENT];
  const reading = React.useMemo(() => readEvent(sight), [sight]);

  const [brief, setBrief] = React.useState<DesignBrief>(() => emptyDesignBrief(sight));
  const [answered, setAnswered] = React.useState<string[]>([]);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [typed, setTyped] = React.useState('');
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [plan, setPlan] = React.useState<DesignPlan | null>(null);
  const [mode, setMode] = React.useState<'replace' | 'append'>('replace');
  const [failure, setFailure] = React.useState<string | null>(null);

  const probe = plan === null ? nextDesignProbe(reading, answered) : null;
  const say = (who: Turn['who'], text: string) =>
    setTurns((all) => [...all, { id: `t${all.length}`, who, text }]);

  const submit = (current: DesignProbe) => {
    const free = current.choices.length === 0 || current.id === 'max' && typed.trim() !== '';
    const value = free ? [typed] : picked;
    const spoken = current.id === 'max'
      ? `${clampMax(Number(value[0])) || '—'} questions at most`
      : free
        ? (typed.trim() === '' ? 'Nothing in particular.' : typed)
        : picked.length === 0
          ? 'Skip this one.'
          : picked.map((id) => current.choices.find((c) => c.id === id)?.label ?? id).join(', ');
    say('AGENT', current.question);
    say('BUYER', spoken);
    setBrief((b) => answerDesignProbe(b, current.id, value));
    setAnswered((all) => [...all, current.id]);
    setPicked([]);
    setTyped('');
  };

  const draft = () => {
    const made = designQuestionnaire({ brief, reading, library });
    say('AGENT', made.questions.length === 0
      ? 'I could not find anything to ask for that brief.'
      : `${made.summary} The file is ready — open it in Excel to edit, or load it straight in.`);
    setPlan(made);
    setFailure(null);
  };

  const restart = () => {
    setBrief(emptyDesignBrief(sight));
    setAnswered([]); setPicked([]); setTyped(''); setTurns([]); setPlan(null); setFailure(null);
  };

  const rows = React.useMemo(() => (plan ? planRows(plan) : []), [plan]);

  const load = () => {
    const result = importQuestionnaire(
      [{ name: 'Questions', rows }],
      { template, mode, fileName: planFileName(sight, 'xlsx') },
    );
    if (!result.ok) {
      setFailure(result.issues.find((i) => i.severity === 'error')?.message ?? 'The file could not be read.');
      return;
    }
    onApply(result.next);
    onClose();
  };

  const hasContent = template.questions.length > 0;
  const maxProbe = probe?.id === 'max';

  return (
    <Drawer
      open={open}
      title={`${agent.name} — ${agent.code}`}
      subtitle="Reads your items and suppliers, asks what it needs, and builds the questionnaire as an Excel / CSV file."
      onClose={onClose}
      width={680}
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <div
          style={{
            border: `1px solid ${color.border}`, borderRadius: radius.card,
            background: color.rowAlt, padding: '11px 13px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            What I can see on this event
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.65, color: color.textBody }}>
            {reading.observations.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>

        {turns.length > 0 && (
          <div className="rfx-stack" style={{ gap: 8 }}>
            {turns.map((turn) => (
              <div
                key={turn.id}
                style={{
                  alignSelf: turn.who === 'BUYER' ? 'flex-end' : 'flex-start', maxWidth: '86%',
                  background: turn.who === 'BUYER' ? color.brandPrimarySoft : '#fff',
                  border: `1px solid ${turn.who === 'BUYER' ? color.brandPrimaryTint : color.border}`,
                  borderRadius: radius.card, padding: '9px 12px', fontSize: 12.5, lineHeight: 1.6,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: color.textMuted, marginBottom: 3 }}>
                  {turn.who === 'BUYER' ? 'You' : agent.code}
                </div>
                {turn.text}
              </div>
            ))}
          </div>
        )}

        {probe !== null && (
          <div
            style={{
              border: `1px solid ${color.brandPrimaryTint}`, borderRadius: radius.card,
              padding: '13px 15px', background: '#fff',
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{probe.question}</div>
            <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 5, lineHeight: 1.6 }}>
              {probe.because}
            </div>
            <div className="rfx-stack" style={{ gap: 6, marginTop: 11 }}>
              {probe.choices.map((choice) => (
                <Checkbox
                  key={choice.id}
                  checked={picked.includes(choice.id)}
                  label={choice.blurb ? `${choice.label} — ${choice.blurb}` : choice.label}
                  onChange={(on) => {
                    if (maxProbe) setTyped('');
                    setPicked((cur) => {
                      if (!probe.multi) return on ? [choice.id] : [];
                      return on ? [...cur, choice.id] : cur.filter((id) => id !== choice.id);
                    });
                  }}
                />
              ))}
              {(probe.choices.length === 0 || probe.allowNumber) && (
                <TextInput
                  value={typed}
                  aria-label={probe.question}
                  inputMode={probe.allowNumber ? 'numeric' : undefined}
                  placeholder={probe.allowNumber ? 'Or type your own number, e.g. 12' : 'Anything particular to this buy…'}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    if (probe.allowNumber) setPicked([]);
                  }}
                />
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button
                variant="primary" size="small"
                disabled={!probe.optional && picked.length === 0
                  && !(maxProbe && clampMax(Number(typed)) > 0)}
                onClick={() => submit(probe)}
              >
                {probe.choices.length === 0 ? 'Send' : 'Answer'}
              </Button>
              {probe.optional && (
                <Button variant="tertiary" size="small" onClick={() => { setPicked([]); setTyped(''); submit(probe); }}>
                  Skip
                </Button>
              )}
              {canDesign(brief) && (
                <Button variant="secondary" size="small" onClick={draft}>
                  That is enough — build it
                </Button>
              )}
            </div>
          </div>
        )}

        {probe === null && plan === null && (
          <Button variant="primary" onClick={draft} disabled={!canDesign(brief)}>
            Build the questionnaire file
          </Button>
        )}

        {plan !== null && plan.questions.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13 }}>
                {plan.questions.length} of at most {plan.maxQuestions}
              </strong>
              {plan.cut.length > 0 && <Chip tone="gold">{plan.cut.length} left out</Chip>}
              <span style={{ flex: 1 }} />
              <Button variant="tertiary" size="small" onClick={restart}>Start over</Button>
            </div>

            <div className="rfx-stack" style={{ gap: 8 }}>
              {plan.questions.map((q, index) => (
                <div
                  key={q.code}
                  style={{
                    border: `1px solid ${color.border}`, borderRadius: radius.card,
                    padding: '10px 13px', background: '#fff',
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{index + 1}. {q.title}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    <Chip tone="neutral">{q.section}</Chip>
                    <Chip tone="neutral">{q.perLine ? 'per item' : 'per supplier'}</Chip>
                    <Chip tone="neutral">{q.type.replace(/_/g, ' ')}</Chip>
                    <Chip tone="neutral">weight {q.weight}</Chip>
                    {q.isKnockout && <Chip tone="danger" icon="✕">knockout</Chip>}
                  </div>
                  <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 6, lineHeight: 1.55 }}>
                    {q.reason}
                  </div>
                </div>
              ))}
            </div>

            {failure !== null && (
              <ValidationBanner tone="error" title="Could not load the file">{failure}</ValidationBanner>
            )}

            <div
              style={{
                borderTop: `1px solid ${color.border}`, paddingTop: 12,
                display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
              }}
            >
              <Button
                variant="secondary"
                onClick={() => download(planFileName(sight, 'xlsx'), importWorkbook(rows) as BlobPart, XLSX_MIME)}
              >
                ⬇ Download Excel
              </Button>
              <Button
                variant="secondary"
                onClick={() => download(planFileName(sight, 'csv'), importCsv(rows), 'text/csv;charset=utf-8')}
              >
                ⬇ Download CSV
              </Button>
              <span style={{ flex: 1 }} />
              {hasContent && (
                <Checkbox
                  checked={mode === 'append'}
                  label="Add to existing questions instead of replacing"
                  onChange={(on) => setMode(on ? 'append' : 'replace')}
                />
              )}
              <Button variant="primary" onClick={load}>Load into questionnaire</Button>
            </div>
            <div style={{ fontSize: 11, color: color.textSecondary, lineHeight: 1.55 }}>
              The file is the same format as ⬆ Upload Excel / CSV. Edit it in Excel and upload it
              back, or load it as it is — you can still change every question afterwards.
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
