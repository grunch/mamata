import { h } from '../../app/ui.ts'
import { currentBalance, formatMoney, parseAmountInput } from '../../shared/balance.ts'
import type { GiftCard } from '../../shared/model.ts'
import { balanceUrl, parseRedeemInput, PROVIDERS } from '../../shared/providers.ts'
import type { AdminContext } from '../context.ts'
import { addAdminBalance, moveToTrash, newId, upsert } from '../draft.ts'
import { field, fileInput, formError, selectInput, showError, smallButton, textInput } from '../forms.ts'
import { compressImage } from '../image.ts'

function cardForm(ctx: AdminContext, existing: GiftCard | null, onDone: () => void): HTMLElement {
  const label = textInput(existing?.label)
  const provider = selectInput(
    Object.values(PROVIDERS).map((p) => ({ value: p.id, label: p.name })),
    existing?.providerId ?? 'ohgiftcard',
  )
  const code = textInput(existing?.redeemCode, { inputmode: 'text', spellcheck: 'false' })
  const brands = textInput(existing?.brands.join(', ') ?? 'Día, Carrefour')
  const amount = textInput(existing ? String(existing.initialAmount) : '', { inputmode: 'decimal' })
  const expires = textInput(existing?.expiresOn, { type: 'date' })
  const image = fileInput()
  const error = formError()

  const save = async (event: Event) => {
    event.preventDefault()
    const redeemCode = parseRedeemInput(code.value)
    const initialAmount = parseAmountInput(amount.value)
    if (!label.value.trim()) return showError(error, 'Falta el nombre de la tarjeta.')
    if (!redeemCode) return showError(error, 'El código tiene que tener 16 números (o pegá el link de "Consultar saldo").')
    if (initialAmount === null) return showError(error, 'El monto inicial no es válido.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires.value)) return showError(error, 'Falta la fecha de vencimiento.')

    let imageId = existing?.imageId
    const file = image.files?.[0]
    if (file) {
      try {
        imageId = ctx.addImage(await compressImage(file))
      } catch {
        return showError(error, 'No se pudo usar esa imagen. Probá con otra.')
      }
    }
    const card: GiftCard = {
      id: existing?.id ?? newId(),
      providerId: provider.value,
      label: label.value.trim(),
      redeemCode,
      brands: brands.value.split(',').map((b) => b.trim()).filter(Boolean),
      initialAmount,
      currency: 'ARS',
      expiresOn: expires.value,
      adminBalances: existing?.adminBalances ?? [],
      createdAt: existing?.createdAt ?? ctx.now(),
      ...(imageId ? { imageId } : {}),
    }
    ctx.edit(upsert(ctx.session.content, 'giftCards', card))
    ctx.toast('Tarjeta guardada. Acordate de publicar.')
    onDone()
  }

  return h('form', { class: 'admin-form', on: { submit: (e) => void save(e) } }, [
    h('h2', { text: existing ? 'Editar tarjeta' : 'Nueva tarjeta' }),
    field('Nombre (como lo va a ver)', label),
    field('Proveedor', provider),
    field('Código de canje o link de "Consultar saldo"', code, 'Es el número de 16 dígitos de la tarjeta.'),
    field('Dónde se puede usar (separado por comas)', brands),
    field('Monto inicial ($)', amount),
    field('Vence el', expires),
    field('Foto de la tarjeta', image, 'Se achica y se cifra antes de subirla.'),
    error,
    h('div', { class: 'row' }, [
      h('button', { class: 'small-button primary', text: 'Guardar', attrs: { type: 'submit' } }),
      smallButton('Cancelar', onDone),
    ]),
  ])
}

function correctedBalance(ctx: AdminContext, card: GiftCard): HTMLElement {
  const amount = textInput('', { inputmode: 'decimal', 'aria-label': `Saldo corregido de ${card.label}` })
  const error = formError()
  const save = (event: Event) => {
    event.preventDefault()
    const value = parseAmountInput(amount.value)
    if (value === null) return showError(error, 'Monto no válido.')
    ctx.edit(addAdminBalance(ctx.session.content, card.id, value, ctx.now()))
    ctx.toast('Saldo cargado. Acordate de publicar.')
  }
  return h('form', { class: 'row', on: { submit: save } }, [
    amount,
    h('button', { class: 'small-button secondary', text: 'Cargar saldo', attrs: { type: 'submit' } }),
    error,
  ])
}

export function cardsSection(ctx: AdminContext): HTMLElement {
  const container = h('section', { class: 'admin-section' })

  const showList = () => {
    const cards = ctx.session.content.giftCards
    container.replaceChildren(
      h('h2', { text: 'Tarjetas de regalo' }),
      h('p', { class: 'hint', text: 'Los saldos que anota el usuario quedan en su teléfono; acá se ven solo los que cargás vos.' }),
      smallButton('＋ Nueva tarjeta', () => showForm(null), 'primary'),
      ...(cards.length === 0 ? [h('p', { class: 'hint', text: 'Todavía no hay tarjetas.' })] : []),
      h(
        'ul',
        { class: 'admin-list' },
        cards.map((card) => {
          const url = balanceUrl(card)
          return h('li', {}, [
            h('p', { class: 'item-title', text: card.label }),
            h('p', {
              class: 'hint',
              text: `${formatMoney(currentBalance(card, []).amount)} · vence ${card.expiresOn} · ••••${card.redeemCode.slice(-4)}`,
            }),
            url && h('a', { text: 'Ver saldo en la página ↗', attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } }),
            correctedBalance(ctx, card),
            h('div', { class: 'row' }, [
              smallButton('Editar', () => showForm(card)),
              smallButton('Borrar', () => {
                ctx.edit(moveToTrash(ctx.session.content, 'giftCard', card.id, ctx.now()))
                ctx.toast('La mandaste a la papelera.')
              }, 'danger'),
            ]),
          ])
        }),
      ),
    )
  }

  const showForm = (card: GiftCard | null) => {
    container.replaceChildren(cardForm(ctx, card, ctx.rerender))
    container.querySelector('input')?.focus()
  }

  showList()
  return container
}
