import { currentBalance, balanceHistory, formatMoney, type BalanceEntry } from '../../shared/balance.ts'
import { daysUntil, formatDayMonth, formatNoted } from '../../shared/dates.ts'
import type { GiftCard } from '../../shared/model.ts'
import { balanceUrl, PROVIDERS } from '../../shared/providers.ts'
import type { AppContext } from '../context.ts'
import { asyncImage } from '../media.ts'
import { routeHref } from '../router.ts'
import { bigButton, bigLink, h, screen } from '../ui.ts'
import { startBalanceCheck } from './balance-flow.ts'
import { notFoundScreen } from './status.ts'

const EXPIRY_WARNING_DAYS = 30

export function findCard(ctx: AppContext, id: string): GiftCard | undefined {
  return ctx.state.content.giftCards.find((c) => c.id === id)
}

function balanceCaption(entry: BalanceEntry, now: Date): string {
  if (entry.source === 'inicial') return 'Es lo que tenía la tarjeta al principio.'
  return `Anotado ${formatNoted(new Date(entry.at), now)}.`
}

function expiryText(card: GiftCard, now: Date): { text: string; warn: boolean } {
  const days = daysUntil(card.expiresOn, now)
  const [y, m, d] = card.expiresOn.split('-').map(Number)
  const date = `${formatDayMonth(new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 15)))} de ${y}`
  if (days < 0) return { text: `Esta tarjeta venció el ${date}.`, warn: true }
  if (days === 0) return { text: '⚠️ Esta tarjeta vence hoy.', warn: true }
  if (days === 1) return { text: '⚠️ Esta tarjeta vence mañana.', warn: true }
  if (days <= EXPIRY_WARNING_DAYS) return { text: `⚠️ Vence en ${days} días (${date}).`, warn: true }
  return { text: `Vence el ${date}.`, warn: false }
}

export function cardsScreen(ctx: AppContext): HTMLElement {
  const { giftCards } = ctx.state.content
  return screen('Tarjetas de regalo', [
    giftCards.length === 0 && h('p', { class: 'empty', text: 'Todavía no hay tarjetas.' }),
    h(
      'ul',
      { class: 'plain-list' },
      giftCards.map((card) =>
        h('li', {}, [
          h('a', { class: 'card-row', attrs: { href: routeHref({ name: 'card', id: card.id }) } }, [
            card.imageId && asyncImage(ctx, card.imageId, '', 'thumb'),
            h('span', { class: 'row-title', text: card.label }),
            h('span', { class: 'amount', text: formatMoney(currentBalance(card, ctx.state.notes).amount) }),
          ]),
        ]),
      ),
    ),
  ])
}

export function cardScreen(ctx: AppContext, id: string): HTMLElement {
  const card = findCard(ctx, id)
  if (!card) return notFoundScreen('No encontré esa tarjeta.')
  const now = ctx.now()
  const current = currentBalance(card, ctx.state.notes)
  const provider = PROVIDERS[card.providerId]
  const expiry = expiryText(card, now)
  const canCheck = balanceUrl(card) !== null

  const onCheck = async () => {
    if (await ctx.store.getPref('skipBalanceExplainer')) startBalanceCheck(ctx, card)
    else ctx.go({ name: 'card-explainer', id })
  }

  return screen(card.label, [
    card.imageId && asyncImage(ctx, card.imageId, `Foto de la tarjeta ${card.label}`, 'card-photo'),
    h('section', { class: 'balance-box', attrs: { 'aria-labelledby': 'saldo' } }, [
      h('h2', { text: 'Te queda', attrs: { id: 'saldo' } }),
      h('p', { class: 'amount big', text: formatMoney(current.amount) }),
      h('p', { class: 'caption', text: balanceCaption(current, now) }),
    ]),
    h('p', { class: expiry.warn ? 'expiry warn' : 'expiry', text: expiry.text }),
    card.brands.length > 0 && h('p', { class: 'brands', text: `Se puede usar en: ${card.brands.join(', ')}.` }),
    provider && h('p', { class: 'provider', text: `Tarjeta ${provider.name}` }),
    h('div', { class: 'actions' }, [
      canCheck && bigButton('💳', 'Ver saldo', () => void onCheck()),
      bigLink('📋', 'Ver lo que fui anotando', routeHref({ name: 'card-history', id }), 'quiet'),
      bigLink('🎁', 'Ver todas las tarjetas', '#/tarjetas', 'quiet'),
    ]),
  ])
}

const SOURCE_LABEL: Record<BalanceEntry['source'], string> = {
  inicial: 'Al principio',
  admin: 'Lo cargó tu familiar',
  usuario: 'Lo anotaste vos',
}

export function historyScreen(ctx: AppContext, id: string): HTMLElement {
  const card = findCard(ctx, id)
  if (!card) return notFoundScreen('No encontré esa tarjeta.')
  const now = ctx.now()
  const entries = balanceHistory(card, ctx.state.notes).reverse()

  return screen('Lo que fui anotando', [
    h('p', { class: 'body', text: card.label }),
    h(
      'ol',
      { class: 'plain-list history' },
      entries.map((entry) =>
        h('li', {}, [
          h('p', { class: 'amount', text: formatMoney(entry.amount) }),
          h('p', { class: 'caption', text: `${SOURCE_LABEL[entry.source]}, ${formatNoted(new Date(entry.at), now)}` }),
          entry.spent !== null && entry.spent > 0 && h('p', { class: 'spent', text: `Gastaste ${formatMoney(entry.spent)}` }),
        ]),
      ),
    ),
    bigLink('💳', 'Volver a la tarjeta', routeHref({ name: 'card', id }), 'quiet'),
  ])
}
