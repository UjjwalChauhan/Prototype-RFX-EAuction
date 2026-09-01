/**
 * Pack 00 §2 — primitives. C-PILL, C-CHIP, buttons, inputs, selection controls.
 */
import React from 'react';
import { color, font, radius, type } from '../tokens';
import type { StatusPresentation } from '../../domain/statusMachine';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'icon';
export type ButtonSize = 'small' | 'medium';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: color.brandPrimary, color: '#fff', border: '1px solid transparent' },
  secondary: { background: '#fff', color: color.textBody, border: `1px solid ${color.border}` },
  tertiary: { background: 'transparent', color: color.brandPrimary, border: '1px solid transparent' },
  destructive: { background: color.danger, color: '#fff', border: '1px solid transparent' },
  icon: { background: '#fff', color: color.textBody, border: `1px solid ${color.border}`, padding: '6px 9px' },
};

export function Button({
  variant = 'secondary', size = 'medium', loading, children, style, disabled, ...rest
}: ButtonProps) {
  const pad = size === 'small' ? '5px 11px' : '8px 14px';
  const fontSize = size === 'small' ? 12 : 13;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{
        ...BUTTON_VARIANTS[variant],
        borderRadius: radius.control,
        padding: variant === 'icon' ? '6px 9px' : pad,
        fontSize,
        fontWeight: 600,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.55 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {loading && (
        <span
          aria-hidden
          style={{
            width: 11, height: 11, borderRadius: '50%',
            border: '2px solid rgba(255,255,255,.4)',
            borderTopColor: '#fff',
            animation: 'rfx-spin .7s linear infinite',
          }}
        />
      )}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// C-PILL — status. Always colour + icon + text.
// ---------------------------------------------------------------------------

export interface PillProps {
  presentation: StatusPresentation;
  size?: 'small' | 'medium';
  /** Adds a pulsing dot for live states. */
  live?: boolean;
}

export function Pill({ presentation, size = 'medium', live }: PillProps) {
  const small = size === 'small';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: presentation.bg, color: presentation.fg,
        borderRadius: radius.pill,
        padding: small ? '2px 8px' : '3px 10px',
        fontSize: small ? 11 : 11.5, fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={live ? { animation: 'rfx-pulse 1.2s infinite' } : undefined}>
        {presentation.icon}
      </span>
      {presentation.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// C-CHIP — a neutral label. Not a status.
// ---------------------------------------------------------------------------

export interface ChipProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'purple' | 'info' | 'danger' | 'gold';
  icon?: string;
  title?: string;
}

const CHIP_TONES: Record<NonNullable<ChipProps['tone']>, { fg: string; bg: string }> = {
  neutral: { fg: color.textBody, bg: color.neutralSoft },
  brand: { fg: color.brandPrimary, bg: color.brandPrimarySoft },
  purple: { fg: color.accentPurpleText, bg: color.accentPurpleSoft },
  info: { fg: color.infoText, bg: color.infoSoft },
  danger: { fg: color.dangerText, bg: color.dangerSoft },
  gold: { fg: color.warningText, bg: color.warningSoft },
};

export function Chip({ children, tone = 'neutral', icon, title }: ChipProps) {
  const t = CHIP_TONES[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: t.bg, color: t.fg,
        borderRadius: 5, padding: '2px 7px',
        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const CONTROL_BASE: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${color.border}`,
  borderRadius: radius.control,
  padding: '7px 10px',
  fontSize: 13,
  background: '#fff',
  color: color.textPrimary,
};

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  success?: string;
  required?: boolean;
  children: React.ReactNode;
  /** Shown when the value is locked by a broader configuration scope. */
  lockedBy?: string;
}

export function Field({ label, hint, error, warning, success, required, children, lockedBy }: FieldProps) {
  return (
    <label style={{ display: 'block' }}>
      <span
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 12, fontWeight: 500, color: color.textSecondary, marginBottom: 5,
        }}
      >
        {label}
        {required && <span style={{ color: color.danger }}>*</span>}
        {lockedBy && (
          <span title={`Locked at ${lockedBy} scope`} style={{ color: color.textMuted }}>🔒</span>
        )}
      </span>
      {children}
      {hint && !error && !warning && !success && (
        <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 4 }}>{hint}</div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: color.dangerText, marginTop: 4 }}>✕ {error}</div>
      )}
      {warning && !error && (
        <div style={{ fontSize: 11, color: color.warningText, marginTop: 4 }}>● {warning}</div>
      )}
      {success && !error && !warning && (
        <div style={{ fontSize: 11, color: color.successText, marginTop: 4 }}>✓ {success}</div>
      )}
    </label>
  );
}

export function TextInput({
  invalid, style, ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      style={{
        ...CONTROL_BASE,
        borderColor: invalid ? color.danger : color.border,
        ...(rest.disabled ? { background: color.neutralSoft, color: color.textMuted } : {}),
        ...style,
      }}
    />
  );
}

export function NumberInput({
  invalid, style, ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      type="number"
      style={{
        ...CONTROL_BASE, ...tabular,
        borderColor: invalid ? color.danger : color.border,
        ...(rest.disabled ? { background: color.neutralSoft, color: color.textMuted } : {}),
        ...style,
      }}
    />
  );
}

const tabular: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFamily: font.mono };

export interface CurrencyInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  currency?: string;
  invalid?: boolean;
}

export function CurrencyInput({ currency = '$', invalid, style, ...rest }: CurrencyInputProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center',
        border: `1px solid ${invalid ? color.danger : color.border}`,
        borderRadius: radius.control, background: '#fff', overflow: 'hidden',
      }}
    >
      <span
        style={{
          padding: '7px 9px', background: color.neutralSoft,
          color: color.textSecondary, fontSize: 12, fontWeight: 600,
          borderRight: `1px solid ${color.border}`,
        }}
      >
        {currency}
      </span>
      <input
        {...rest}
        style={{
          ...CONTROL_BASE, ...tabular, border: 'none', textAlign: 'right', ...style,
        }}
      />
    </div>
  );
}

export function Select({
  style, children, ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        {...rest}
        style={{
          ...CONTROL_BASE, appearance: 'none', paddingRight: 28,
          ...(rest.disabled ? { background: color.neutralSoft, color: color.textMuted } : {}),
          ...style,
        }}
      >
        {children}
      </select>
      <span
        aria-hidden
        style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          color: color.textSecondary, fontSize: 10, pointerEvents: 'none',
        }}
      >
        ▾
      </span>
    </div>
  );
}

export function Textarea({ style, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} style={{ ...CONTROL_BASE, resize: 'vertical', ...style }} />;
}

export function ReadOnlyValue({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <div
      style={{
        padding: '7px 10px', background: color.neutralSoft,
        borderRadius: radius.control, fontSize: 13, color: color.textPrimary,
        ...(mono ? tabular : {}),
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selection controls
// ---------------------------------------------------------------------------

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  /** Explains why a control is permanently disabled — the agent hard limits. */
  disabledReason?: string;
}

export function Toggle({ checked, onChange, label, disabled, disabledReason }: ToggleProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={disabledReason}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 38, height: 20, borderRadius: radius.pill, border: 'none',
          background: disabled ? color.borderStrong : checked ? color.brandPrimary : color.borderStrong,
          position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
          padding: 0, opacity: disabled ? 0.6 : 1, flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2, left: checked ? 20 : 2,
            width: 16, height: 16, borderRadius: '50%', background: '#fff',
            transition: 'left .14s ease', boxShadow: '0 1px 2px rgba(17,24,39,.2)',
          }}
        />
      </button>
      {label && (
        <span style={{ fontSize: 13, color: disabled ? color.textMuted : color.textBody }}>
          {label}
        </span>
      )}
      {disabledReason && (
        <span title={disabledReason} style={{ color: color.textMuted, fontSize: 12 }}>ⓘ</span>
      )}
    </span>
  );
}

export interface SegmentedProps<T extends string> {
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (next: T) => void;
  size?: 'small' | 'medium';
}

export function Segmented<T extends string>({ options, value, onChange, size = 'medium' }: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex', background: color.neutralSoft,
        borderRadius: radius.control, padding: 2, gap: 2,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            title={option.title}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            style={{
              border: 'none', borderRadius: 5,
              padding: size === 'small' ? '3px 9px' : '5px 12px',
              fontSize: size === 'small' ? 11 : 12, fontWeight: 600,
              background: active ? '#fff' : 'transparent',
              color: active ? color.textPrimary : color.textSecondary,
              boxShadow: active ? '0 1px 2px rgba(17,24,39,.14)' : 'none',
              cursor: option.disabled ? 'not-allowed' : 'pointer',
              opacity: option.disabled ? 0.5 : 1,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Radio({
  checked, onChange, label, hint, disabled,
}: { checked: boolean; onChange: () => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%',
        textAlign: 'left', background: checked ? '#F5F8FF' : '#fff',
        border: `1px solid ${checked ? color.brandPrimary : color.border}`,
        borderRadius: radius.control, padding: '10px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14, height: 14, borderRadius: '50%', marginTop: 2, flexShrink: 0,
          border: `2px solid ${checked ? color.brandPrimary : color.borderStrong}`,
          background: checked ? color.brandPrimary : '#fff',
          boxShadow: checked ? 'inset 0 0 0 2px #fff' : 'none',
        }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: checked ? color.brandPrimary : color.textPrimary }}>
          {label}
        </span>
        {hint && (
          <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

export function Checkbox({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 14, height: 14, accentColor: color.brandPrimary }}
      />
      <span style={{ fontSize: 13, color: disabled ? color.textMuted : color.textBody }}>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Misc primitives
// ---------------------------------------------------------------------------

export function Avatar({ initials, size = 26 }: { initials: string; size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: '50%',
        background: color.brandPrimarySoft, color: color.brandPrimary,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.42, fontWeight: 700, flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}

export function Money({ value, currency = 'USD', bold, tone }: {
  value: number; currency?: string; bold?: boolean; tone?: string;
}) {
  return (
    <span style={{ ...tabular, fontWeight: bold ? 700 : 400, color: tone ?? 'inherit' }}>
      {new Intl.NumberFormat('en-US', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(value)}
    </span>
  );
}

export function SectionHeading({ children, hint, action }: {
  children: React.ReactNode; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <div>
        <div style={{ ...type.sectionHeading, color: color.textPrimary }}>{children}</div>
        {hint && <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>{hint}</div>}
      </div>
      {action}
    </div>
  );
}
