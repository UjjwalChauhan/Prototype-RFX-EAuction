/**
 * Pack 21 — Negotiation.
 *
 * Two hard rules: reserve price and walk-away are internal-only and never
 * exposed to a supplier, and a BAFO round must be unmistakable on both sides.
 */
import React from 'react';
import { color, money, radius, savingsColor, signedMoney } from '../../design-system/tokens';
import {
  Button, Chip, CurrencyInput, Field, Radio, Textarea,
} from '../../design-system/components/primitives';
import { Card, Empty, Table, type Column } from '../../design-system/components/layout';
import { AgentCard, Modal, ValidationBanner } from '../../design-system/components/domain';
import { improvement } from '../../domain/comparator';
import { biddersForEvent, lotsForEvent, useStore } from '../../store/store';
import { COUNTERPARTY_NAMES } from '../../data/seed';
import { forbiddenReason } from '../../domain/agents';
import type { NegotiationRound, NegotiationRoundType, NegotiationScope } from '../../domain/types';

interface Position {
  bidderId: string;
  name: string;
  current: number;
  previous: number | null;
  paymentTermsDays: number;
  leadTimeDays: number;
  warrantyMonths: number;
}

export function NegotiationTab({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const bidders = biddersForEvent(state, eventId);
  const lots = lotsForEvent(state, eventId);
  const rounds = state.negotiationRounds.filter((r) => r.eventId === eventId);

  const [composeOpen, setComposeOpen] = React.useState(false);
  const [roundType, setRoundType] = React.useState<NegotiationRoundType>('STANDARD');
  const [scope, setScope] = React.useState<NegotiationScope>('TOP_N');
  const [message, setMessage] = React.useState('');
  const [walkAway, setWalkAway] = React.useState(lots[0]?.reservePrice ?? 148_000);

  const maxRounds = 3;
  const roundsUsed = rounds.length;
  const bafoIssued = rounds.some((r) => r.type === 'BAFO');

  const positions: Position[] = bidders.slice(0, 3).map((bidder, i) => ({
    bidderId: bidder.id,
    name: COUNTERPARTY_NAMES[bidder.counterpartyId],
    current: [141_000, 141_500, 145_000][i],
    previous: [142_000, 146_000, null][i],
    paymentTermsDays: [60, 30, 45][i],
    leadTimeDays: [4, 6, 9][i],
    warrantyMonths: [24, 12, 18][i],
  }));

  const target = lots[0]?.targetPrice ?? 138_000;

  const columns: Column<Position>[] = [
    { key: 'name', header: 'Bidder', render: (p) => <strong style={{ fontSize: 12.5 }}>{p.name}</strong> },
    { key: 'current', header: 'Current position', numeric: true, render: (p) => money(p.current, event.currency) },
    {
      key: 'movement', header: 'Moved', numeric: true,
      render: (p) =>
        p.previous === null ? (
          <span style={{ color: color.textMuted }}>no prior round</span>
        ) : (
          <span style={{ color: savingsColor(improvement(p.previous, p.current, event.side)) }}>
            {signedMoney(improvement(p.previous, p.current, event.side), event.currency)}
          </span>
        ),
    },
    {
      key: 'gap', header: 'Gap to target', numeric: true,
      render: (p) => (
        <span style={{ color: p.current <= target ? color.successText : color.warningText }}>
          {signedMoney(target - p.current, event.currency)}
        </span>
      ),
    },
    { key: 'terms', header: 'Payment', numeric: true, render: (p) => `${p.paymentTermsDays} days` },
    { key: 'lead', header: 'Lead time', numeric: true, render: (p) => `${p.leadTimeDays} days` },
    { key: 'warranty', header: 'Warranty', numeric: true, render: (p) => `${p.warrantyMonths} mo` },
    {
      // The computed value of a concession, so the buyer sees what a term is worth.
      key: 'impact', header: 'Term value', numeric: true,
      render: (p) => {
        const impact = (p.paymentTermsDays - 30) * (p.current * 0.075 / 365)
          + (30 - p.leadTimeDays) * 40
          + (p.warrantyMonths - 12) * 55;
        return (
          <span title="Computed commercial impact of the non-price terms offered">
            {signedMoney(impact, event.currency)}
          </span>
        );
      },
    },
  ];

  const openRound = () => {
    const round: NegotiationRound = {
      id: `nr-${Date.now()}`,
      eventId,
      roundNumber: roundsUsed + 1,
      type: roundType,
      scope,
      negotiable: ['PRICE', 'TERMS'],
      deadline: Date.now() + 2 * 86_400_000,
      message,
      bidderIds: scope === 'ALL' ? bidders.map((b) => b.id) : positions.map((p) => p.bidderId),
      closed: false,
    };
    dispatch({ type: 'ADD_NEGOTIATION_ROUND', round });
    setComposeOpen(false);
    setMessage('');
  };

  return (
    <div className="rfx-split">
      <div className="rfx-stack" style={{ gap: 14 }}>
        {bafoIssued && (
          <ValidationBanner tone="warning" title="A BAFO round has been issued — no further rounds are possible">
            Best and Final Offer is one shot, and it is unmistakable on both sides. The supplier's
            portal shows the same banner.
          </ValidationBanner>
        )}
        {roundsUsed >= maxRounds && !bafoIssued && (
          <ValidationBanner tone="warning" title={`Round limit reached (${maxRounds})`}>
            <code>config.negotiation.max_rounds</code> is {maxRounds}. Raise it at the appropriate
            configuration scope, or move to award.
          </ValidationBanner>
        )}

        <Card
          padded={false}
          title="Current positions"
          hint="Non-price levers carry a computed commercial impact, so a concession's true value is visible."
          action={
            <Button
              size="small"
              variant="primary"
              disabled={bafoIssued || roundsUsed >= maxRounds}
              onClick={() => setComposeOpen(true)}
            >
              Open round {roundsUsed + 1}
            </Button>
          }
        >
          <Table columns={columns} rows={positions} rowKey={(p) => p.bidderId} />
        </Card>

        <Card padded={false} title="Round history" hint="Every offer is a quote version with a full price schedule.">
          {rounds.length === 0 ? (
            <Empty icon="◇" title="No rounds run yet" hint="Open a round to invite counter-offers." />
          ) : (
            <div>
              {rounds.map((round, i) => (
                <div
                  key={round.id}
                  style={{ padding: '12px 15px', borderTop: i === 0 ? 'none' : `1px solid ${color.border}` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Round {round.roundNumber}</span>
                    <Chip tone={round.type === 'BAFO' ? 'danger' : 'neutral'}>
                      {round.type === 'BAFO' ? 'BAFO — final' : round.type.toLowerCase()}
                    </Chip>
                    <Chip tone="neutral">scope {round.scope.toLowerCase().replace('_', ' ')}</Chip>
                    <Chip tone={round.closed ? 'brand' : 'gold'}>{round.closed ? 'closed' : 'open'}</Chip>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: color.textSecondary }}>
                      deadline {new Date(round.deadline).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: color.textBody, marginTop: 6, lineHeight: 1.6 }}>
                    {round.message}
                  </div>
                  <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 5 }}>
                    Sent to {round.bidderIds.length} bidder(s). A bidder's thread is visible only to that bidder.
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Target price panel" hint="Internal. None of this leaves the buyer boundary.">
          <div className="rfx-stack" style={{ gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: color.textSecondary }}>Target 🔒</div>
              <div style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {money(target, event.currency)}
              </div>
              <div style={{ fontSize: 10.5, color: color.textSecondary }}>What we are aiming for.</div>
            </div>
            <Field label="Walk-away 🔒" hint="The point at which we stop negotiating. Never exposed to a supplier.">
              <CurrencyInput value={walkAway} onChange={(e) => setWalkAway(Number(e.target.value))} />
            </Field>
            <div
              style={{
                background: color.dangerSoft, border: '1px solid #FCA5A5',
                borderRadius: radius.control, padding: '9px 11px', fontSize: 11.5, color: color.dangerText,
                lineHeight: 1.55,
              }}
            >
              Reserve price and walk-away are internal-only. There is no configuration that discloses
              them, and no negotiation message template that can include them.
            </div>
          </div>
        </Card>

        <AgentCard
          code="AG-09"
          name="Negotiation"
          autonomy="SUGGEST"
          confidence={0.76}
          summary={`Prime Stationery moved 3.1% in round 1 and holds the widest margin on lead time — the most room remains there. Suggest a targeted round at ${money(target * 1.01, event.currency)} against Prime and ABC only.`}
          evidence={[
            { label: 'Round 1 movement', detail: 'Prime −3.1%, ABC −0.7%, Global −0.7%' },
            { label: 'Should-cost model', detail: `Floor estimated at ${money(target * 0.97, event.currency)}` },
            { label: 'Mandate floor', detail: `${money(walkAway, event.currency)} — AG-09 cannot go below this` },
          ]}
          breaches={[forbiddenReason('FINAL_AWARD')]}
          onAccept={() => setComposeOpen(true)}
          onReject={() => undefined}
        />
      </div>

      <Modal
        open={composeOpen}
        title={`Open negotiation round ${roundsUsed + 1}`}
        width={560}
        onClose={() => setComposeOpen(false)}
        onConfirm={openRound}
        confirmLabel={roundType === 'BAFO' ? 'Issue BAFO — final round' : 'Open round'}
        confirmTone={roundType === 'BAFO' ? 'destructive' : 'primary'}
        confirmDisabled={message.trim().length < 10}
      >
        <div className="rfx-stack" style={{ gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Round type</div>
            <div className="rfx-stack" style={{ gap: 7 }}>
              <Radio
                checked={roundType === 'STANDARD'}
                onChange={() => setRoundType('STANDARD')}
                label="Standard counter-offer"
                hint="An exchange of priced positions. Further rounds remain possible."
              />
              <Radio
                checked={roundType === 'TARGETED'}
                onChange={() => setRoundType('TARGETED')}
                label="Targeted ask"
                hint="A specific request to specific bidders."
              />
              <Radio
                checked={roundType === 'BAFO'}
                onChange={() => setRoundType('BAFO')}
                label="BAFO — Best and Final Offer"
                hint="One shot. No further rounds. Both sides see this unmistakably."
              />
            </div>
          </div>

          {roundType === 'BAFO' && (
            <ValidationBanner tone="warning" title="BAFO closes negotiation">
              Once issued, no further rounds can be opened on this event. The supplier's portal shows a
              prominent final-round banner and the deadline is hard.
            </ValidationBanner>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Scope</div>
            <div className="rfx-stack" style={{ gap: 7 }}>
              <Radio checked={scope === 'ALL'} onChange={() => setScope('ALL')} label="All bidders" />
              <Radio checked={scope === 'TOP_N'} onChange={() => setScope('TOP_N')} label="Top 3 only" />
              <Radio checked={scope === 'SELECTED'} onChange={() => setScope('SELECTED')} label="Selected bidders" />
            </div>
          </div>

          <Field label="Message to bidders" required>
            <Textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What you are asking for, and by when. Do not reference the target or walk-away."
            />
          </Field>

          <div style={{ fontSize: 11, color: color.textSecondary }}>
            Rounds used {roundsUsed} of {maxRounds}. Each bidder sees only their own thread.
          </div>
        </div>
      </Modal>
    </div>
  );
}
