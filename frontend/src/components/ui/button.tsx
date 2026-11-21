import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/** `default` is kept as a primary alias for existing call sites. */
export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'danger-outline'

/** `default` aliases `md`; `lg` retained for existing call sites. */
export type ButtonSize = 'default' | 'sm' | 'md' | 'lg'

const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'

function buttonVariantClass(variant: ButtonVariant): string {
  switch (variant) {
    case 'default':
    case 'primary':
      return 'bg-primary text-primary-foreground hover:bg-primary-hover'
    case 'outline':
      return 'border border-border-strong bg-card text-foreground hover:bg-muted'
    case 'ghost':
      return 'text-foreground hover:bg-muted'
    case 'danger':
      return 'bg-danger text-white hover:bg-danger/90'
    case 'danger-outline':
      return 'border border-danger/40 bg-card text-danger hover:bg-danger-soft'
    default: {
      const unreachable: never = variant
      return unreachable
    }
  }
}

function buttonSizeClass(size: ButtonSize): string {
  switch (size) {
    case 'sm':
      return 'h-8 px-3 text-xs'
    case 'default':
    case 'md':
      return 'h-10 px-5 text-sm'
    case 'lg':
      return 'h-11 px-6 text-sm'
    default: {
      const unreachable: never = size
      return unreachable
    }
  }
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonBase, buttonVariantClass(variant), buttonSizeClass(size), className)}
      {...props}
    />
  )
}
