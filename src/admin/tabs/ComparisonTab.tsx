/**
 * Event workspace — Comparison.
 *
 * The sheet a buyer actually decides from: suppliers across the top, what was
 * asked of them down the side. Two of them, because they are read at different
 * moments and one is sealed while the other is being scored.
 *
 * - **Technical** — the technical envelope, from every ask in the family. A
 *   ladder asks capability at RFI and re-confirms it at RFP, so the rows are
 *   grouped by the ask that asked them and a supplier is read down one column.
 * - **Commercial** — the quotation, per line: price, quantity, tax, total, then
 *   the L1 supplier and the quantity that would go to them, and per supplier
 *   other charges, base amount, tax amount and rank.
 *
 * Both refuse to fill in a blank. A supplier who did not quote a line shows an
 * em dash and is not ranked on it, because a missing price that reads as zero
 * is the fastest way to award to the wrong supplier.
 */
import React from 'react';
import { color, money } from '../../design-system/tokens';
import { Button, Chip, Segmented } from '../../design-system/components/primitives';
import { Card, Empty } from '../../design-system/components/layout';
import { ValidationBanner } from '../../design-system/components/domain';
import {
  biddersForEvent, lineItemsForEvent, lotsForEvent, responsesForEvent, stageEventsOf, useStore,
  costComponentsFor,
} from '../../store/store';
import {
  commercialComparison, commercialCsv, technicalComparison, technicalCsv,
  type CommercialComparison, type TechnicalComparison, type VendorColumn,
} from '../../domain/comparison';
import { STAGE_LABELS } from '../../domain/journeyPatterns';
import { directionLabel } from '../../domain/comparator';
import { resolve } from '../../domain/config';
import { COUNTERPARTY_NAMES, QUESTIONNAIRE, SCOPE_LINEAGE } from '../../data/seed';

type Sheet = 'TECHNICAL' | 'COMMERCIAL';

export function ComparisonTab({
  eventId, initialSheet = 'TECHNICAL',
}: {
  eventId: string;
  /** Which sheet opens. Technical first, because that is the order of the work. */
  initialSheet?: Sheet;
}) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;

  /**
   * The comparison is a family view. Opened on one ask it still reads across
   * the ladder, because a buyer comparing RFQ prices needs the RFI answers
   * beside them — that is the whole point of running the stages as one event.
   */
  const rootId = event.parentEventId ?? eventId;
  const root = state.events.find((e) => e.id === rootId) ?? event;
  const asks = stageEventsOf(state, rootId);
  const familyEvents = [root, ...asks];
  const familyIds = new Set(familyEvents.map((e) => e.id));

  const bidders = biddersForEvent(state, rootId);
  const responses = responsesForEvent(state, rootId);
  const lots = lotsForEvent(state, rootId);
  const lineItems = lineItemsForEvent(state, rootId);

  /**
   * The questionnaires the family asked. The seeded set stands in for the
   * demonstration event, which predates event-owned questionnaires.
   */
  const questionnaires = React.useMemo(() => {
    const own = state.questionnaires.filter((q) => familyIds.has(q.eventId));
    return own.length > 0 ? own : [{ ...QUESTIONNAIRE, eventId: rootId }];
  }, [state.questionnaires, rootId, familyEvents.map((e) => e.id).join()]);

  // Blind technical is locked at tenant scope: the technical sheet is read
  // against masked labels, and only the commercial sheet names anyone.
  const blindTechnical = resolve(
    'evaluation.blind_technical', state.configSettings,
    { ...SCOPE_LINEAGE, eventId: rootId }, true as boolean,
  ).value;

  const snapshot = (root.configSnapshotAtPublish ?? {}) as Record<string, unknown>;
  const gate = (snapshot.technicalGate as TechnicalGateValue | undefined) ?? 'MIN_SCORE';
  const minScore = (snapshot.minTechnicalScore as number | undefined) ?? 60;

  const [sheet, setSheet] = React.useState<Sheet>(initialSheet);
  /**
   * The commercial seal, held here so the reveal can be demonstrated end to
   * end. In production it is the envelope row and the key released by the
   * unlock event; nothing client-side decides whether a bid is readable.
   */
  const [revealed, setRevealed] = React.useState(false);
  const twoEnvelope = root.envelopeMode === 'TWO_ENVELOPE';
  const canView = state.currentUser.permissions.includes('view_commercial');
  const canUnlock = state.currentUser.permissions.includes('unlock_commercial');
  const sealed = twoEnvelope && !revealed;

  const technical = React.useMemo(
    () => technicalComparison({
      events: familyEvents,
      questionnaires,
      responses,
      bidders,
      scores: state.scores,
      names: COUNTERPARTY_NAMES,
      masked: blindTechnical,
      gate,
      minScore,
    }),
    [questionnaires, responses, bidders, state.scores, blindTechnical, gate, minScore],
  );

  const commercial = React.useMemo(
    () => commercialComparison({
      event: root,
      lots,
      lineItems,
      questionnaires,
      responses,
      bidders,
      scores: state.scores,
      names: COUNTERPARTY_NAMES,
      costComponents: costComponentsFor(state, rootId),
      masked: false,
    }),
    [root, lots, lineItems, questionnaires, responses, bidders, state.scores, rootId],
  );

  if (bidders.length === 0) {
    return (
      <Card padded={false}>
        <Empty
          icon="▤"
          title="Nobody has been invited yet"
          hint="A comparison needs at least one supplier. Invite a shortlist on the Bidders tab, and the sheet fills in as responses arrive."
        />
      </Card>
    );
  }

  const download = () => {
    const csv = sheet === 'TECHNICAL' ? technicalCsv(technical) : commercialCsv(commercial);
    const name = `${root.eventNumber}-${sheet.toLowerCase()}-comparison.csv`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Card
        title={`Comparison — ${root.eventNumber}`}
        hint={
          asks.length > 0
            ? `Read across ${asks.length} ${asks.length === 1 ? 'ask' : 'asks'}: ${asks.map((a) => a.eventNumber).join(', ')}. One basket, one shortlist, one sheet.`
            : 'Technical from the questionnaires, commercial from the quotations. Ranks follow the event side.'
        }
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Segmented
              value={sheet}
              onChange={(next) => setSheet(next as Sheet)}
              options={[
                { value: 'TECHNICAL', label: `Technical (${technical.asked})` },
                { value: 'COMMERCIAL', label: `Commercial (${commercial.lines.length})` },
              ]}
            />
            <Button size="small" variant="secondary" onClick={download}>Export CSV</Button>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: color.textSecondary }}>
          <span>
            <strong style={{ color: color.textPrimary }}>{commercial.vendors.length}</strong> suppliers
          </span>
          <span>
            <strong style={{ color: color.textPrimary }}>
              {commercial.vendors.filter((v) => v.submittedAt !== null).length}
            </strong>{' '}
            submitted
          </span>
          <span>{directionLabel(root.side)}</span>
          <span>
            {technical.scored} of {technical.asked} technical questions carry a weight
          </span>
        </div>
      </Card>

      {sheet === 'TECHNICAL' ? (
        <TechnicalSheet comparison={technical} gate={gate} minScore={minScore} masked={blindTechnical} />
      ) : (
        <CommercialSheet
          comparison={commercial}
          sealed={sealed}
          canView={canView}
          canUnlock={canUnlock}
          twoEnvelope={twoEnvelope}
          onReveal={() => setRevealed(true)}
        />
      )}
    </div>
  );
}

type TechnicalGateValue = 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH';

// ---------------------------------------------------------------------------
// The grid both sheets are drawn on
// ---------------------------------------------------------------------------

interface SheetRow {
  key: string;
  /** A group heading spans the sheet: a line item, or the ask a block came from. */
  kind: 'group' | 'data' | 'total';
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  cells: React.ReactNode[];
  /** The L1 columns, which only the commercial sheet uses. */
  trailing?: React.ReactNode[];
}

/**
 * One sheet: a sticky label column, one column per supplier, and whatever
 * trailing columns the sheet needs.
 *
 * Hand-rolled rather than the shared `Table` because the row groups, the
 * sticky first column and the per-cell tinting are the whole point here — a
 * generic table with a `render` per row would be harder to read, not easier.
 */
function SheetGrid({
  vendors, rows, trailingHeaders = [], caption,
}: {
  vendors: VendorColumn[];
  rows: SheetRow[];
  trailingHeaders?: string[];
  caption?: React.ReactNode;
}) {
  const cell: React.CSSProperties = {
    padding: '8px 11px', fontSize: 12.5, borderTop: `1px solid ${color.border}`,
    verticalAlign: 'top',
  };
  const head: React.CSSProperties = {
    padding: '9px 11px', fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
    color: color.textSecondary, textTransform: 'uppercase',
    borderBottom: `1px solid ${color.border}`, background: color.surface,
    textAlign: 'left', whiteSpace: 'nowrap',
  };

  return (
    <div className="rfx-scroll-x">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {caption && (
          <caption style={{ captionSide: 'top', textAlign: 'left', padding: '0 11px 8px', fontSize: 11.5, color: color.textSecondary }}>
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            <th style={{ ...head, position: 'sticky', left: 0, zIndex: 2, minWidth: 260 }} />
            {vendors.map((vendor) => (
              <th key={vendor.bidderId} style={{ ...head, minWidth: 150 }} title={vendor.masked ? undefined : vendor.legalName}>
                {vendor.name}
                {vendor.disqualified && (
                  <span style={{ display: 'block', color: color.dangerText, fontWeight: 500, textTransform: 'none' }}>
                    disqualified
                  </span>
                )}
              </th>
            ))}
            {trailingHeaders.map((label) => (
              <th key={label} style={{ ...head, minWidth: 130, background: color.neutralSoft }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isGroup = row.kind === 'group';
            const isTotal = row.kind === 'total';
            const background = isGroup ? color.brandPrimarySoft : isTotal ? color.surface : '#fff';
            return (
              <tr key={row.key} style={{ background }}>
                <th
                  scope="row"
                  style={{
                    ...cell,
                    position: 'sticky', left: 0, zIndex: 1, background,
                    textAlign: 'left',
                    fontWeight: isGroup || isTotal ? 600 : 400,
                    color: color.textPrimary,
                  }}
                >
                  {row.label}
                  {row.sublabel && (
                    <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2, fontWeight: 400 }}>
                      {row.sublabel}
                    </div>
                  )}
                </th>
                {row.cells.map((content, i) => (
                  <td key={vendors[i]?.bidderId ?? i} style={{ ...cell, fontWeight: isTotal ? 600 : 400 }}>
                    {content}
                  </td>
                ))}
                {(row.trailing ?? []).map((content, i) => (
                  <td
                    key={`trailing-${trailingHeaders[i] ?? i}`}
                    style={{ ...cell, background: isGroup ? color.brandPrimarySoft : color.neutralSoft }}
                  >
                    {content}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const blank = <span style={{ color: color.textMuted }}>—</span>;

/**
 * Money on this sheet, to the cent.
 *
 * `money` rounds to whole currency units, which is right for a headline and
 * wrong here twice over: a pen at $17.39 shown as $17 disagrees with its own
 * arithmetic once quantity is applied, and a total rounded on screen but exact
 * in the export gives an approver two numbers for the same bid.
 */
function amount(value: number, currency: string): string {
  return money(value, currency, { decimals: 2 });
}

/** A rank, shown the way the client's own sheets show it. */
function RankChip({ rank, tied }: { rank: number | null; tied?: boolean }) {
  if (rank === null) return blank;
  return (
    <Chip
      tone={rank === 1 ? 'brand' : 'neutral'}
      title={tied && rank === 1 ? 'Tied at L1 — the tie-break policy decides' : undefined}
    >
      {`Rank ${rank}`}{tied && rank === 1 ? ' (tied)' : ''}
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

function TechnicalSheet({
  comparison, gate, minScore, masked,
}: {
  comparison: TechnicalComparison;
  gate: TechnicalGateValue;
  minScore: number;
  masked: boolean;
}) {
  const { vendors, sections, totals } = comparison;

  if (sections.length === 0) {
    return (
      <Card padded={false}>
        <Empty
          icon="▤"
          title="No technical questions were asked"
          hint="The technical sheet is built from the questions in the technical envelope of this event's questionnaires. Add them on the Questionnaire tab."
        />
      </Card>
    );
  }

  const rows: SheetRow[] = [];
  for (const section of sections) {
    rows.push({
      key: `section-${section.eventId}-${section.stage}`,
      kind: 'group',
      label: `${STAGE_LABELS[section.stage]} · ${section.name}`,
      sublabel: section.eventNumber,
      cells: vendors.map(() => ''),
    });
    for (const row of section.rows) {
      rows.push({
        key: `q-${row.eventId}-${row.question.id}`,
        kind: 'data',
        label: (
          <span>
            {row.question.title}
            {row.question.isKnockout && (
              <Chip tone="danger" title="A zero here disqualifies the supplier, citing this row">
                knockout
              </Chip>
            )}
          </span>
        ),
        sublabel: (
          <>
            <code style={{ fontSize: 10.5 }}>{row.question.code}</code>
            {row.question.weight > 0 && ` · weight ${row.question.weight}`}
          </>
        ),
        cells: vendors.map((vendor) => {
          const cell = row.cells.find((c) => c.bidderId === vendor.bidderId)!;
          const best = cell.score !== null && row.bestScore !== null && cell.score === row.bestScore;
          return (
            <div>
              {cell.answered
                ? <span style={{ color: cell.knockedOut ? color.dangerText : color.textPrimary }}>{cell.display}</span>
                : <em style={{ color: color.textMuted }}>not answered</em>}
              {cell.attachmentName && (
                <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 2 }}>
                  📎 {cell.attachmentName}
                </div>
              )}
              {cell.score !== null && (
                <div style={{ marginTop: 3 }}>
                  <Chip tone={cell.knockedOut ? 'danger' : best ? 'brand' : 'neutral'}>
                    {cell.score}/{cell.maxScore}
                  </Chip>
                </div>
              )}
            </div>
          );
        }),
      });
    }
  }

  rows.push({
    key: 'total-score',
    kind: 'total',
    label: 'Technical score',
    sublabel: 'Weighted percentage across the scored questions',
    cells: vendors.map((vendor) => {
      const total = totals.find((t) => t.bidderId === vendor.bidderId)!;
      return (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {total.score.toFixed(1)}%
        </span>
      );
    }),
  });
  rows.push({
    key: 'total-answered',
    kind: 'total',
    label: 'Questions answered',
    cells: vendors.map((vendor) => {
      const total = totals.find((t) => t.bidderId === vendor.bidderId)!;
      return `${total.answered} of ${total.asked}`;
    }),
  });
  rows.push({
    key: 'total-rank',
    kind: 'total',
    label: 'Technical rank',
    cells: vendors.map((vendor) => {
      const total = totals.find((t) => t.bidderId === vendor.bidderId)!;
      return <RankChip rank={total.rank} />;
    }),
  });
  rows.push({
    key: 'total-scored',
    kind: 'total',
    label: 'Questions scored',
    sublabel: 'Of those carrying a weight',
    cells: vendors.map((vendor) => {
      const total = totals.find((t) => t.bidderId === vendor.bidderId)!;
      return `${total.scored} of ${total.scoredOf}`;
    }),
  });
  rows.push({
    key: 'total-gate',
    kind: 'total',
    label: 'Technical gate',
    sublabel: gate === 'NONE'
      ? 'No gate on this event'
      : gate === 'PASS_FAIL' ? 'Knockouts only' : `Minimum ${minScore}%`,
    cells: vendors.map((vendor) => {
      const total = totals.find((t) => t.bidderId === vendor.bidderId)!;
      if (gate === 'NONE') return blank;
      if (total.verdict === 'QUALIFIES') return <Chip tone="brand">qualifies</Chip>;
      if (total.verdict === 'PENDING') {
        return (
          <Chip tone="neutral" title="The score is measured against the achievable total, so it is low until every weighted question is scored.">
            scoring incomplete
          </Chip>
        );
      }
      return (
        <span>
          <Chip tone="danger">does not qualify</Chip>
          {total.knockedOutOn.length > 0 && (
            <div style={{ fontSize: 10.5, color: color.dangerText, marginTop: 2 }}>
              {total.knockedOutOn.join(' · ')}
            </div>
          )}
        </span>
      );
    }),
  });

  // Only a settled failure is called out. A supplier who is merely unscored is
  // not a supplier who failed, and a banner saying otherwise excludes them.
  const failed = totals.filter((t) => t.verdict === 'DOES_NOT_QUALIFY');
  const pending = totals.filter((t) => t.verdict === 'PENDING');

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {masked && (
        <ValidationBanner tone="info" title="Blind technical — suppliers are masked here">
          Technical answers are evaluated against masked labels, and the mapping is not shown on this
          sheet. Names appear on the commercial sheet, after the technical evaluation is complete.
        </ValidationBanner>
      )}

      {failed.length > 0 && (
        <ValidationBanner
          tone="warning"
          title={`${failed.length} supplier${failed.length === 1 ? '' : 's'} would not pass the technical gate`}
        >
          {failed.map((t) => `${t.name} (${t.score.toFixed(1)}%${t.knockedOutOn.length > 0 ? `, knockout: ${t.knockedOutOn.join(', ')}` : ''})`).join(' · ')}.
          A supplier below the gate is not compared on price — that is the point of the gate.
        </ValidationBanner>
      )}

      {pending.length > 0 && (
        <ValidationBanner tone="info" title="The technical evaluation is not finished">
          {pending.map((t) => `${t.name}: ${t.scored} of ${t.scoredOf} scored`).join(' · ')}. The
          score is measured against the achievable total, so it reads low until the scoring is
          complete — no gate verdict is drawn from it yet.
        </ValidationBanner>
      )}

      <Card padded={false} title="Technical comparison" hint="One column per supplier, grouped by the ask that asked it.">
        <SheetGrid vendors={vendors} rows={rows} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commercial
// ---------------------------------------------------------------------------

function CommercialSheet({
  comparison, sealed, canView, canUnlock, twoEnvelope, onReveal,
}: {
  comparison: CommercialComparison;
  sealed: boolean;
  canView: boolean;
  canUnlock: boolean;
  twoEnvelope: boolean;
  onReveal: () => void;
}) {
  const { vendors, lines, totals, questionRows, currency, l1 } = comparison;

  if (!canView) {
    return (
      <Card padded={false}>
        <Empty
          icon="🔒"
          title="Your role cannot read commercial responses"
          hint="The commercial sheet requires view_commercial. The technical sheet is available."
          tone="permission"
        />
      </Card>
    );
  }

  if (sealed) {
    return (
      <Card padded={false}>
        <div style={{ padding: 16 }}>
          <ValidationBanner
            tone="info"
            title="Commercial envelopes are sealed"
            action={
              canUnlock
                ? <Button size="small" variant="primary" onClick={onReveal}>Unlock commercial</Button>
                : undefined
            }
          >
            This event runs two envelopes, so no price is readable — by anyone, including a platform
            administrator — until the unlock event releases the key. Unlocking is irreversible and is
            recorded with the actor, the time and any witnesses.
            {!canUnlock && ' Your role does not hold unlock_commercial.'}
          </ValidationBanner>
        </div>
      </Card>
    );
  }

  const rows: SheetRow[] = [];
  let currentLot: string | null = null;

  for (const line of lines) {
    if (line.lotName !== currentLot) {
      currentLot = line.lotName;
      rows.push({
        key: `lot-${line.lotId}`,
        kind: 'group',
        label: line.lotName || 'Unlotted',
        sublabel: 'Bid, ranked and awarded as a unit',
        cells: vendors.map(() => ''),
        trailing: ['', ''],
      });
    }

    // The item row carries the ranks, and the L1 columns beside them — the
    // shape the client's own comparison sheets come in.
    rows.push({
      key: `item-${line.lineItem.id}`,
      kind: 'data',
      label: (
        <strong>
          {line.lineItem.description}
          {' '}
          <span style={{ fontWeight: 400, color: color.textSecondary }}>
            ({line.lineItem.uom} units required)
          </span>
        </strong>
      ),
      sublabel: line.lineItem.itemCode || undefined,
      cells: vendors.map((vendor) => {
        const cell = line.cells.find((c) => c.bidderId === vendor.bidderId)!;
        return <RankChip rank={cell.rank} tied={line.tied && cell.isL1} />;
      }),
      trailing: [
        line.l1 === null ? blank : <strong>{line.l1.name}</strong>,
        line.l1 === null
          ? blank
          : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{line.l1.quantity.toLocaleString()}</span>,
      ],
    });

    const measures: { key: string; label: string; of: (c: (typeof line.cells)[number]) => React.ReactNode }[] = [
      { key: 'price', label: 'Price', of: (c) => (c.unitPrice === null ? blank : amount(c.unitPrice, currency)) },
      { key: 'qty', label: 'Qtty', of: (c) => (c.unitPrice === null ? blank : c.quantity.toLocaleString()) },
      { key: 'tax', label: `Tax${line.cells[0]?.taxRate ? ` (${line.cells[0].taxRate}%)` : ''}`, of: (c) => (c.tax === null ? blank : amount(c.tax, currency)) },
      { key: 'total', label: 'Total', of: (c) => (c.total === null ? blank : amount(c.total, currency)) },
    ];

    for (const measure of measures) {
      rows.push({
        key: `${line.lineItem.id}-${measure.key}`,
        kind: 'data',
        label: measure.label,
        cells: vendors.map((vendor) => {
          const cell = line.cells.find((c) => c.bidderId === vendor.bidderId)!;
          const best = measure.key === 'total' && cell.isL1;
          return (
            <span
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontWeight: best ? 700 : 400,
                color: best ? color.successText : color.textPrimary,
              }}
            >
              {measure.of(cell)}
            </span>
          );
        }),
        trailing: ['', ''],
      });
    }
  }

  const totalOf = (bidderId: string) => totals.find((t) => t.bidderId === bidderId)!;

  rows.push({
    key: 'other-charges',
    kind: 'total',
    label: 'Other Charges',
    sublabel: comparison.otherChargeNames.length > 0
      ? comparison.otherChargeNames.join(' · ')
      : 'None loaded on this event',
    cells: vendors.map((v) => {
      const total = totalOf(v.bidderId);
      return total.otherCharges === 0
        ? blank
        : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{amount(total.otherCharges, currency)}</span>;
    }),
    trailing: ['', ''],
  });
  rows.push({
    key: 'base-amount',
    kind: 'total',
    label: 'Base Amount',
    cells: vendors.map((v) => (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{amount(totalOf(v.bidderId).base, currency)}</span>
    )),
    trailing: ['', ''],
  });
  rows.push({
    key: 'tax-amount',
    kind: 'total',
    label: 'Tax Amount',
    cells: vendors.map((v) => (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{amount(totalOf(v.bidderId).tax, currency)}</span>
    )),
    trailing: ['', ''],
  });
  rows.push({
    key: 'grand-total',
    kind: 'total',
    label: 'Total landed value',
    sublabel: 'Base + tax + other charges',
    cells: vendors.map((v) => {
      const total = totalOf(v.bidderId);
      const best = total.rank === 1;
      return (
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontWeight: best ? 700 : 600,
            color: best ? color.successText : color.textPrimary,
          }}
        >
          {amount(total.total, currency)}
        </span>
      );
    }),
    trailing: [
      l1 === null ? blank : <strong>{l1.name}</strong>,
      l1 === null ? blank : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{amount(l1.total, currency)}</span>,
    ],
  });
  rows.push({
    key: 'overall-rank',
    kind: 'total',
    label: 'Commercial rank',
    sublabel: 'Ranked on the landed total. A partial quotation is not ranked.',
    cells: vendors.map((v) => {
      const total = totalOf(v.bidderId);
      return total.complete
        ? <RankChip rank={total.rank} />
        : (
          <Chip tone="neutral" title={`Priced ${total.linesQuoted} of ${lines.length} lines`}>
            partial
          </Chip>
        );
    }),
    trailing: ['', ''],
  });

  const partial = totals.filter((t) => !t.complete && t.linesQuoted > 0);
  const silent = vendors.filter((v) => totalOf(v.bidderId).linesQuoted === 0);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {twoEnvelope && (
        <ValidationBanner tone="info" title="Commercial envelopes are unlocked">
          Revealed for this session. The unlock is irreversible and recorded — who opened it, when,
          and with which witnesses.
        </ValidationBanner>
      )}

      {partial.length > 0 && (
        <ValidationBanner tone="warning" title="A partial quotation is not comparable on total">
          {partial.map((t) => `${t.name} priced ${t.linesQuoted} of ${lines.length} lines`).join(' · ')}.
          They are ranked line by line where they quoted, and left out of the total ranking — a
          partial bid compared against a complete one is the classic false L1.
        </ValidationBanner>
      )}

      {comparison.unquotedLines.length > 0 && (
        <ValidationBanner tone="warning" title={`${comparison.unquotedLines.length} line(s) nobody quoted`}>
          {comparison.unquotedLines.map((l) => l.description).join(' · ')}. These lines have no
          market response and cannot be awarded from this event.
        </ValidationBanner>
      )}

      <Card
        padded={false}
        title="Commercial comparison"
        hint={`Quotations against the basket. ${directionLabel(comparison.side)}; the L1 column names the supplier each line would go to.`}
      >
        <SheetGrid
          vendors={vendors}
          rows={rows}
          trailingHeaders={['L1 VENDOR', 'L1 QUANTITY']}
        />
      </Card>

      {questionRows.length > 0 && (
        <Card
          padded={false}
          title="Commercial terms as answered"
          hint="The commercial envelope beyond price — payment terms, returns, and anything else asked there."
        >
          <SheetGrid
            vendors={vendors}
            rows={questionRows.map((row): SheetRow => ({
              key: `com-${row.question.id}`,
              kind: 'data',
              label: row.question.title,
              sublabel: <code style={{ fontSize: 10.5 }}>{row.question.code}</code>,
              cells: vendors.map((vendor) => {
                const cell = row.cells.find((c) => c.bidderId === vendor.bidderId)!;
                const best = cell.score !== null && cell.score === row.bestScore;
                return (
                  <div>
                    {cell.answered
                      ? cell.display
                      : <em style={{ color: color.textMuted }}>not answered</em>}
                    {cell.score !== null && (
                      <div style={{ marginTop: 3 }}>
                        <Chip tone={best ? 'brand' : 'neutral'}>{cell.score}/{cell.maxScore}</Chip>
                      </div>
                    )}
                  </div>
                );
              }),
            }))}
          />
        </Card>
      )}

      {silent.length > 0 && (
        <div style={{ fontSize: 11.5, color: color.textSecondary, padding: '0 2px' }}>
          No quotation from {silent.map((v) => v.name).join(', ')}. They hold an invitation but have
          not priced anything, so they appear as columns of em dashes rather than being dropped —
          a supplier who did not bid is a fact about this event.
        </div>
      )}
    </div>
  );
}
