import { clsx } from 'clsx'
import { APP_NAME_PARTS } from '@/lib/app'

/**
 * Ícone do arD ClikList (lista com check + cursor).
 * Adaptável: fundo preto e traço branco no tema claro; invertido no tema escuro.
 * Regras da marca: preto #111111 e branco #FFFFFF, sem sombras/gradientes.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={clsx('shrink-0', className)}>
      <rect width="48" height="48" rx="12" className="fill-[#111111] dark:fill-white" />
      <g
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-white dark:stroke-[#111111]"
      >
        <path d="M27.2 36.4H13.6a2.6 2.6 0 0 1-2.55-3.1l3.6-19.6A2.6 2.6 0 0 1 17.2 11.6h15.6a2.6 2.6 0 0 1 2.55 3.1l-1.5 8.2" />
        <path d="M17.6 17.6l1.4 1.4 2.6-2.8M17.0 23.4l1.4 1.4 2.6-2.8M16.4 29.2l1.4 1.4 2.6-2.8" />
        <path d="M24.8 17.6h5.4M24.2 23.4h3.6M23.6 29.2h2.6" />
        <path d="M30.2 25.8l-0.9-1.6M33.6 25.2l0.6-1.7M28.4 28.6l-1.7-0.4" />
      </g>
      <path
        d="M30.6 28.4l9.4 3.9-4.1 1.5 3.6 4.4-2.1 1.7-3.6-4.4-2.4 3.6z"
        strokeWidth="2.2"
        strokeLinejoin="round"
        className="fill-[#111111] stroke-white dark:fill-white dark:stroke-[#111111]"
      />
    </svg>
  )
}

/** Nome da marca: "arD" regular + "ClikList" em negrito. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('tracking-[-0.02em] whitespace-nowrap text-fg', className)}>
      <span className="font-normal">{APP_NAME_PARTS[0]}</span> <span className="font-bold">{APP_NAME_PARTS[1]}</span>
    </span>
  )
}
