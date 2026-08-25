/**
 * Pack 25 — Configuration Studio, and Pack 26 — DoA matrix & agent console.
 *
 * The scope selector is the point of the studio, not the toggles: multi-tenant
 * sourcing platforms fail on configuration comprehensibility more often than on
 * features. Every setting shows its effective value, the scope it resolved
 * from, whether it is locked, and its inheritance chain.
 *
 * The DoA screen's point is the simulator, not the rules table — you verify a
 * matrix by simulating it.
 */
import React from 'react';
import { color, money, radius } from '../design-system/tokens';
import {
  Button, Chip, Field, NumberInput, Segmented, Select, Toggle,
} from '../design-system/components/primitives';
import { Card, Table, type Column } from '../design-system/components/layout';
import { AgentCard, Drawer, Rail, ToggleCard, ValidationBanner } from '../design-system/components/domain';
import { CONFIG_DOMAINS, SCOPE_LABELS, SCOPE_ORDER, TENANT_DEFAULTS, resolve } from '../domain/config';
import {
  AGENT_HARD_LIMITS, ALL_AGENTS, AUTONOMY_LABELS, AUTONOMY_LEVELS, DEFAULT_MANDATE,
  checkMandate, effectiveAutonomy,
} from '../domain/agents';
import { simulate } from '../domain/doa';
import { useStore } from '../store/store';
import { DOA_RULES, SCOPE_LINEAGE } from '../data/seed';
import type { AutonomyLevel, ConfigScopeType, DoARule } from '../domain/types';

// ---------------------------------------------------------------------------
// Configuration Studio
// ---------------------------------------------------------------------------

const DOMAIN_KEYS: Record<string, string[]> = {
  module: [],
  patterns: [],
  event: ['event.corrigendum_reopens_deadline', 'event.gate_documents_on_acceptance'],
  questionnaire: [],
  evaluation: [
    'evaluation.envelope_mode', 'evaluation.commercial_unlock', 'evaluation.blind_technical',
    'evaluation.technical_gate', 'evaluation.min_technical_score', 'evaluation.consensus_mode',
    'evaluation.divergence_threshold', 'evaluation.disclose_formula',
  ],
  auction: [
    'auction.feedback_policy', 'auction.disclose_target', 'auction.traffic_amber_band_pct',
    'auction.min_decrement', 'auction.max_decrement_pct', 'auction.front_buffer_pct',
    'auction.tie_bid_policy', 'auction.min_bidders_to_start', 'auction.below_min_policy',
    'auction.sniping_threshold_sec', 'auction.identical_bid_window_sec',
    'auction.require_dry_run_first_event',
  ],
  negotiation: ['negotiation.max_rounds'],
  award: ['award.override_doa_uplift', 'award.regret_disclosure', 'award.po_handoff'],
  approval: ['approval.sla_hours'],
  counterparty: ['counterparty.provisional_award_allowed'],
  agents: ['agents.disclose_ai_scoring_to_suppliers'],
  notifications: [],
  portal: [],
  audit: [],
};

const SETTING_HINTS: Record<string, string> = {
  'evaluation.envelope_mode': 'Two-envelope seals the commercial response until the technical evaluation completes.',
  'evaluation.blind_technical': 'Evaluators see "Bidder A" rather than the company name, to reduce incumbency bias.',
  'evaluation.commercial_unlock': 'Witnessed unlock requires two authorised users, and records both.',
  'auction.feedback_policy': 'The single biggest determinant of bidder behaviour, and a data boundary.',
  'auction.disclose_target': 'Off by default. A target price is an internal objective, not a published figure.',
  'auction.min_decrement': 'Prevents penny bidding.',
  'auction.max_decrement_pct': 'Fat-finger and gaming guard.',
  'auction.front_buffer_pct': 'A band ahead of the lead bid in which competing bids are rejected.',
  'auction.min_bidders_to_start': 'Below three bidders an auction is the wrong instrument.',
  'award.override_doa_uplift': 'Awarding other than rank 1 adds this many approval levels automatically.',
  'award.regret_disclosure': 'What a regretted bidder is told about their position.',
  'counterparty.provisional_award_allowed': 'A provisional counterparty can bid; awarding one needs this on.',
  'agents.disclose_ai_scoring_to_suppliers': 'Suppliers are told when their response is AI-scored.',
};

export function ConfigurationStudio() {
  const { state, dispatch } = useStore();
  const [domain, setDomain] = React.useState('auction');
  const [scope, setScope] = React.useState<ConfigScopeType>('EVENT');
  const [chainKey, setChainKey] = React.useState<string | null>(null);

  const keys = DOMAIN_KEYS[domain] ?? [];

  const lineage = {
    tenantId: SCOPE_LINEAGE.tenantId,
    categoryId: scope === 'TENANT' ? null : SCOPE_LINEAGE.categoryId,
    templateId: scope === 'TENANT' || scope === 'CATEGORY' ? null : SCOPE_LINEAGE.templateId,
    eventId: scope === 'EVENT' ? SCOPE_LINEAGE.eventId : null,
  };

  const resolved = keys.map((key) =>
    resolve(key, state.configSettings, lineage, TENANT_DEFAULTS[key]),
  );

  const chainSetting = chainKey
    ? resolve(chainKey, state.configSettings, lineage, TENANT_DEFAULTS[chainKey])
    : null;

  const setValue = (key: string, value: unknown) => {
    dispatch({
      type: 'SET_CONFIG',
      setting: {
        key, scopeType: scope,
        scopeId:
          scope === 'TENANT' ? SCOPE_LINEAGE.tenantId
          : scope === 'CATEGORY' ? SCOPE_LINEAGE.categoryId
          : scope === 'TEMPLATE' ? SCOPE_LINEAGE.templateId
          : SCOPE_LINEAGE.eventId,
        value, isLocked: false, setBy: state.currentUser.id, setAt: Date.now(),
      },
    });
  };

  return (
    <div className="rfx-nav">
      <Rail
        title="Domains"
        activeId={domain}
        onSelect={setDomain}
        items={CONFIG_DOMAINS.map((d) => ({
          id: d.key,
          label: d.label,
          badge:
            (DOMAIN_KEYS[d.key]?.length ?? 0) > 0
              ? <Chip tone="neutral">{DOMAIN_KEYS[d.key].length}</Chip>
              : undefined,
        }))}
      />

      <div className="rfx-stack" style={{ gap: 14 }}>
        {/* The scope selector — the point of this screen. */}
        <Card
          title="Configuration scope"
          hint="The narrowest scope that defines a value wins, unless a broader scope locked it."
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {SCOPE_ORDER.map((s, i) => (
              <React.Fragment key={s}>
                <button
                  type="button"
                  onClick={() => setScope(s)}
                  style={{
                    border: `1px solid ${scope === s ? color.brandPrimary : color.border}`,
                    background: scope === s ? color.brandPrimarySoft : '#fff',
                    color: scope === s ? color.brandPrimary : color.textBody,
                    borderRadius: radius.control, padding: '9px 14px', cursor: 'pointer',
                    fontSize: 12.5, fontWeight: scope === s ? 600 : 400, textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'block' }}>{SCOPE_LABELS[s]}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: color.textSecondary, marginTop: 2 }}>
                    {s === 'TENANT' ? 'tenant-udaan'
                      : s === 'CATEGORY' ? SCOPE_LINEAGE.categoryId
                      : s === 'TEMPLATE' ? 'Full Ladder'
                      : 'RFQ-2026-0142'}
                  </span>
                </button>
                {i < SCOPE_ORDER.length - 1 && (
                  <span aria-hidden style={{ color: color.textMuted, fontSize: 14 }}>▸</span>
                )}
              </React.Fragment>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 12, lineHeight: 1.6 }}>
            You are editing at <strong>{SCOPE_LABELS[scope]}</strong> scope. Settings shown below display
            the effective value at this scope, where it came from, and whether it can be changed here.
          </div>
        </Card>

        {keys.length === 0 ? (
          <Card>
            <div style={{ padding: '28px 8px', textAlign: 'center' }}>
              <div aria-hidden style={{ fontSize: 24 }}>⚙</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>
                {CONFIG_DOMAINS.find((d) => d.key === domain)?.label}
              </div>
              <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 6, maxWidth: 420, marginInline: 'auto', lineHeight: 1.6 }}>
                This domain has no scalar settings wired in this build. The domains with settings —
                evaluation, auction, negotiation, award, approval, counterparty and agents — demonstrate
                the resolution model end to end.
              </div>
            </div>
          </Card>
        ) : (
          <div className="rfx-stack" style={{ gap: 10 }}>
            {resolved.map((setting) => {
              // A value locked at a broader scope is read-only here.
              const editableHere =
                !setting.isLocked ||
                SCOPE_ORDER.indexOf(setting.lockedBy ?? 'TENANT') >= SCOPE_ORDER.indexOf(scope);

              return (
                <ToggleCard
                  key={setting.key}
                  title={setting.key}
                  description={SETTING_HINTS[setting.key]}
                  resolvedFrom={SCOPE_LABELS[setting.resolvedFrom]}
                  isLocked={setting.isLocked}
                  lockedBy={setting.lockedBy ? SCOPE_LABELS[setting.lockedBy] : null}
                  onViewChain={() => setChainKey(setting.key)}
                >
                  <SettingControl
                    value={setting.value}
                    disabled={!editableHere}
                    onChange={(next) => setValue(setting.key, next)}
                    settingKey={setting.key}
                  />
                </ToggleCard>
              );
            })}
          </div>
        )}
      </div>

      <Drawer
        open={chainKey !== null}
        title="Inheritance chain"
        subtitle={chainKey ?? ''}
        onClose={() => setChainKey(null)}
      >
        {chainSetting && (
          <div className="rfx-stack" style={{ gap: 12 }}>
            <ValidationBanner tone="info" title={`Effective value: ${String(chainSetting.value)}`}>
              Resolved from <strong>{SCOPE_LABELS[chainSetting.resolvedFrom]}</strong>
              {chainSetting.isLocked && chainSetting.lockedBy && (
                <> and locked at <strong>{SCOPE_LABELS[chainSetting.lockedBy]}</strong>, so no narrower
                scope can override it.</>
              )}
            </ValidationBanner>

            <div className="rfx-stack" style={{ gap: 8 }}>
              {chainSetting.chain.map((link) => {
                const isSource = link.scopeType === chainSetting.resolvedFrom;
                const defined = link.value !== undefined;
                return (
                  <div
                    key={link.scopeType}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      border: `1px solid ${isSource ? color.brandPrimary : color.border}`,
                      background: isSource ? color.brandPrimarySoft : '#fff',
                      borderRadius: radius.control, padding: '10px 12px',
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 13 }}>
                      {link.isLocked ? '🔒' : defined ? '●' : '○'}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: isSource ? 600 : 400 }}>
                      {SCOPE_LABELS[link.scopeType]}
                    </span>
                    <span style={{ fontSize: 12, color: defined ? color.textPrimary : color.textMuted }}>
                      {defined ? String(link.value) : 'not set'}
                    </span>
                    {isSource && <Chip tone="brand">in force</Chip>}
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.6 }}>
              ● defined at this scope · ○ inherited · 🔒 locked, no narrower override permitted.
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function SettingControl({
  value, disabled, onChange, settingKey,
}: { value: unknown; disabled: boolean; onChange: (next: unknown) => void; settingKey: string }) {
  if (typeof value === 'boolean') {
    return (
      <Toggle
        checked={value}
        onChange={onChange}
        disabled={disabled}
        disabledReason={disabled ? 'Locked at a broader scope.' : undefined}
        label={value ? 'On' : 'Off'}
      />
    );
  }
  if (typeof value === 'number') {
    return (
      <div style={{ width: 110 }}>
        <NumberInput
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    );
  }

  const options: Record<string, string[]> = {
    'evaluation.envelope_mode': ['SINGLE', 'TWO_ENVELOPE'],
    'evaluation.commercial_unlock': ['AUTO', 'MANUAL', 'MANUAL_WITH_WITNESS'],
    'evaluation.technical_gate': ['NONE', 'MIN_SCORE', 'PASS_FAIL', 'BOTH'],
    'evaluation.consensus_mode': ['SINGLE', 'AVERAGE', 'MODERATED'],
    'auction.feedback_policy': ['FULL_PRICE', 'BEST_PRICE', 'RANK_ONLY', 'RANK_GAP', 'TRAFFIC_LIGHT', 'BLIND'],
    'auction.tie_bid_policy': ['FIRST_IN_WINS', 'SPLIT', 'TIE_BREAK_ROUND', 'BUYER_DECIDES'],
    'auction.below_min_policy': ['BLOCK', 'WARN_AND_JUSTIFY', 'ALLOW'],
    'award.regret_disclosure': ['NONE', 'RANK_ONLY', 'RANK_AND_GAP', 'FULL'],
    'award.po_handoff': ['INTERNAL', 'ERP_HANDOFF', 'HYBRID'],
  };

  const list = options[settingKey];
  if (list) {
    return (
      <div style={{ width: 190 }}>
        <Select value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {list.map((option) => <option key={option} value={option}>{option}</option>)}
        </Select>
      </div>
    );
  }

  return <span style={{ fontSize: 12.5, fontWeight: 600 }}>{String(value)}</span>;
}

// ---------------------------------------------------------------------------
// Pack 26 — DoA matrix and agent console
// ---------------------------------------------------------------------------

export function DoaAndAgents() {
  const [pane, setPane] = React.useState<'doa' | 'agents'>('doa');

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Segmented
        value={pane}
        onChange={setPane}
        options={[
          { value: 'doa', label: 'DoA matrix & simulator' },
          { value: 'agents', label: 'Agent console' },
        ]}
      />
      {pane === 'doa' ? <DoaSimulator /> : <AgentConsole />}
    </div>
  );
}

function DoaSimulator() {
  const [value, setValue] = React.useState(150_000);
  const [category, setCategory] = React.useState('Indirect');
  const [businessUnit, setBusinessUnit] = React.useState('Corporate Services');
  const [rankOverride, setRankOverride] = React.useState(false);

  const result = simulate(DOA_RULES, { value, category, businessUnit }, { rankOverride, upliftLevels: 1 });

  const ruleColumns: Column<DoARule>[] = [
    { key: 'name', header: 'Rule', render: (rule) => <strong style={{ fontSize: 12.5 }}>{rule.name}</strong> },
    {
      key: 'range', header: 'Value range', numeric: true,
      render: (rule) => `${money(rule.minValue)} – ${rule.maxValue === null ? '∞' : money(rule.maxValue)}`,
    },
    { key: 'category', header: 'Category', render: (rule) => rule.category ?? <span style={{ color: color.textMuted }}>any</span> },
    { key: 'bu', header: 'Business unit', render: (rule) => rule.businessUnit ?? <span style={{ color: color.textMuted }}>any</span> },
    { key: 'levels', header: 'Levels', numeric: true, render: (rule) => rule.levels.length },
    { key: 'mode', header: 'Chain', render: (rule) => <Chip tone="neutral">{rule.chainMode.toLowerCase()}</Chip> },
    {
      key: 'match', header: '', width: '110px',
      render: (rule) => {
        const trace = result.trace.find((t) => t.rule.id === rule.id);
        return trace?.matched ? <Chip tone="brand" icon="✓">matched</Chip> : null;
      },
    },
  ];

  return (
    <div className="rfx-side">
      <div className="rfx-stack" style={{ gap: 14 }}>
        <ValidationBanner tone="info" title="You verify a matrix by simulating it">
          The simulator on the right is the point of this screen. The rules table below is reference —
          reading it does not tell you what a given award will actually require.
        </ValidationBanner>

        <Card padded={false} title="Rules" hint="The first matching rule wins.">
          <Table
            columns={ruleColumns}
            rows={DOA_RULES}
            rowKey={(rule) => rule.id}
            rowStyle={(rule) =>
              result.matchedRule?.id === rule.id ? { background: color.brandPrimarySoft } : undefined
            }
          />
        </Card>

        <Card title="Why each rule did or did not match">
          <div className="rfx-stack" style={{ gap: 8 }}>
            {result.trace.map((trace) => (
              <div
                key={trace.rule.id}
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  border: `1px solid ${trace.matched ? '#86EFAC' : color.border}`,
                  background: trace.matched ? '#F0FDF4' : '#fff',
                  borderRadius: radius.control, padding: '9px 12px',
                }}
              >
                <span
                  aria-hidden
                  style={{ color: trace.matched ? color.successText : color.textMuted, fontWeight: 700, fontSize: 13 }}
                >
                  {trace.matched ? '✓' : '✕'}
                </span>
                <span style={{ fontSize: 12 }}>
                  <strong>{trace.rule.name}</strong>
                  <span style={{ color: color.textSecondary }}> — {trace.reason}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Simulate an award">
          <div className="rfx-stack" style={{ gap: 12 }}>
            <Field label="Award value">
              <NumberInput value={value} onChange={(e) => setValue(Number(e.target.value))} />
            </Field>
            <Field label="Category">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {['Indirect', 'IT', 'Facilities', 'Services', 'Fleet'].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Business unit">
              <Select value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)}>
                {['Corporate Services', 'Technology', 'Marketing', 'Fleet'].map((b) => <option key={b}>{b}</option>)}
              </Select>
            </Field>
            <Toggle
              checked={rankOverride}
              onChange={setRankOverride}
              label="Awarding other than rank 1"
            />
          </div>
        </Card>

        <Card
          title="Resolved chain"
          hint={
            result.matchedRule
              ? `${result.chain.length} level(s) · total SLA ${result.totalSlaHours}h`
              : 'No rule matches these facts.'
          }
        >
          {result.matchedRule === null ? (
            <ValidationBanner tone="error" title="No rule matches">
              An award with these facts cannot be routed. Add a rule covering this value band before an
              NFA is raised, or the award will stall.
            </ValidationBanner>
          ) : (
            <div className="rfx-stack" style={{ gap: 8 }}>
              {result.upliftApplied && (
                <ValidationBanner tone="warning" title="Uplift applied">
                  Awarding other than rank 1 adds one level automatically.
                </ValidationBanner>
              )}
              {result.chain.map((level) => (
                <div
                  key={level.level}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '9px 11px',
                  }}
                >
                  <span
                    style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      background: color.neutralSoft, color: color.textSecondary,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10.5, fontWeight: 700,
                    }}
                  >
                    L{level.level}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                    <span style={{ display: 'block', fontWeight: 500 }}>{level.role}</span>
                    <span style={{ display: 'block', fontSize: 11, color: color.textSecondary }}>
                      {level.holderName}
                    </span>
                  </span>
                  <Chip tone="neutral">{level.slaHours}h</Chip>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Hard rule">
          <div style={{ fontSize: 12, color: color.textBody, lineHeight: 1.65 }}>
            No user can hold both <code>recommend_award</code> and the final{' '}
            <code>approve_at_level_n</code> on the same event, and no agent may approve any step in a
            DoA chain. Neither is configurable.
          </div>
        </Card>
      </div>
    </div>
  );
}

function AgentConsole() {
  const { state, dispatch } = useStore();
  const [levels, setLevels] = React.useState<Record<string, AutonomyLevel>>(() =>
    Object.fromEntries(ALL_AGENTS.map((agent) => [agent.code, agent.defaultAutonomy])),
  );
  const [mandateOpen, setMandateOpen] = React.useState<string | null>(null);

  const mandateCheck = checkMandate(DEFAULT_MANDATE, {
    value: 150_000, category: 'Indirect', roundNumber: 1, confidence: 0.82, proposedPrice: null,
  });

  return (
    <div className="rfx-side">
      <div className="rfx-stack" style={{ gap: 14 }}>
        {state.agentKillSwitch.engaged && (
          <ValidationBanner
            tone="error"
            title="Kill switch engaged — every agent below is halted"
            action={<Button size="small" variant="secondary" onClick={() => dispatch({ type: 'RELEASE_KILL_SWITCH' })}>Release</Button>}
          >
            Engaged by {state.agentKillSwitch.by}. Its prominence is deliberate: a kill switch you
            cannot find is not a control.
          </ValidationBanner>
        )}

        <Card
          title="The sixteen agents"
          hint="Discrete, named and individually toggleable — deliberately not one general assistant."
          action={
            <Button
              variant={state.agentKillSwitch.engaged ? 'secondary' : 'destructive'}
              size="small"
              onClick={() =>
                state.agentKillSwitch.engaged
                  ? dispatch({ type: 'RELEASE_KILL_SWITCH' })
                  : dispatch({ type: 'ENGAGE_KILL_SWITCH', by: state.currentUser.name })
              }
            >
              {state.agentKillSwitch.engaged ? 'Release kill switch' : '⛔ Kill switch'}
            </Button>
          }
        >
          <div className="rfx-stack" style={{ gap: 9 }}>
            {ALL_AGENTS.map((agent) => {
              const configured = levels[agent.code];
              const effective = state.agentKillSwitch.engaged
                ? 'OFF'
                : effectiveAutonomy(configured, agent, null, DEFAULT_MANDATE.confidenceThreshold);
              const capped = AUTONOMY_LEVELS.indexOf(configured) > AUTONOMY_LEVELS.indexOf(agent.maxAutonomy);
              return (
                <div
                  key={agent.code}
                  style={{
                    border: `1px solid ${color.border}`, borderRadius: radius.control,
                    padding: '11px 13px',
                    opacity: state.agentKillSwitch.engaged ? 0.55 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <Chip tone="purple">{agent.code}</Chip>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{agent.name}</span>
                    <Chip tone="neutral">{agent.stage}</Chip>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Select
                        value={configured}
                        disabled={state.agentKillSwitch.engaged}
                        onChange={(e) =>
                          setLevels((l) => ({ ...l, [agent.code]: e.target.value as AutonomyLevel }))
                        }
                        style={{ width: 175, fontSize: 12 }}
                      >
                        {AUTONOMY_LEVELS.map((level) => (
                          <option
                            key={level}
                            value={level}
                            disabled={AUTONOMY_LEVELS.indexOf(level) > AUTONOMY_LEVELS.indexOf(agent.maxAutonomy)}
                          >
                            {AUTONOMY_LABELS[level]}
                            {AUTONOMY_LEVELS.indexOf(level) > AUTONOMY_LEVELS.indexOf(agent.maxAutonomy) ? ' — capped' : ''}
                          </option>
                        ))}
                      </Select>
                      <Button size="small" variant="secondary" onClick={() => setMandateOpen(agent.code)}>
                        Mandate
                      </Button>
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 5, lineHeight: 1.55 }}>
                    {agent.mandate}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Chip tone={effective === 'OFF' ? 'neutral' : 'brand'}>
                      running at {AUTONOMY_LABELS[effective]}
                    </Chip>
                    <Chip tone="neutral">max {AUTONOMY_LABELS[agent.maxAutonomy]}</Chip>
                    {capped && <Chip tone="gold" icon="⚑">request exceeds cap — capped</Chip>}
                  </div>
                  <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 6 }}>
                    Cannot: {agent.cannot.join(' · ')}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Hard limits" hint="Not configurable at any scope, for any agent.">
          <div className="rfx-stack" style={{ gap: 8 }}>
            {AGENT_HARD_LIMITS.map((limit) => (
              <div key={limit} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span aria-hidden style={{ color: color.dangerText, fontSize: 12, fontWeight: 700, marginTop: 1 }}>✕</span>
                <span style={{ fontSize: 11.5, color: color.textBody, lineHeight: 1.5 }}>{limit}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 12, lineHeight: 1.6 }}>
            These appear as permanently-disabled, explained controls throughout the product — visible so
            administrators understand the boundary rather than wondering whether it exists.
          </div>
        </Card>

        <Card title="Mandate — applies to every acting agent">
          <div className="rfx-stack" style={{ gap: 9, fontSize: 12 }}>
            {[
              ['Value ceiling', DEFAULT_MANDATE.valueCeiling === null ? 'none' : money(DEFAULT_MANDATE.valueCeiling)],
              ['Category scope', DEFAULT_MANDATE.categoryScope.join(', ') || 'any'],
              ['Max rounds', String(DEFAULT_MANDATE.maxRounds ?? 'unlimited')],
              ['Confidence threshold', `${(DEFAULT_MANDATE.confidenceThreshold * 100).toFixed(0)}%`],
              ['Time window', DEFAULT_MANDATE.timeWindow ?? 'any'],
              ['Escalates to', DEFAULT_MANDATE.escalateTo],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: color.textSecondary }}>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            {mandateCheck.withinMandate ? (
              <ValidationBanner tone="success" title="A $150k Indirect action is within mandate" />
            ) : (
              <ValidationBanner tone="warning" title="Outside mandate — would escalate">
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {mandateCheck.breaches.map((breach) => <li key={breach}>{breach}</li>)}
                </ul>
              </ValidationBanner>
            )}
          </div>
        </Card>

        <AgentCard
          code="AG-15"
          name="Event Retrospective"
          autonomy="AUTONOMOUS"
          confidence={null}
          summary="Across the last 12 events, agent suggestions were accepted 71% of the time, modified 19% and rejected 10%. The highest modification rate is AG-07 commercial normalisation on freight."
          evidence={[
            { label: 'Agent quality dashboard', detail: '12 events, 148 agent actions' },
            { label: 'Modification capture', detail: 'AG-07 freight adjusted in 9 of 12 events' },
          ]}
        />
      </div>

      <Drawer
        open={mandateOpen !== null}
        title={mandateOpen ? `${mandateOpen} mandate` : ''}
        subtitle="Frozen onto every action this agent takes"
        onClose={() => setMandateOpen(null)}
      >
        {mandateOpen && (
          <div className="rfx-stack" style={{ gap: 14 }}>
            <div style={{ fontSize: 12.5, color: color.textBody, lineHeight: 1.65 }}>
              {ALL_AGENTS.find((a) => a.code === mandateOpen)?.mandate}
            </div>
            <div className="rfx-stack" style={{ gap: 12 }}>
              <Field label="Value ceiling">
                <NumberInput defaultValue={DEFAULT_MANDATE.valueCeiling ?? 0} />
              </Field>
              <Field label="Max rounds">
                <NumberInput defaultValue={DEFAULT_MANDATE.maxRounds ?? 0} />
              </Field>
              <Field label="Confidence threshold (%)" hint="Below this, an acting agent degrades to suggesting.">
                <NumberInput defaultValue={DEFAULT_MANDATE.confidenceThreshold * 100} />
              </Field>
              <Field label="Escalates to">
                <Select defaultValue={DEFAULT_MANDATE.escalateTo}>
                  {['Category Manager', 'Head of Procurement', 'Finance Director'].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <ValidationBanner tone="info" title="Every action records its mandate">
              An AgentAction stores the mandate snapshot at execution, so a decision can be audited
              against the rules that applied at the time rather than today's.
            </ValidationBanner>
          </div>
        )}
      </Drawer>
    </div>
  );
}
