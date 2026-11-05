import { RefreshCw } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui/Button'

/** Avisa quando há uma nova versão do app instalada pelo service worker. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // O app instalado pode ficar aberto por dias: procura versão nova ao voltar
    // para o app e a cada 30 minutos (no iPhone isso não acontece sozinho).
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => undefined)
      }
      setInterval(check, 30 * 60 * 1000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-lg animate-fade-in lg:bottom-6">
      <RefreshCw className="size-4 shrink-0 text-accent-600" />
      <p className="flex-1 text-[13px]">Nova versão disponível.</p>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Depois
      </Button>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        Atualizar
      </Button>
    </div>
  )
}
