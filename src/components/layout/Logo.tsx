/** Marca provisória: casa estilizada com check. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-fg" />
      <path
        d="M9 15.2 16 9.5l7 5.7V22a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 9 22v-6.8Z"
        fill="none"
        className="stroke-bg"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m13.2 17.6 2 2 3.8-3.9"
        fill="none"
        stroke="#22c55e"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
