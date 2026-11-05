/**
 * Instalação do PWA.
 * O evento `beforeinstallprompt` (Android/Chrome/Edge) dispara cedo, antes do React
 * montar; por isso é capturado aqui, no carregamento do módulo (importado em main.tsx).
 * No iPhone/iPad não existe esse evento: a instalação é pelo menu Compartilhar do Safari.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function canPromptInstall(): boolean {
  return deferred !== null
}

/** Abre a janela nativa de instalação. Retorna true se o usuário aceitou. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const ev = deferred
  await ev.prompt()
  const { outcome } = await ev.userChoice
  deferred = null
  notify()
  return outcome === 'accepted'
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone/iPad (inclui iPad com "modo desktop", que se apresenta como Mac com toque). */
export function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

const DISMISS_KEY = 'pwa-install-dismissed-at'
const DISMISS_DAYS = 14

export function wasDismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    return Date.now() - at < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    /* ignora */
  }
}
