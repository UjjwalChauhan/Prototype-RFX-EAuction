/**
 * Pack 00 §2 — primitives, on shadcn/ui's component anatomy.
 *
 * Each component below is the shadcn component of the same name, kept at this
 * product's density: `cva` variants, Tailwind utilities against the token
 * layer in `global.css`, a focus ring rather than a browser outline, and
 * `disabled:opacity-50 disabled:pointer-events-none` rather than a hand-rolled
 * dimming. What did **not** change is the prop surface — `variant="primary"`,
 * `size="small"`, `tone="gold"` and the rest still mean what they meant, so
 * fifty screens keep working and every interaction is the one that was there
 * before.
 *
 * Two deliberate departures from stock shadcn:
 *
 * - **Denser.** shadcn's default control is 36px with 14px type, which is
 *   right for a marketing app and wrong for a comparison grid with eleven
 *   columns. Controls here are 32px/12px, which is shadcn's own `sm`.
 * - **No Radix.** These are presentational components with no overlay
 *   behaviour to delegate; the ones that do have it — Drawer, Modal — live in
 *   `domain.tsx` and keep their own focus handling.
 */
import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { BASE_CURRENCY, color, currencySymbol, font, money, type } from '../tokens';
import { cn } from '../cn';
import type { StatusPresentation } from '../../domain/statusMachine';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'icon';
export type ButtonSize = 'small' | 'medium';

/**
 * shadcn's button variants, under this product's names. `primary` is shadcn's
 * `default`, `secondary` is its `outline`, `tertiary` is its `ghost` in the
 * brand colour, and `icon` is `outline` at square proportions.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium '
  + 'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
  + 'focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      intent: {
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        secondary: 'border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground',
        tertiary: 'text-primary hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-white shadow-sm hover:bg-destructive/90',
        icon: 'border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground',
      },
      scale: {
        small: 'h-7 px-2.5 text-[11px]',
        medium: 'h-8 px-3 text-xs',
      },
    },
    compoundVariants: [
      { intent: 'icon', scale: 'small', class: 'h-7 w-7 p-0' },
      { intent: 'icon', scale: 'medium', class: 'h-8 w-8 p-0' },
    ],
    defaultVariants: { intent: 'secondary', scale: 'medium' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  Omit<VariantProps<typeof buttonVariants>, 'intent' | 'scale'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'secondary', size = 'medium', loading, children, className, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(buttonVariants({ intent: variant, scale: size }), className)}
    >
      {loading && (
        <span
          aria-hidden
          className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current"
        />
      )}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// C-PILL — status. Always colour + icon + text.
//
// shadcn's Badge, carrying the status palette the domain layer hands it:
// a status colour is a product decision, not a component one.
// ---------------------------------------------------------------------------

export interface PillProps {
  presentation: StatusPresentation;
  size?: 'small' | 'medium';
  /** Adds a pulsing dot for live states. */
  live?: boolean;
}

export function Pill({ presentation, size = 'medium', live }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap',
        size === 'small' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-[11.5px]',
      )}
      style={{ background: presentation.bg, color: presentation.fg }}
    >
      <span aria-hidden className={live ? 'animate-pulse' : undefined}>
        {presentation.icon}
      </span>
      {presentation.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// C-CHIP — shadcn's Badge. A neutral label, not a status.
// ---------------------------------------------------------------------------

export interface ChipProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'purple' | 'info' | 'success' | 'danger' | 'gold';
  icon?: string;
  title?: string;
}

/**
 * A soft fill with a border one step darker, which is what keeps a badge
 * legible against both the white surface and the zebra row.
 */
const CHIP_TONES: Record<NonNullable<ChipProps['tone']>, { fg: string; bg: string; bd: string }> = {
  neutral: { fg: color.textSecondary, bg: color.rowAlt, bd: color.border },
  brand: { fg: color.brandPrimaryStrong, bg: color.brandPrimarySoft, bd: color.brandPrimaryTint },
  purple: { fg: color.accentPurpleText, bg: color.accentPurpleSoft, bd: '#DDD6FE' },
  info: { fg: color.infoText, bg: color.infoSoft, bd: '#BFDBFE' },
  danger: { fg: color.dangerText, bg: color.dangerSoft, bd: '#FECACA' },
  success: { fg: color.successText, bg: color.successSoft, bd: '#BBF7D0' },
  gold: { fg: color.warningText, bg: color.warningSoft, bd: '#FDE68A' },
};

export function Chip({ children, tone = 'neutral', icon, title }: ChipProps) {
  const t = CHIP_TONES[tone];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap"
      style={{ background: t.bg, color: t.fg, borderColor: t.bd }}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inputs — shadcn's Input, Textarea and Select, at 32px rather than 36px.
// ---------------------------------------------------------------------------

/** The shared control surface. Every field in the product is one of these. */
const CONTROL = 'flex w-full rounded-md border border-input bg-background px-2.5 py-1 '
  + 'text-[13px] text-foreground shadow-sm transition-colors placeholder:text-muted-foreground '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 '
  + 'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70';

const CONTROL_H = 'h-8';

/** Numbers line up or they cannot be compared down a column. */
const TABULAR = 'font-mono [font-variant-numeric:tabular-nums]';

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
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
        {lockedBy && (
          <span title={`Locked at ${lockedBy} scope`} className="text-muted-foreground">🔒</span>
        )}
      </span>
      {children}
      {hint && !error && !warning && !success && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
      {error && (
        <div className="mt-1.5 text-[11px]" style={{ color: color.dangerText }}>✕ {error}</div>
      )}
      {warning && !error && (
        <div className="mt-1.5 text-[11px]" style={{ color: color.warningText }}>● {warning}</div>
      )}
      {success && !error && !warning && (
        <div className="mt-1.5 text-[11px]" style={{ color: color.successText }}>✓ {success}</div>
      )}
    </label>
  );
}

export function TextInput({
  invalid, className, ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL, CONTROL_H,
        invalid && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
    />
  );
}

export function NumberInput({
  invalid, className, ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      type="number"
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL, CONTROL_H, TABULAR,
        invalid && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
    />
  );
}

export interface CurrencyInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  currency?: string;
  invalid?: boolean;
}

export function CurrencyInput({
  currency = currencySymbol(BASE_CURRENCY), invalid, className, ...rest
}: CurrencyInputProps) {
  return (
    <div
      className={cn(
        'flex h-8 items-center overflow-hidden rounded-md border border-input bg-background shadow-sm',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
        invalid && 'border-destructive focus-within:ring-destructive',
      )}
    >
      <span className="self-stretch border-r border-input bg-muted px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
        {currency}
      </span>
      <input
        {...rest}
        className={cn(
          'h-full w-full border-0 bg-transparent px-2.5 text-right text-[13px] text-foreground',
          'focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground',
          TABULAR, className,
        )}
      />
    </div>
  );
}

export function Select({
  className, children, ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...rest}
        className={cn(CONTROL, CONTROL_H, 'appearance-none pr-7', className)}
      >
        {children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground"
      >
        ▾
      </span>
    </div>
  );
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(CONTROL, 'min-h-16 resize-y py-2', className)} />;
}

export function ReadOnlyValue({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-md bg-muted px-2.5 py-1.5 text-[13px] text-foreground',
        mono && TABULAR,
      )}
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
  /**
   * The accessible name, where the switch carries no visible one.
   *
   * A plugin card already shows its title in 16px beside the switch, so
   * repeating it as a second label is noise on screen — but a switch with no
   * name at all is unusable to anyone not looking at the card. Falls back to
   * `label` so every existing caller keeps the name it had.
   */
  ariaLabel?: string;
  disabled?: boolean;
  /** Explains why a control is permanently disabled — the agent hard limits. */
  disabledReason?: string;
}

/** shadcn's Switch: a track that takes the ring, and a thumb that translates. */
export function Toggle({
  checked, onChange, label, ariaLabel, disabled, disabledReason,
}: ToggleProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        title={disabledReason}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          checked && !disabled ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
      {label && (
        <span className={cn('text-[13px]', disabled ? 'text-muted-foreground' : 'text-foreground')}>
          {label}
        </span>
      )}
      {disabledReason && (
        <span title={disabledReason} className="text-xs text-muted-foreground">ⓘ</span>
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

/** shadcn's Tabs list, used as a segmented control. */
export function Segmented<T extends string>({ options, value, onChange, size = 'medium' }: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex max-w-full flex-wrap items-center justify-center gap-1 rounded-md bg-muted p-1 text-muted-foreground',
        size === 'small' ? 'min-h-8' : 'min-h-9',
      )}
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
            className={cn(
              'inline-flex min-w-0 flex-auto items-center justify-center rounded-sm text-center font-semibold',
              'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
              size === 'small' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1 text-xs',
              active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** shadcn's RadioGroup item, in its card form: the whole row is the target. */
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
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:pointer-events-none disabled:opacity-50',
        checked ? 'border-primary bg-accent' : 'border-input bg-background hover:bg-accent/60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border-2',
          checked ? 'border-primary bg-primary ring-2 ring-inset ring-background' : 'border-input bg-background',
        )}
      />
      <span>
        <span className={cn('block text-[13px] font-semibold', checked ? 'text-primary' : 'text-foreground')}>
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{hint}</span>
        )}
      </span>
    </button>
  );
}

export function Checkbox({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'size-3.5 shrink-0 rounded-sm accent-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      />
      <span className={cn('text-[13px]', disabled ? 'text-muted-foreground' : 'text-foreground')}>
        {label}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Misc primitives
// ---------------------------------------------------------------------------

export function Avatar({ initials, size = 26 }: { initials: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size, height: size, fontSize: size * 0.42,
        background: color.brandPrimarySoft, color: color.brandPrimary,
      }}
    >
      {initials}
    </span>
  );
}

/**
 * A money figure.
 *
 * Formatted through `money()` rather than `Intl` directly, so a rupee amount is
 * grouped in lakh here exactly as it is everywhere else — two formatters is two
 * answers to the same question, and the screen shows both.
 */
export function Money({ value, currency = BASE_CURRENCY, bold, tone }: {
  value: number; currency?: string; bold?: boolean; tone?: string;
}) {
  return (
    <span
      className={cn(TABULAR, bold && 'font-bold')}
      style={{ color: tone ?? 'inherit', fontFamily: font.mono }}
    >
      {money(value, currency)}
    </span>
  );
}

export function SectionHeading({ children, hint, action }: {
  children: React.ReactNode; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div>
        <div className="text-foreground" style={{ ...type.sectionHeading }}>{children}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      {action}
    </div>
  );
}
