import { Download, PlusSquare, Share, Smartphone, WifiOff, X } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { useInstallMode, useOnline } from './hooks'
import { dismissInstallHint, promptInstall, wasDismissedRecently } from './install'

/** Passo a passo do iPhone/iPad (Safari não permite instalar por botão). */
export function IosInstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Instalar no iPhone">
      <ol className="space-y-3 text-[14px] leading-5">
        <li className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-[12px] font-semibold">1</span>
          <span>
            Abra este site no <strong>Safari</strong> (no Chrome do iPhone o menu é parecido).
          </span>
        </li>
        <li className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-[12px] font-semibold">2</span>
          <span>
            Toque em <strong>Compartilhar</strong> <Share className="inline size-4 align-text-bottom" /> na barra do navegador.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-[12px] font-semibold">3</span>
          <span>
            Escolha <strong>Adicionar à Tela de Início</strong> <PlusSquare className="inline size-4 align-text-bottom" /> e
            confirme em <strong>Adicionar</strong>.
          </span>
        </li>
      </ol>
      <p className="mt-4 text-[13px] text-fg-muted">O ícone do arD ClikList aparece na tela inicial e o app abre em tela cheia.</p>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Entendi</Button>
      </div>
    </Dialog>
  )
}

function useInstallAction() {
  const mode = useInstallMode()
  const toast = useToast()
  const [iosOpen, setIosOpen] = useState(false)
  const install = async () => {
    if (mode === 'ios') return setIosOpen(true)
    const ok = await promptInstall()
    if (ok) toast.show('App instalado! Ele está na sua tela inicial.')
  }
  return { mode, install, dialog: <IosInstallDialog open={iosOpen} onClose={() => setIosOpen(false)} /> }
}

/** Convite discreto no Início (some ao instalar ou ao dispensar por 14 dias). */
export function InstallBanner() {
  const { mode, install, dialog } = useInstallAction()
  const [hidden, setHidden] = useState(wasDismissedRecently)
  if (hidden || (mode !== 'prompt' && mode !== 'ios')) return null
  return (
    <>
      <Card className="mb-5 flex items-center gap-3 px-4 py-3 animate-fade-in">
        <Logo size={36} className="hidden min-[400px]:block" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">Instalar o app</p>
          <p className="text-[12px] leading-4 text-fg-muted">Abre em tela cheia pela tela inicial.</p>
        </div>
        <Button size="sm" icon={<Download className="size-4" />} onClick={() => void install()}>
          Instalar
        </Button>
        <button
          type="button"
          aria-label="Dispensar"
          onClick={() => {
            dismissInstallHint()
            setHidden(true)
          }}
          className="grid size-7 place-items-center rounded-md text-fg-subtle hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </Card>
      {dialog}
    </>
  )
}

/** Cartão em Ajustes: sempre mostra o estado da instalação. */
export function InstallSettingsCard() {
  const { mode, install, dialog } = useInstallAction()
  return (
    <Card className="flex items-center gap-3 px-5 py-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-fg-muted">
        <Smartphone className="size-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Aplicativo</p>
        <p className="text-[13px] text-fg-muted">
          {mode === 'installed'
            ? 'Instalado neste aparelho.'
            : mode === 'unavailable'
              ? 'Para instalar, abra no Chrome (Android/computador) ou no Safari (iPhone).'
              : 'Instale para abrir em tela cheia pela tela inicial.'}
        </p>
      </div>
      {(mode === 'prompt' || mode === 'ios') && (
        <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => void install()}>
          Instalar
        </Button>
      )}
      {dialog}
    </Card>
  )
}

/** Faixa no topo quando o aparelho está sem internet. */
export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-fg px-4 py-2 pt-[max(env(safe-area-inset-top),0.5rem)] text-[13px] text-bg"
    >
      <WifiOff className="size-4" />
      Sem conexão. As alterações não serão salvas até a internet voltar.
    </div>
  )
}
