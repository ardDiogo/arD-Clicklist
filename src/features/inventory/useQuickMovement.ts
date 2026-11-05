import { useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'
import { toMessage } from '@/lib/errors'
import { recordMovement } from './api'
import { applyLocalMovement, newIdempotencyKey, roundQty, type StockItem } from './domain'

/**
 * Ações rápidas de +1 / −1 com atualização otimista e "Desfazer".
 * "−" registra consumo; "+" registra correção (entradas com preço virão das compras).
 * Desfazer gera uma correção inversa — o histórico nunca é apagado.
 */
export function useQuickMovement(patch: (id: string, fn: (i: StockItem) => StockItem) => void, reload: () => Promise<void>) {
  const toast = useToast()

  return useCallback(
    async (item: StockItem, direction: 1 | -1) => {
      // Se restar fração (ex.: 0,5), o "−" consome só o que existe.
      const qty = direction === -1 ? roundQty(Math.min(1, item.current_qty)) : 1
      if (qty <= 0) return
      const delta = direction * qty
      patch(item.id, (i) => applyLocalMovement(i, delta))
      try {
        if (direction === -1) {
          await recordMovement(item.id, 'consumption', qty, newIdempotencyKey())
        } else {
          await recordMovement(item.id, 'correction', qty, newIdempotencyKey(), 'Ajuste rápido (+)')
        }
        toast.show(`${direction === -1 ? 'Usado' : 'Adicionado'}: ${item.product_name}`, {
          action: {
            label: 'Desfazer',
            onClick: async () => {
              patch(item.id, (i) => applyLocalMovement(i, -delta))
              try {
                await recordMovement(item.id, 'correction', -delta, newIdempotencyKey(), 'Desfeito')
              } catch (e) {
                toast.error(toMessage(e))
                await reload()
              }
            },
          },
        })
      } catch (e) {
        toast.error(toMessage(e))
        await reload()
      }
    },
    [patch, reload, toast],
  )
}
