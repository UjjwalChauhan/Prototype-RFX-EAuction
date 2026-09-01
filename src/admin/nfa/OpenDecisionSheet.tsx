/**
 * Pack 28, Deliverable 10 — the open-decision surface.
 *
 * Nine decisions in §B14.8 are unresolved and several change these screens.
 * This is the single annotated sheet: each decision, the deliverable it belongs
 * to, every option, and what the screen looks like under each — so a client can
 * settle the register by pointing at pictures rather than reading a table.
 *
 * It is not a footnote. Selecting an option here **actually flips the screens**
 * behind it, so "what does it look like?" is answered by closing the sheet and
 * looking rather than by imagining.
 */
import { color, radius } from '../../design-system/tokens';
import { Button, Chip } from '../../design-system/components/primitives';
import { Drawer } from '../../design-system/components/domain';
import {
  DEFAULT_OPEN_DECISIONS, OPEN_DECISIONS, type OpenDecisionSettings,
} from '../../domain/nfaLifecycle';

export function OpenDecisionSheet({
  open, onClose, settings, onChange,
}: {
  open: boolean;
  onClose: () => void;
  settings: OpenDecisionSettings;
  onChange: (patch: Partial<OpenDecisionSettings>) => void;
}) {
  const changed = OPEN_DECISIONS.filter(
    (d) => settings[d.settingKey] !== DEFAULT_OPEN_DECISIONS[d.settingKey],
  ).length;

  return (
    <Drawer
      open={open}
      title="Open decisions — PRD §B14.8"
      subtitle={`Nine decisions, ${OPEN_DECISIONS.filter((d) => d.changesTheScreen).length} of which change a screen in this pack. Choosing here changes the screens behind this sheet.`}
      onClose={onClose}
      width={720}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: color.textSecondary }}>
            {changed === 0
              ? 'Every decision is on its provisional default.'
              : `${changed} decision(s) moved off the provisional default.`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => onChange(DEFAULT_OPEN_DECISIONS)}>
              Reset to defaults
            </Button>
            <Button variant="primary" onClick={onClose}>Close</Button>
          </div>
        </div>
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        {OPEN_DECISIONS.map((decision) => {
          const current = settings[decision.settingKey] as string;
          const isDefault = current === (DEFAULT_OPEN_DECISIONS[decision.settingKey] as string);
          return (
            <div
              key={decision.id}
              style={{
                border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '13px 15px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{decision.id}</strong>
                {decision.changesTheScreen
                  ? <Chip tone="brand" icon="◱">changes the screen</Chip>
                  : <Chip tone="neutral" icon="○">copy and permissions only</Chip>}
                <Chip tone="neutral">{decision.deliverable}</Chip>
                {!isDefault && <Chip tone="gold" icon="✎">moved off default</Chip>}
              </div>

              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 7 }}>{decision.question}</div>

              <div className="rfx-stack" style={{ gap: 8, marginTop: 10 }}>
                {decision.options.map((option) => {
                  const selected = option.value === current;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onChange({ [decision.settingKey]: option.value } as Partial<OpenDecisionSettings>)}
                      style={{
                        textAlign: 'left', cursor: 'pointer', width: '100%',
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        border: `1px solid ${selected ? color.brandPrimary : color.border}`,
                        background: selected ? '#F5F8FF' : '#fff',
                        borderRadius: radius.control, padding: '10px 12px',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 15, height: 15, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                          border: `2px solid ${selected ? color.brandPrimary : color.borderStrong}`,
                          background: selected ? color.brandPrimary : '#fff',
                          boxShadow: selected ? 'inset 0 0 0 2.5px #fff' : 'none',
                        }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>
                          {option.label}
                        </span>
                        <span
                          style={{
                            display: 'block', fontSize: 11.5, color: color.textSecondary,
                            marginTop: 3, lineHeight: 1.55,
                          }}
                        >
                          {option.screenEffect}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div
          style={{
            border: `1px dashed ${color.borderStrong}`, borderRadius: radius.control,
            padding: '11px 13px', fontSize: 11.5, color: color.textSecondary, lineHeight: 1.6,
          }}
        >
          Nothing on this sheet is decided. The values here are provisional defaults chosen so the
          prototype has something to render — each one is a question for the client, and every option
          listed is reachable from the screens behind this drawer.
        </div>
      </div>
    </Drawer>
  );
}
