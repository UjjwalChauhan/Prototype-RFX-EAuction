/**
 * Pack 28, Deliverable 8 — award-quantity adjustment within tolerance.
 *
 * Pack 05 named a post-auction state — *read-only except award-quantity
 * adjustment within tolerance* — and no pack ever built it. This is it.
 *
 * The panel shows four things the buyer needs at once: the current awarded
 * quantity, the proposed one, the delta both absolutely and as a percentage,
 * and the configured tolerance rendered as a bound the input is checked
 * against. Underneath, the two reconciliations that catch the real mistakes:
 * against the line's total quantity, and against the source PR quantity where
 * `Restrict RFQ PO Quantity` is on.
 *
 * Out of tolerance is not an error message — it is a scope change, and it
 * routes to Deliverable 7.
 */
import React from 'react';
import { color, money, radius } from '../../design-system/tokens';
import { Button, Chip, Field, NumberInput, Segmented, Toggle } from '../../design-system/components/primitives';
import { Card } from '../../design-system/components/layout';
import { ValidationBanner } from '../../design-system/components/domain';
import {
  assessQuantityAdjustment, type OpenDecisionSettings, type QuantityAdjustmentInput,
} from '../../domain/nfaLifecycle';

export function QuantityAdjustmentPanel({
  awardedQuantity, lineDescription, lineTotalQuantity, prQuantity, unitPrice, currency,
  tolerancePct, settings, onSettingsChange, onRouteOutOfTolerance, onApply, readOnly,
}: {
  awardedQuantity: number;
  lineDescription: string;
  lineTotalQuantity: number;
  prQuantity: number | null;
  unitPrice: number;
  currency: string;
  tolerancePct: number;
  settings: OpenDecisionSettings;
  onSettingsChange: (patch: Partial<OpenDecisionSettings>) => void;
  onRouteOutOfTolerance: (proposedQuantity: number) => void;
  onApply: (proposedQuantity: number, approvalPath: string) => void;
  readOnly: boolean;
}) {
  const [proposed, setProposed] = React.useState(awardedQuantity);
  const [restrictToPr, setRestrictToPr] = React.useState(true);

  const input: QuantityAdjustmentInput = {
    awardedQuantity,
    proposedQuantity: proposed,
    tolerancePct,
    lineTotalQuantity,
    prQuantity,
    restrictToPrQuantity: restrictToPr,
    unitPrice,
  };
  const result = assessQuantityAdjustment(input, settings);

  return (
    <Card
      title="Award-quantity adjustment"
      hint={`The awarded line is read-only except this. Configured tolerance ±${tolerancePct}%.`}
      action={<Chip tone="neutral">{lineDescription}</Chip>}
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12 }}>
          <Metric label="Currently awarded" value={awardedQuantity.toLocaleString()} />
          <Field label="Proposed quantity" hint={`Bound: ${result.bound.lower.toLocaleString()} – ${result.bound.upper.toLocaleString()}`}>
            <NumberInput
              value={proposed}
              min={0}
              disabled={readOnly}
              invalid={result.blocked}
              onChange={(e) => setProposed(Number(e.target.value))}
            />
          </Field>
          <Metric
            label="Delta"
            value={`${result.deltaAbsolute >= 0 ? '+' : ''}${result.deltaAbsolute.toLocaleString()} · ${result.deltaPct >= 0 ? '+' : ''}${result.deltaPct.toFixed(1)}%`}
            tone={result.blocked ? color.dangerText : result.deltaAbsolute === 0 ? color.textPrimary : color.warningText}
          />
          <Metric
            label="Value movement"
            value={`${result.valueDelta >= 0 ? '+' : ''}${money(Math.abs(result.valueDelta), currency)}`}
            tone={result.valueDelta === 0 ? color.textPrimary : result.valueDelta > 0 ? color.dangerText : color.successText}
          />
        </div>

        {/* The tolerance as a bound, not as a sentence in a tooltip. */}
        <ToleranceBar
          lower={result.bound.lower}
          upper={result.bound.upper}
          awarded={awardedQuantity}
          proposed={proposed}
          within={result.withinTolerance}
        />

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Reconciliation</div>
          <div className="rfx-stack" style={{ gap: 5 }}>
            <Reconcile
              label="Against the line's total quantity"
              detail={`${proposed.toLocaleString()} of ${lineTotalQuantity.toLocaleString()}`}
              ok={proposed <= lineTotalQuantity && proposed >= 0}
            />
            <Reconcile
              label="Against the source requisition quantity"
              detail={
                prQuantity === null
                  ? 'No source PR line — nothing to reconcile against'
                  : restrictToPr
                    ? `${proposed.toLocaleString()} of ${prQuantity.toLocaleString()} (Restrict RFQ PO Quantity is on)`
                    : `${prQuantity.toLocaleString()} on the PR — the restriction is off, so this is informational`
              }
              ok={!restrictToPr || prQuantity === null || proposed <= prQuantity}
            />
          </div>
          <div style={{ marginTop: 9 }}>
            <Toggle
              checked={restrictToPr}
              onChange={setRestrictToPr}
              label="Restrict RFQ PO Quantity"
              disabled={readOnly}
            />
          </div>
        </div>

        <ValidationBanner
          tone={result.blocked ? 'error' : result.approvalPath === 'LOGGED_NO_APPROVAL' ? 'success' : 'warning'}
          title={
            result.blocked ? 'Blocked — this is a scope change, not an adjustment'
            : result.approvalPath === 'LOGGED_NO_APPROVAL' ? 'Within tolerance — logged, no re-approval'
            : result.approvalPath === 'SINGLE_LEVEL' ? 'Within tolerance — one level of approval'
            : 'Within tolerance — the full chain re-runs'
          }
        >
          {result.sentence}
          {result.breaches.length > 1 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {result.breaches.slice(1).map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
        </ValidationBanner>

        {/* OD-05, all three options, side by side. */}
        <div style={{ border: `1px dashed ${color.borderStrong}`, borderRadius: radius.control, padding: '10px 12px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>
            OD-05 · Does an in-tolerance change need re-approval?
          </div>
          <Segmented
            size="small"
            value={settings.od05ToleranceApproval}
            onChange={(value) => onSettingsChange({ od05ToleranceApproval: value })}
            options={[
              { value: 'LOG_ONLY', label: 'Logged only' },
              { value: 'SINGLE_LEVEL', label: 'One level' },
              { value: 'FULL_CHAIN', label: 'Full chain' },
            ]}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setProposed(awardedQuantity)}>Reset</Button>
          {result.blocked ? (
            <Button variant="primary" onClick={() => onRouteOutOfTolerance(proposed)}>
              Where can this go? →
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={readOnly || result.deltaAbsolute === 0}
              onClick={() => onApply(proposed, result.approvalPath)}
            >
              {result.approvalPath === 'LOGGED_NO_APPROVAL' ? 'Apply and log'
                : result.approvalPath === 'SINGLE_LEVEL' ? 'Apply — one approval'
                : 'Apply — re-enters the full chain'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ToleranceBar({
  lower, upper, awarded, proposed, within,
}: { lower: number; upper: number; awarded: number; proposed: number; within: boolean }) {
  // A window wide enough to show the proposal even when it sits outside.
  const span = Math.max(upper - lower, 1);
  const min = Math.min(lower, proposed) - span * 0.15;
  const max = Math.max(upper, proposed) + span * 0.15;
  const at = (value: number) => ((value - min) / (max - min)) * 100;

  return (
    <div>
      <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 6 }}>
        Tolerance window — the input is checked against this bound, not against a warning
      </div>
      <div style={{ position: 'relative', height: 30 }}>
        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: 12, height: 6,
            background: color.neutralSoft, borderRadius: radius.pill,
          }}
        />
        <div
          style={{
            position: 'absolute', top: 12, height: 6, borderRadius: radius.pill,
            left: `${at(lower)}%`, width: `${at(upper) - at(lower)}%`,
            background: color.successSoft, border: `1px solid ${color.success}`,
          }}
        />
        <Tick position={at(awarded)} label={awarded.toLocaleString()} tone={color.textSecondary} />
        <Tick
          position={at(proposed)}
          label={proposed.toLocaleString()}
          tone={within ? color.brandPrimary : color.danger}
          strong
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: color.textSecondary }}>
        <span>{lower.toLocaleString()}</span>
        <span>{upper.toLocaleString()}</span>
      </div>
    </div>
  );
}

function Tick({
  position, label, tone, strong,
}: { position: number; label: string; tone: string; strong?: boolean }) {
  return (
    <span
      style={{
        position: 'absolute', left: `${Math.max(0, Math.min(100, position))}%`,
        top: 4, transform: 'translateX(-50%)', textAlign: 'center',
      }}
    >
      <span style={{ display: 'block', width: 2, height: 22, background: tone, margin: '0 auto' }} />
      <span style={{ fontSize: 10, color: tone, fontWeight: strong ? 700 : 400, whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '9px 11px' }}>
      <div style={{ fontSize: 10.5, color: color.textSecondary }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: tone ?? color.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

function Reconcile({ label, detail, ok }: { label: string; detail: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
      <span
        aria-hidden
        style={{ color: ok ? color.successText : color.dangerText, fontWeight: 700, flexShrink: 0 }}
      >
        {ok ? '✓' : '✕'}
      </span>
      <span>
        {label}
        <span style={{ color: color.textSecondary }}> — {detail}</span>
        <span className="rfx-sr-only">{ok ? 'reconciles' : 'does not reconcile'}</span>
      </span>
    </div>
  );
}
