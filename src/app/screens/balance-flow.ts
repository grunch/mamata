// "Ver saldo": explicación de cómo volver, abrir la página y preguntar cuánto queda.
import { currentBalance, formatMoney, looksTooHigh, parseAmountInput } from '../../shared/balance.ts'
import type { GiftCard } from '../../shared/model.ts'
import { balanceUrl } from '../../shared/providers.ts'
import { openBalancePage } from '../balance-return.ts'
import { noteBalance, type AppContext } from '../context.ts'
import { routeHref } from '../router.ts'
import { bigButton, h, screen } from '../ui.ts'
import { findCard } from './giftcards.ts'
import { notFoundScreen } from './status.ts'

export function startBalanceCheck(ctx: AppContext, card: GiftCard): void {
  const url = balanceUrl(card)
  if (!url) return
  ctx.go({ name: 'card', id: card.id })
  openBalancePage(url, card.id)
}

// Dibujo simple de la barra de arriba de Chrome con la X marcada.
function closeButtonDrawing(): HTMLElement {
  return h('div', { class: 'x-drawing', attrs: { 'aria-hidden': 'true' } }, [
    h('span', { class: 'x-mark', text: '✕' }),
    h('span', { class: 'x-bar', text: 'tienda.ohgiftcard.com.ar' }),
    h('span', { class: 'x-arrow', text: '⬅ tocá acá' }),
  ])
}

export function explainerScreen(ctx: AppContext, id: string): HTMLElement {
  const card = findCard(ctx, id)
  if (!card) return notFoundScreen('No encontré esa tarjeta.')
  const checkbox = h('input', { attrs: { type: 'checkbox', id: 'no-mostrar' } })

  // Abrir primero, dentro del mismo toque: si se espera a guardar, el navegador puede
  // bloquear la pestaña nueva. Si la preferencia no se guarda, la explicación vuelve a
  // aparecer la próxima vez, que no es grave.
  const onContinue = () => {
    startBalanceCheck(ctx, card)
    if (checkbox.checked) void ctx.store.setPref('skipBalanceExplainer', true).catch(() => undefined)
  }

  return screen('Antes de ver el saldo', [
    h('p', { class: 'body', text: 'Te voy a mostrar la página de la tarjeta.' }),
    h('p', { class: 'body strong', text: 'Para volver acá, tocá la X de arriba a la izquierda, o el botón atrás de tu teléfono.' }),
    closeButtonDrawing(),
    h('div', { class: 'actions' }, [
      bigButton('💳', 'Ver mi saldo', onContinue),
      h('label', { class: 'check', attrs: { for: 'no-mostrar' } }, [checkbox, ' No mostrar más esta explicación']),
    ]),
  ])
}

// Guardar / Ahora no. Se esconden mientras se pide confirmación, para no confundir.
function noteButtons(cardId: string): HTMLElement {
  return h('div', { class: 'actions' }, [
    h('button', { class: 'big-button primary', attrs: { type: 'submit' } }, [
      h('span', { class: 'icon', text: '💾', attrs: { 'aria-hidden': 'true' } }),
      h('span', { text: 'Guardar' }),
    ]),
    h('a', { class: 'big-button quiet', attrs: { href: routeHref({ name: 'card', id: cardId }) } }, [
      h('span', { class: 'icon', text: '⏭', attrs: { 'aria-hidden': 'true' } }),
      h('span', { text: 'Ahora no' }),
    ]),
  ])
}

export function noteScreen(ctx: AppContext, id: string): HTMLElement {
  const card = findCard(ctx, id)
  if (!card) return notFoundScreen('No encontré esa tarjeta.')
  const current = currentBalance(card, ctx.state.notes)
  const hint =
    current.source === 'usuario'
      ? `La última vez anotaste ${formatMoney(current.amount)}.`
      : `Antes tenía ${formatMoney(current.amount)}.`

  const input = h('input', {
    class: 'money',
    attrs: { id: 'monto', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'pista error' },
  })
  const error = h('p', { class: 'error', attrs: { id: 'error', role: 'alert', hidden: '' } })
  const confirmBox = h('div', { class: 'confirm', attrs: { hidden: '' } })
  const buttons = noteButtons(card.id)
  let saving = false

  // Un doble toque no tiene que anotar dos veces.
  const save = async (amount: number) => {
    if (saving) return
    saving = true
    await noteBalance(ctx, card.id, amount)
    ctx.announce(`¡Listo! Anotaste que te quedan ${formatMoney(amount)}.`)
    ctx.go({ name: 'card', id: card.id })
  }

  const showForm = (message?: string) => {
    confirmBox.hidden = true
    buttons.hidden = false
    if (message) {
      error.textContent = message
      error.hidden = false
    }
    input.focus()
  }

  const askToConfirm = (amount: number) => {
    confirmBox.replaceChildren(
      h('p', { class: 'body strong', text: `¿Seguro? Antes tenías ${formatMoney(current.amount)}.` }),
      bigButton('✅', 'Sí, es correcto', () => void save(amount)),
      bigButton('✏️', 'Corregir', () => showForm(), 'secondary'),
    )
    confirmBox.hidden = false
    buttons.hidden = true
    confirmBox.querySelector('button')?.focus()
  }

  const onSubmit = (event: Event) => {
    event.preventDefault()
    error.hidden = true
    const amount = parseAmountInput(input.value)
    if (amount === null) return showForm('Escribí solo el número, por ejemplo 120.000')
    if (looksTooHigh(amount, card, ctx.state.notes)) return askToConfirm(amount)
    void save(amount)
  }

  return screen('¿Cuánto te queda en esta gift card?', [
    h('p', { class: 'body', text: card.label }),
    h('form', { class: 'note-form', on: { submit: onSubmit } }, [
      h('label', { class: 'body', text: 'Escribí el número que te mostró la página:', attrs: { for: 'monto' } }),
      h('div', { class: 'money-input' }, [h('span', { text: '$', attrs: { 'aria-hidden': 'true' } }), input]),
      h('p', { class: 'caption', text: hint, attrs: { id: 'pista' } }),
      error,
      confirmBox,
      buttons,
    ]),
  ])
}
