/**
 * Pack 28, Deliverable 7 — post-NFA scope change: the blocked action and its
 * routing.
 *
 * The surface that answers "can I add this item?". Two rules govern it:
 *
 *   - **Never a disabled control with no explanation, and never a silent
 *     failure.** The panel opens and says plainly why the line cannot join this
 *     award: an award line must trace to a bid, and this item was never quoted.
 *   - **Always at least one legitimate destination.** A dead end is a buyer
 *     improvising, which is exactly what this pack exists to prevent.
 *
 * OD-06 decides how hard the panel steers: manual lists, guided recommends,
 * automatic pre-selects. Nothing is committed without the confirm in any mode.
 */
import React from 'react';
import { color, money, radius } from '../../design-system/tokens';
import { Button, Chip, Segmented } from '../../design-system/components/primitives';
import { Drawer, ValidationBanner } from '../../design-system/components/domain';
import { Progress } from '../../design-system/components/layout';
import {
  scopeChangeRouting, type OpenDecisionSettings, type ScopeChangeContext,
  type ScopeDestinationId,
} from '../../domain/nfaLifecycle';

export function ScopeChangePanel({
  open, onClose, context, settings, onSettingsChange, onRoute,
}: {
  open: boolean;
  onClose: () => void;
  context: ScopeChangeContext;
  settings: OpenDecisionSettings;
  /** The OD-06 switch lives on the panel so the three modes are comparable. */
  onSettingsChange: (patch: Partial<OpenDecisionSettings>) => void;
  /** Hands off to Pack 04's wizard, the call-off, or Pack 05's corrigendum. */
  onRoute: (destination: ScopeDestinationId) => void;
}) {
  const routing = scopeChangeRouting(context, settings);
  const [chosen, setChosen] = React.useState<ScopeDestinationId | null>(routing.preselected);

  // Under AUTOMATIC the recommendation arrives pre-selected; under the other
  // two the buyer starts with nothing chosen.
  React.useEffect(() => {
    setChosen(routing.preselected);
  }, [routing.preselected, open]);

  const originLabel =
    context.origin === 'ITEMS_AND_LOTS' ? 'Items & Lots'
    : context.origin === 'AWARD_SCENARIOS' ? 'the award scenario grid'
    : 'the note for approval';

  return (
    <Drawer
      open={open}
      title={routing.blockedReason}
      subtitle={`Reached from ${originLabel} · ${context.itemDescription}`}
      onClose={onClose}
      width={620}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={chosen === null}
            onClick={() => chosen && onRoute(chosen)}
          >
            {chosen === 'NEW_EVENT' ? 'Open the event wizard, pre-filled'
              : chosen === 'CALL_OFF' ? 'Raise a call-off'
              : chosen === 'CORRIGENDUM' ? 'Open the corrigendum flow'
              : 'Choose a destination'}
          </Button>
        </div>
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <ValidationBanner tone="error" title={routing.blockedReason}>
          {routing.blockedDetail}
        </ValidationBanner>

        <div
          style={{
            border: `1px solid ${color.border}`, borderRadius: radius.control,
            padding: '10px 12px', background: color.surfacePage,
          }}
        >
          <div className="rfx-defrow" style={{ fontSize: 12.5 }}>
            <span style={{ color: color.textSecondary }}>Line</span>
            <span>{context.itemDescription}</span>
          </div>
          <div className="rfx-defrow" style={{ fontSize: 12.5 }}>
            <span style={{ color: color.textSecondary }}>Category</span>
            <span>{context.itemCategory}</span>
          </div>
          <div className="rfx-defrow" style={{ fontSize: 12.5 }}>
            <span style={{ color: color.textSecondary }}>Estimated value</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {money(context.itemValue, context.currency)}
            </span>
          </div>
          <div className="rfx-defrow" style={{ fontSize: 12.5 }}>
            <span style={{ color: color.textSecondary }}>Event status</span>
            <span>{context.eventStatus.replace(/_/g, ' ').toLowerCase()}</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>
            Where this can legitimately go
          </div>
          <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 10 }}>
            {routing.destinations.length} destination(s). A destination that does not apply is absent,
            not disabled — there is nothing useful to say about a route that cannot exist.
          </div>

          <div className="rfx-stack" style={{ gap: 10 }}>
            {routing.destinations.map((destination) => {
              const selected = chosen === destination.id;
              return (
                <button
                  key={destination.id}
                  type="button"
                  onClick={() => setChosen(destination.id)}
                  style={{
                    textAlign: 'left', cursor: 'pointer', width: '100%',
                    border: `1px solid ${selected ? color.brandPrimary : color.border}`,
                    background: selected ? '#F5F8FF' : '#fff',
                    borderRadius: radius.control, padding: '11px 13px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{destination.title}</strong>
                    {destination.recommended && <Chip tone="brand" icon="★">Recommended</Chip>}
                    {selected && routing.mode === 'AUTOMATIC' && (
                      <Chip tone="info" icon="✓">pre-selected — confirm below</Chip>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: color.textBody, marginTop: 5, lineHeight: 1.55 }}>
                    {destination.consequence}
                  </div>
                  {destination.detail && (
                    <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 4 }}>
                      {destination.detail}
                    </div>
                  )}
                  {destination.recommendedBecause && (
                    <div style={{ fontSize: 11, color: color.brandPrimary, marginTop: 4 }}>
                      Recommended because {destination.recommendedBecause}
                    </div>
                  )}
                  {destination.headroom && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: color.textSecondary, marginBottom: 3 }}>
                        Ceiling headroom — {money(destination.headroom.remaining, context.currency)} of{' '}
                        {money(destination.headroom.ceiling, context.currency)} remaining
                      </div>
                      <Progress
                        value={destination.headroom.committed}
                        max={destination.headroom.ceiling}
                      />
                      {destination.headroom.remaining < context.itemValue && (
                        <div style={{ fontSize: 11, color: color.dangerText, marginTop: 4 }}>
                          This line would breach the ceiling, so it is offered as a new sourcing event instead.
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {!routing.destinations.some((d) => d.id === 'CALL_OFF') && (
            <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 10 }}>
              No call-off destination: this award established no rate contract whose category scope covers{' '}
              {context.itemCategory}. The option is absent rather than shown greyed — a route that does not
              exist is not a choice the buyer failed to take.
            </div>
          )}
        </div>

        {/* OD-06 lives on the panel so a client can see all three at once. */}
        <div
          style={{
            border: `1px dashed ${color.borderStrong}`, borderRadius: radius.control,
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>
            OD-06 · How hard should this panel steer?
          </div>
          <Segmented
            size="small"
            value={settings.od06Routing}
            onChange={(value) => onSettingsChange({ od06Routing: value })}
            options={[
              { value: 'MANUAL', label: 'Manual' },
              { value: 'GUIDED', label: 'Guided' },
              { value: 'AUTOMATIC', label: 'Automatic' },
            ]}
          />
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 6 }}>
            {routing.mode === 'MANUAL'
              ? 'Manual: destinations listed flat, nothing recommended, nothing pre-selected.'
              : routing.mode === 'GUIDED'
                ? 'Guided: one destination carries a recommendation and its reason; every other stays selectable.'
                : 'Automatic: the recommendation is pre-selected and pre-filled. The buyer still confirms — nothing commits itself.'}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
