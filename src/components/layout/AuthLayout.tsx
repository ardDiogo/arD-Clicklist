import type { ReactNode } from 'react'
import { APP_NAME } from '@/lib/app'
import { Logo } from './Logo'

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col px-5 pt-[max(env(safe-area-inset-top),3rem)] pb-8">
      <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col animate-fade-in">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
        </div>
        <div className="mt-12 sm:mt-16">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] text-fg">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] leading-6 text-fg-muted">{subtitle}</p>}
        </div>
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-8 text-center text-sm text-fg-muted">{footer}</div>}
      </div>
    </div>
  )
}
