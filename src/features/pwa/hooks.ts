import { useEffect, useState, useSyncExternalStore } from 'react'
import { canPromptInstall, isIos, isStandalone, subscribeInstall } from './install'

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'unavailable'

/** Como o app pode ser instalado neste aparelho/navegador. */
export function useInstallMode(): InstallMode {
  const canPrompt = useSyncExternalStore(subscribeInstall, canPromptInstall, () => false)
  if (isStandalone()) return 'installed'
  if (canPrompt) return 'prompt'
  if (isIos()) return 'ios'
  return 'unavailable'
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
