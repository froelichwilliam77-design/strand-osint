import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-sage text-[#1a2214] hover:bg-[#d2e0c0] disabled:opacity-50',
    outline: 'border border-line bg-transparent text-fog hover:bg-raised',
    ghost: 'text-muted hover:text-ink-2 hover:bg-raised',
    danger: 'bg-[#3a1f1f] text-[#f0c7c7] hover:bg-[#4a2828]',
  }[variant]
  return (
    <button
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed',
        styles,
        className,
      )}
      {...props}
    />
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{label}</span>
        {hint ? <span className="text-[11px] font-medium text-sage-dim">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full min-h-11 rounded-xl border border-line bg-[#101310] px-3 py-2.5 text-base text-ink-2 outline-none placeholder:text-[#5d6358] focus:border-sage-dim md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full min-h-11 appearance-none rounded-xl border border-line bg-[#101310] px-3 py-2.5 text-base text-ink-2 outline-none focus:border-sage-dim md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{label}</span>
        <span className="font-mono text-sm text-fog">
          {value}
          {suffix}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step ?? 1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-2">
      <span className="text-sm text-fog">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-sage' : 'bg-[#2a2f2a]')}
      >
        <span
          className="absolute top-0.5 h-6 w-6 rounded-full bg-ink transition"
          style={{ left: checked ? 22 : 2 }}
        />
      </button>
    </label>
  )
}
