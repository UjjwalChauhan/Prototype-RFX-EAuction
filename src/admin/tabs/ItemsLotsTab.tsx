/**
 * Event workspace — Items & Lots.
 *
 * The staggered schedule gets a visual timeline because staggered lot
 * configurations are easy to misconfigure and hard to check as numbers.
 */
import React from 'react';
import { color, money, radius } from '../../design-system/tokens';
import { Button, Chip, CurrencyInput, Field, Segmented } from '../../design-system/components/primitives';
import { Card, Table, type Column } from '../../design-system/components/layout';
import { ValidationBanner } from '../../design-system/components/domain';
import { lotsForEvent, useStore } from '../../store/store';
import { LINE_ITEMS } from '../../data/seed';
import type { LineItem, LotStrategy } from '../../domain/types';

export function ItemsLotsTab({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const lots = lotsForEvent(state, eventId);
  const [strategy, setStrategy] = React.useState<LotStrategy>(state.auction.auction.lotStrategy);
  const [selectedLot, setSelectedLot] = React.useState(lots[0]?.id ?? '');

  const lines = LINE_ITEMS.filter((l) => lots.some((lot) => lot.id === l.lotId));
  const lotLines = lines.filter((l) => l.lotId === selectedLot);
  const lot = lots.find((l) => l.id === selectedLot);

  const columns: Column<LineItem>[] = [
    { key: 'line', header: '#', width: '44px', render: (l) => l.lineNumber },
    { key: 'code', header: 'Code', render: (l) => <span style={{ fontSize: 11.5, color: color.textSecondary }}>{l.itemCode}</span> },
    {
      key: 'desc', header: 'Description',
      render: (l) => (
        <div>
          <div>{l.description}</div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 1 }}>{l.specification}</div>
        </div>
      ),
    },
    { key: 'qty', header: 'Qty', numeric: true, render: (l) => l.quantity.toLocaleString() },
    { key: 'uom', header: 'UoM', render: (l) => l.uom },
    { key: 'delivery', header: 'Delivery', render: (l) => <span style={{ fontSize: 11.5 }}>{l.deliveryLocation}</span> },
    {
      key: 'baseline', header: 'Baseline', numeric: true,
      render: (l) =>
        l.baselinePrice === null ? (
          <span style={{ color: color.textMuted }}>none</span>
        ) : (
          <span title={`Source: ${l.baselineSource}`}>
            {money(l.baselinePrice, l.currency)}
            <span style={{ fontSize: 9.5, color: color.textSecondary, marginLeft: 4 }}>{l.baselineSource}</span>
          </span>
        ),
    },
    {
      key: 'extended', header: 'Extended', numeric: true,
      render: (l) => <strong>{money((l.baselinePrice ?? 0) * l.quantity, l.currency)}</strong>,
    },
    {
      key: 'flags', header: '', width: '90px',
      render: (l) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {l.isOptional && <Chip tone="neutral" title="Optional line">opt</Chip>}
          {l.allowAlternate && <Chip tone="info" title="Alternates permitted">alt</Chip>}
        </span>
      ),
    },
    {
      key: 'trace', header: 'PR line', width: '100px',
      render: (l) => (
        <span style={{ fontSize: 11, color: color.textSecondary }} title="Every award line traces back to this requisition line">
          {l.sourcePrLineId ?? '—'}
        </span>
      ),
    },
  ];

  const timelineSpan = React.useMemo(() => {
    const closes = lots.map((l) => l.biddingCloseAt).filter((v): v is number => v !== null);
    const opens = lots.map((l) => l.biddingOpenAt).filter((v): v is number => v !== null);
    if (closes.length === 0 || opens.length === 0) return null;
    return { start: Math.min(...opens), end: Math.max(...closes) };
  }, [lots]);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Card
        title="Lot strategy"
        hint="Independent, serial, parallel or staggered. Per-lot states run in parallel."
        action={
          <Segmented
            value={strategy}
            onChange={(next) => {
              setStrategy(next);
              dispatch({ type: 'UPDATE_AUCTION', patch: { lotStrategy: next } });
            }}
            options={[
              { value: 'INDEPENDENT', label: 'Independent' },
              { value: 'SERIAL', label: 'Serial' },
              { value: 'PARALLEL', label: 'Parallel' },
              { value: 'STAGGERED', label: 'Staggered' },
            ]}
          />
        }
      >
        {strategy === 'STAGGERED' && timelineSpan && (
          <div style={{ marginBottom: 14 }}>
            <ValidationBanner tone="info" title="Staggered schedule">
              All lots open together and each closes at its own offset. The timeline below is the check
              — a staggered schedule is easy to misconfigure and hard to verify as a list of times.
            </ValidationBanner>
            <div className="rfx-stack" style={{ marginTop: 12, gap: 8 }}>
              {lots.map((lotItem, i) => {
                const total = timelineSpan.end - timelineSpan.start;
                const open = lotItem.biddingOpenAt ?? timelineSpan.start;
                const close = lotItem.biddingCloseAt ?? timelineSpan.end;
                const left = total === 0 ? 0 : ((open - timelineSpan.start) / total) * 100;
                const width = total === 0 ? 100 : ((close - open) / total) * 100;
                const tint = [color.brandPrimary, color.accentPurple, color.info][i % 3];
                return (
                  <div key={lotItem.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 110, fontSize: 11.5, flexShrink: 0 }}>{lotItem.name}</span>
                    <span style={{ flex: 1, minWidth: 0, height: 20, background: color.neutralSoft, borderRadius: radius.pill, position: 'relative' }}>
                      <span
                        style={{
                          position: 'absolute', left: `${left}%`, width: `${width}%`, top: 0, bottom: 0,
                          background: tint, borderRadius: radius.pill, opacity: 0.85,
                        }}
                      />
                    </span>
                    <span style={{ width: 90, fontSize: 11, color: color.textSecondary, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      closes {new Date(close).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {lots.map((lotItem) => (
            <button
              key={lotItem.id}
              type="button"
              onClick={() => setSelectedLot(lotItem.id)}
              style={{
                border: `1px solid ${selectedLot === lotItem.id ? color.brandPrimary : color.border}`,
                background: selectedLot === lotItem.id ? '#F5F8FF' : '#fff',
                borderRadius: radius.control, padding: '8px 12px', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: selectedLot === lotItem.id ? color.brandPrimary : color.textPrimary }}>
                {lotItem.name}
              </div>
              <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
                {lines.filter((l) => l.lotId === lotItem.id).length} lines · {lotItem.awardMode === 'SPLIT' ? 'split award' : 'single winner'}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {lot && (
        <Card
          title="Price controls"
          hint="Four distinct concepts, and they are not interchangeable. Target and reserve are internal-only."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 12 }}>
            <Field label="Ceiling price" hint="Hard bound. A bid above this is rejected at entry.">
              <CurrencyInput
                value={lot.ceilingPrice ?? ''}
                onChange={(e) => dispatch({ type: 'UPDATE_LOT', lotId: lot.id, patch: { ceilingPrice: Number(e.target.value) || null } })}
              />
            </Field>
            <Field label="Floor price" hint="Hard bound. A bid below this is rejected at entry.">
              <CurrencyInput
                value={lot.floorPrice ?? ''}
                onChange={(e) => dispatch({ type: 'UPDATE_LOT', lotId: lot.id, patch: { floorPrice: Number(e.target.value) || null } })}
              />
            </Field>
            <Field
              label="Target price"
              lockedBy="internal"
              hint="Drives traffic-light feedback. Never a hard constraint, never disclosed by default."
            >
              <CurrencyInput
                value={lot.targetPrice ?? ''}
                onChange={(e) => dispatch({ type: 'UPDATE_LOT', lotId: lot.id, patch: { targetPrice: Number(e.target.value) || null } })}
              />
            </Field>
            <Field
              label="Reserve price"
              lockedBy="internal"
              hint="The worst price at which we will award. Constrains the award, not the bidding."
            >
              <CurrencyInput
                value={lot.reservePrice ?? ''}
                onChange={(e) => dispatch({ type: 'UPDATE_LOT', lotId: lot.id, patch: { reservePrice: Number(e.target.value) || null } })}
              />
            </Field>
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: color.textSecondary }}>
            Target derivation on record: <strong>{state.auction.auction.targetPriceDerivation ?? 'not stated'}</strong>.
            {state.auction.auction.targetPriceDerivation === null && (
              <span style={{ color: color.warningText }}> A target with no stated basis is flagged.</span>
            )}
          </div>
        </Card>
      )}

      <Card
        padded={false}
        title={`Line items — ${lot?.name ?? 'all lots'}`}
        hint={`${lotLines.length} line(s). Baselines carry their source, which the savings engine reports against.`}
        action={<Button size="small" variant="secondary">Import from PR</Button>}
      >
        <Table columns={columns} rows={lotLines} rowKey={(l) => l.id} />
      </Card>
    </div>
  );
}
