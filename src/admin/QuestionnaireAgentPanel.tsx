/**
 * Asking AG-03 for help writing a questionnaire.
 *
 * A conversation rather than a button, because the agent genuinely cannot do
 * this well without knowing what the buyer is trying to find out. A one-click
 * "suggest questions" returns the same thirty questions to every buyer in the
 * category, which is a list, not help.
 *
 * Three things the screen has to keep true, and they are the whole design:
 *
 * - **Every proposal is accepted or rejected individually.** There is no
 *   "accept all" that lets a buyer wave through a question they would not have
 *   written. AG-03's mandate is DRAFT and it cannot publish a questionnaire;
 *   the buyer's decision is what crosses that line, so it is taken one
 *   question at a time.
 * - **Every proposal says where it came from** — your own templates, this
 *   workspace, or market practice — and why. A suggestion a buyer cannot
 *   interrogate gets accepted blindly or rejected blindly, and both are worse
 *   than no suggestion.
 * - **Nothing is applied until the buyer applies it.** Accepting marks a
 *   decision; the template changes when they press the button, and they can
 *   change their mind until then.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Button, Checkbox, Chip, TextInput } from '../design-system/components/primitives';
import { Drawer, ValidationBanner } from '../design-system/components/domain';
import { AGENT_CATALOGUE } from '../domain/agents';
import {
  QUESTIONNAIRE_AGENT, answerProbe, applyAccepted, canDraft, codesIn, describeSources,
  emptyBrief, libraryHits, nextProbe, proposeQuestions, workspaceSignals,
  type AgentBrief, type AgentProposal, type Decision, type Probe, type ProposalSource,
} from '../domain/questionnaireAgent';
import { useStore } from '../store/store';
import type { QuestionnaireTemplate, VendorInputPoint } from '../domain/types';

const SOURCE_LABEL: Record<ProposalSource, string> = {
  LIBRARY: 'Your templates',
  WORKSPACE: 'This workspace',
  MARKET_PRACTICE: 'Market practice',
};

const SOURCE_TONE: Record<ProposalSource, 'brand' | 'gold' | 'neutral'> = {
  LIBRARY: 'brand',
  WORKSPACE: 'gold',
  MARKET_PRACTICE: 'neutral',
};

interface Turn {
  id: string;
  who: 'AGENT' | 'BUYER';
  text: string;
}

export function QuestionnaireAgentPanel({
  open, template, library, onClose, onApply,
}: {
  open: boolean;
  template: QuestionnaireTemplate;
  library: QuestionnaireTemplate[];
  onClose: () => void;
  onApply: (next: QuestionnaireTemplate) => void;
}) {
  const { state } = useStore();
  const agent = AGENT_CATALOGUE[QUESTIONNAIRE_AGENT];

  const point: VendorInputPoint = template.appliesTo[0] ?? 'RFI';
  const categories = template.categories;

  const [brief, setBrief] = React.useState<AgentBrief>(() => emptyBrief(categories, point));
  const [answered, setAnswered] = React.useState<string[]>([]);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [typed, setTyped] = React.useState('');
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [proposals, setProposals] = React.useState<AgentProposal[] | null>(null);
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});

  // The brief follows the template: changing the categories on the form and
  // then opening the agent must not interview against the old ones.
  React.useEffect(() => {
    setBrief((current) => ({ ...current, categories, point }));
  }, [categories.join('\u0000'), point]);

  const signals = React.useMemo(
    () => workspaceSignals({
      categories,
      events: state.events,
      questionnaires: state.questionnaires,
      responses: state.responses,
      scores: state.scores,
    }),
    [categories.join('\u0000'), state.events, state.questionnaires, state.responses, state.scores],
  );

  const hits = React.useMemo(
    () => libraryHits(library, categories, point),
    [library, categories.join('\u0000'), point],
  );

  const probe = proposals === null ? nextProbe(brief, answered) : null;

  const say = (who: Turn['who'], text: string) =>
    setTurns((all) => [...all, { id: `t${all.length}`, who, text }]);

  const submitProbe = (current: Probe) => {
    const value = current.choices.length === 0 ? [typed] : picked;
    const spoken = current.choices.length === 0
      ? (typed.trim() === '' ? 'Nothing in particular.' : typed)
      : picked.length === 0
        ? 'Skip this one.'
        : picked
          .map((id) => current.choices.find((choice) => choice.id === id)?.label ?? id)
          .join(', ');

    say('AGENT', current.question);
    say('BUYER', spoken);
    setBrief((b) => answerProbe(b, current.id, value));
    setAnswered((all) => [...all, current.id]);
    setPicked([]);
    setTyped('');
  };

  const draft = () => {
    const made = proposeQuestions({
      brief,
      library,
      signals,
      existingCodes: codesIn(template.questions),
    });
    say('AGENT', made.length === 0
      ? 'Nothing I would suggest for that brief that you are not already asking. That is a reasonable outcome, not a failure.'
      : `${made.length} questions to consider. ${describeSources(made)} Take them one at a time — I draft, you decide.`);
    setProposals(made);
    setDecisions(Object.fromEntries(made.map((proposal) => [proposal.id, 'PENDING' as Decision])));
  };

  const decide = (id: string, decision: Decision) =>
    setDecisions((all) => ({ ...all, [id]: all[id] === decision ? 'PENDING' : decision }));

  const accepted = (proposals ?? []).filter((p) => decisions[p.id] === 'ACCEPTED');
  const undecided = (proposals ?? []).filter((p) => decisions[p.id] === 'PENDING');

  const apply = () => {
    onApply(applyAccepted({ template, proposals: proposals ?? [], decisions }));
    onClose();
  };

  const restart = () => {
    setBrief(emptyBrief(categories, point));
    setAnswered([]);
    setPicked([]);
    setTyped('');
    setTurns([]);
    setProposals(null);
    setDecisions({});
  };

  return (
    <Drawer
      open={open}
      title={`${agent.name} — ${agent.code}`}
      subtitle={`${agent.mandate} Cannot ${agent.cannot[0].toLowerCase()}.`}
      onClose={onClose}
      width={640}
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        {categories.length === 0 ? (
          <ValidationBanner tone="warning" title="Pick a category first">
            The agent drafts for a category. Without one it has nothing to retrieve against and
            would hand you the same generic list a search engine would — choose the categories this
            template serves on the form behind this panel.
          </ValidationBanner>
        ) : (
          <ValidationBanner tone="info" title={`Drafting for ${categories.join(', ')} at ${point}`}>
            I will use three things: what your templates already ask in {categories.length === 1 ? 'this category' : 'these categories'}
            {' '}({hits.length} question{hits.length === 1 ? '' : 's'} found), what this workspace has
            seen ({signals.length} observation{signals.length === 1 ? '' : 's'}), and market practice.
            Every suggestion will say which.
          </ValidationBanner>
        )}

        {signals.length > 0 && (
          <div
            style={{
              border: `1px solid ${color.border}`, borderRadius: radius.card,
              background: color.rowAlt, padding: '11px 13px',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              What I can see in the workspace
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.65, color: color.textBody }}>
              {signals.map((signal) => <li key={signal.id}>{signal.observation}</li>)}
            </ul>
          </div>
        )}

        {turns.length > 0 && (
          <div className="rfx-stack" style={{ gap: 8 }}>
            {turns.map((turn) => (
              <div
                key={turn.id}
                style={{
                  alignSelf: turn.who === 'BUYER' ? 'flex-end' : 'flex-start',
                  maxWidth: '86%',
                  background: turn.who === 'BUYER' ? color.brandPrimarySoft : '#fff',
                  border: `1px solid ${turn.who === 'BUYER' ? color.brandPrimaryTint : color.border}`,
                  borderRadius: radius.card, padding: '9px 12px',
                  fontSize: 12.5, lineHeight: 1.6,
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

        {probe !== null && categories.length > 0 && (
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
                  onChange={(on) =>
                    setPicked((current) => {
                      if (!probe.multi) return on ? [choice.id] : [];
                      return on
                        ? [...current, choice.id]
                        : current.filter((id) => id !== choice.id);
                    })
                  }
                />
              ))}
              {probe.choices.length === 0 && (
                <TextInput
                  value={typed}
                  aria-label={probe.question}
                  placeholder="Anything particular to this buy…"
                  onChange={(e) => setTyped(e.target.value)}
                />
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button
                variant="primary"
                size="small"
                disabled={!probe.optional && picked.length === 0}
                onClick={() => submitProbe(probe)}
              >
                {probe.choices.length === 0 ? 'Send' : 'Answer'}
              </Button>
              {probe.optional && (
                <Button variant="tertiary" size="small" onClick={() => submitProbe(probe)}>
                  Skip
                </Button>
              )}
              {canDraft(brief) && (
                <Button variant="secondary" size="small" onClick={draft}>
                  That is enough — draft now
                </Button>
              )}
            </div>
          </div>
        )}

        {probe === null && proposals === null && categories.length > 0 && (
          <Button variant="primary" onClick={draft} disabled={!canDraft(brief)}>
            Draft the questions
          </Button>
        )}

        {proposals !== null && (
          <>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                paddingBottom: 4,
              }}
            >
              <strong style={{ fontSize: 13 }}>{proposals.length} suggested</strong>
              <Chip tone="brand">{accepted.length} accepted</Chip>
              {undecided.length > 0 && <Chip tone="gold">{undecided.length} undecided</Chip>}
              <span style={{ flex: 1 }} />
              <Button variant="tertiary" size="small" onClick={restart}>Start over</Button>
            </div>

            {proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                decision={decisions[proposal.id] ?? 'PENDING'}
                onDecide={(decision) => decide(proposal.id, decision)}
              />
            ))}

            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                borderTop: `1px solid ${color.border}`, paddingTop: 12,
              }}
            >
              <Button variant="primary" disabled={accepted.length === 0} onClick={apply}>
                Add {accepted.length} question{accepted.length === 1 ? '' : 's'} to the template
              </Button>
              <Button variant="secondary" onClick={onClose}>Close without adding</Button>
              <span style={{ fontSize: 11.5, color: color.textSecondary }}>
                Weights come across as suggested — re-cut them against your section budgets after.
              </span>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

function ProposalCard({
  proposal, decision, onDecide,
}: {
  proposal: AgentProposal;
  decision: Decision;
  onDecide: (decision: Decision) => void;
}) {
  const dimmed = decision === 'REJECTED';
  return (
    <div
      style={{
        border: `1px solid ${decision === 'ACCEPTED' ? color.brandPrimary : color.border}`,
        borderRadius: radius.card, padding: '12px 14px', background: '#fff',
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{proposal.title}</strong>
        {proposal.isKnockout && <Chip tone="danger" icon="✕">knockout</Chip>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <Chip tone={SOURCE_TONE[proposal.source]}>{SOURCE_LABEL[proposal.source]}</Chip>
        <code style={{ fontSize: 10.5, color: color.textMuted }}>{proposal.code}</code>
        <Chip tone="neutral">{proposal.section}</Chip>
        <Chip tone="neutral">{proposal.type}</Chip>
        {proposal.weight > 0 && <Chip tone="neutral">weight {proposal.weight}</Chip>}
        <span style={{ fontSize: 10.5, color: color.textMuted }}>
          {(proposal.confidence * 100).toFixed(0)}% confident
        </span>
      </div>

      <div style={{ fontSize: 11.5, color: color.textBody, marginTop: 8, lineHeight: 1.65 }}>
        {proposal.rationale}
      </div>
      {proposal.citation && (
        <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 4 }}>
          Cited: <code>{proposal.citation}</code>
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        <Button
          variant={decision === 'ACCEPTED' ? 'primary' : 'secondary'}
          size="small"
          aria-label={`Accept ${proposal.title}`}
          onClick={() => onDecide('ACCEPTED')}
        >
          {decision === 'ACCEPTED' ? '✓ Accepted' : 'Accept'}
        </Button>
        <Button
          variant={decision === 'REJECTED' ? 'destructive' : 'secondary'}
          size="small"
          aria-label={`Reject ${proposal.title}`}
          onClick={() => onDecide('REJECTED')}
        >
          {decision === 'REJECTED' ? '✕ Rejected' : 'Reject'}
        </Button>
      </div>
    </div>
  );
}
