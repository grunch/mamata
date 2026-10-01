// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openBalancePage, takePendingBalance } from '../src/app/balance-return.ts'
import type { AppContext, AppState } from '../src/app/context.ts'
import { LocalStore, deleteLocalDatabase } from '../src/app/local-store.ts'
import { asyncImage, sniffImageType } from '../src/app/media.ts'
import { explainerScreen, noteScreen } from '../src/app/screens/balance-flow.ts'
import { cardScreen, cardsScreen, historyScreen } from '../src/app/screens/giftcards.ts'
import { homeScreen } from '../src/app/screens/home.ts'
import { messageScreen, messagesScreen } from '../src/app/screens/messages.ts'
import { remindersScreen } from '../src/app/screens/reminders.ts'
import { settingsScreen } from '../src/app/screens/settings.ts'
import {
  banners,
  noLinkScreen,
  notFoundScreen,
  offlineFirstScreen,
  waitingScreen,
  welcomeScreen,
} from '../src/app/screens/status.ts'
import { announce, h, replaceScreen, screen } from '../src/app/ui.ts'
import { sampleContent } from './fixtures.ts'

// 1 de octubre de 2026, 12:00 en Argentina.
const NOW = new Date('2026-10-01T15:00:00.000Z')

let store: LocalStore

async function makeCtx(overrides: Partial<AppState> = {}) {
  let state: AppState = {
    content: sampleContent(),
    reads: new Set(),
    done: new Set(),
    notes: [],
    offline: false,
    ...overrides,
  }
  const ctx = {
    get state() {
      return state
    },
    store,
    now: () => NOW,
    update: vi.fn((patch: Partial<AppState>) => {
      state = { ...state, ...patch }
    }),
    go: vi.fn(),
    imageUrl: vi.fn(async (): Promise<string | null> => null),
    announce: vi.fn(),
  } satisfies AppContext
  return ctx
}

const text = (el: Element) => el.textContent ?? ''
function button(root: Element, label: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('button, a')].find((b) => text(b).includes(label))
  if (!found) throw new Error(`No hay botón "${label}"`)
  return found
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
  await deleteLocalDatabase()
  store = await LocalStore.open()
  sessionStorage.clear()
  document.body.innerHTML = '<p id="aviso" hidden></p>'
})

afterEach(() => {
  store.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ui', () => {
  it('adds the "Volver al inicio" link unless asked not to', () => {
    expect(text(screen('Hola', []))).toContain('Volver al inicio')
    expect(text(screen('Hola', [], { showHome: false }))).not.toContain('Volver al inicio')
  })

  it('shows an announcement and hides it after a while', () => {
    vi.useFakeTimers()

    announce('¡Listo!')

    const region = document.getElementById('aviso') as HTMLElement
    expect(region.hidden).toBe(false)
    expect(region.textContent).toBe('¡Listo!')
    vi.advanceTimersByTime(7000)
    expect(region.hidden).toBe(true)
  })
})

describe('replaceScreen', () => {
  it('keeps what was typed and the focus when only the state changed', () => {
    const root = h('div')
    document.body.append(root)
    replaceScreen(root, [screen('Uno', [h('input', { attrs: { id: 'monto' } })])], false)
    const before = root.querySelector<HTMLInputElement>('#monto')!
    before.value = '120.000'
    before.focus()

    replaceScreen(root, [screen('Uno', [h('input', { attrs: { id: 'monto' } })])], false)

    const after = root.querySelector<HTMLInputElement>('#monto')!
    expect(after).not.toBe(before)
    expect(after.value).toBe('120.000')
    expect(document.activeElement).toBe(after)
  })

  it('moves the focus to the title when the focused control is gone', () => {
    const root = h('div')
    document.body.append(root)
    replaceScreen(root, [screen('Uno', [h('button', { text: 'Entendido', attrs: { id: 'ok' } })])], false)
    root.querySelector<HTMLElement>('#ok')!.focus()

    replaceScreen(root, [screen('Uno', [])], false)

    expect(document.activeElement).toBe(root.querySelector('h1'))
  })

  it('focuses the title and forgets inputs when navigating', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const root = h('div')
    document.body.append(root)
    replaceScreen(root, [screen('Uno', [h('input', { attrs: { id: 'monto' } })])], false)
    root.querySelector<HTMLInputElement>('#monto')!.value = '5'

    replaceScreen(root, [screen('Dos', [h('input', { attrs: { id: 'monto' } })])], true)

    expect(root.querySelector<HTMLInputElement>('#monto')!.value).toBe('')
    expect(document.activeElement).toBe(root.querySelector('h1'))
  })
})

describe('home screen', () => {
  it('greets the user with today and highlights the newest unread message', async () => {
    const ctx = await makeCtx()

    const el = homeScreen(ctx)

    expect(text(el.querySelector('h1')!)).toBe('¡Hola, Marta!')
    expect(text(el)).toContain('Jueves 1 de octubre')
    expect(text(el.querySelector('.highlight')!)).toContain('¡Mañana vamos a almorzar!')
    expect(text(el)).toContain('Tenés un mensaje nuevo')
  })

  it('just says hello when the name was not set yet', async () => {
    const ctx = await makeCtx({ content: { ...sampleContent(), userName: '' } })

    expect(text(homeScreen(ctx).querySelector('h1')!)).toBe('¡Hola!')
    expect(text(welcomeScreen(ctx.state, null, () => undefined).querySelector('h1')!)).toBe('¡Hola!')
  })

  it('lists today reminders that are not done yet', async () => {
    const ctx = await makeCtx()

    expect(text(homeScreen(ctx))).toContain('Tomar la pastilla')

    const done = await makeCtx({ done: new Set([LocalStore.doneKey('r1', '2026-10-01')]) })
    expect(text(homeScreen(done))).not.toContain('Para hoy')
  })

  it('links to the settings at the bottom', async () => {
    const link = homeScreen(await makeCtx()).querySelector<HTMLAnchorElement>('a[href="#/ajustes"]')

    expect(link?.textContent).toContain('Ajustes')
  })

  it('has no highlight when everything was read', async () => {
    const ctx = await makeCtx({ reads: new Set(['m1']) })

    expect(homeScreen(ctx).querySelector('.highlight')).toBeNull()
  })
})

describe('messages', () => {
  it('separates new messages from previous ones', async () => {
    const el = messagesScreen(await makeCtx())

    const sections = el.querySelectorAll('section')
    expect(text(sections[0]!)).toContain('¡Mañana vamos a almorzar!')
    expect(text(sections[1]!)).toContain('Turno con el médico')
  })

  it('says when there are no messages', async () => {
    const empty = { ...sampleContent(), messages: [] }

    expect(text(messagesScreen(await makeCtx({ content: empty })))).toContain('Todavía no hay mensajes')
  })

  it('marks a message as read with "Entendido" and confirms', async () => {
    const ctx = await makeCtx()
    const el = messageScreen(ctx, 'm1')

    button(el, 'Entendido').click()
    await flush()
    await flush()

    expect(ctx.state.reads.has('m1')).toBe(true)
    expect(await store.readMessageIds()).toEqual(new Set(['m1']))
    expect(ctx.announce).toHaveBeenCalledWith('¡Listo! Lo marcaste como leído.')
  })

  it('shows "Ya lo leíste" instead of the button once read', async () => {
    const el = messageScreen(await makeCtx({ reads: new Set(['m1']) }), 'm1')

    expect(text(el)).toContain('Ya lo leíste')
    expect(text(el)).not.toContain('Entendido')
  })

  it('asks for the image of a message', async () => {
    const ctx = await makeCtx()

    messageScreen(ctx, 'm2')

    expect(ctx.imageUrl).toHaveBeenCalledWith('img1')
  })

  it('shows a friendly page for unknown messages', async () => {
    expect(text(messageScreen(await makeCtx(), 'nope'))).toContain('No encontré ese mensaje')
  })
})

describe('reminders', () => {
  it('groups reminders and marks today as done', async () => {
    const ctx = await makeCtx()
    const el = remindersScreen(ctx)

    expect(text(el)).toContain('Hoy')
    expect(text(el)).toContain('Próximos')
    expect(text(el)).toContain('08:00')

    button(el, 'Ya lo hice').click()
    await flush()
    await flush()

    expect(ctx.state.done.has(LocalStore.doneKey('r1', '2026-10-01'))).toBe(true)
    expect(ctx.announce).toHaveBeenCalledWith('¡Listo! Lo marcaste como hecho.')
  })

  it('says when there are no reminders', async () => {
    const content = { ...sampleContent(), reminders: [] }

    expect(text(remindersScreen(await makeCtx({ content })))).toContain('No hay recordatorios')
  })
})

describe('gift cards', () => {
  it('lists cards with their current balance', async () => {
    const el = cardsScreen(await makeCtx())

    expect(text(el)).toContain('Gift card del cumpleaños')
    expect(text(el)).toContain('$ 150.000')
  })

  it('shows the latest noted balance with its date', async () => {
    const notes = [{ cardId: 'g1', amount: 120000, at: '2026-10-01T13:30:00.000Z' }]

    const el = cardScreen(await makeCtx({ notes }), 'g1')

    expect(text(el)).toContain('$ 120.000')
    expect(text(el)).toContain('Anotado hoy a las 10:30')
    expect(text(el)).toContain('Se puede usar en: Día, Carrefour.')
  })

  it('warns when the card expires soon', async () => {
    const content = sampleContent()
    const soon = { ...content, giftCards: [{ ...content.giftCards[0]!, expiresOn: '2026-10-11' }] }

    expect(text(cardScreen(await makeCtx({ content: soon }), 'g1').querySelector('.expiry.warn')!)).toContain(
      'Vence en 10 días',
    )
  })

  it('goes to the explanation before opening the balance page', async () => {
    const ctx = await makeCtx()

    button(cardScreen(ctx, 'g1'), 'Ver saldo').click()
    await flush()

    expect(ctx.go).toHaveBeenCalledWith({ name: 'card-explainer', id: 'g1' })
  })

  it('opens the balance page directly when the explanation was dismissed', async () => {
    await store.setPref('skipBalanceExplainer', true)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const ctx = await makeCtx()

    button(cardScreen(ctx, 'g1'), 'Ver saldo').click()
    await flush()
    await flush()

    expect(open).toHaveBeenCalledWith(
      'https://tienda.ohgiftcard.com.ar/redeem?redeemCode=0000111122223333',
      '_blank',
      'noopener',
    )
  })

  it('shows the history newest first with what was spent', async () => {
    const notes = [{ cardId: 'g1', amount: 120000, at: '2026-09-25T15:00:00.000Z' }]

    const items = historyScreen(await makeCtx({ notes }), 'g1').querySelectorAll('.history li')

    expect(text(items[0]!)).toContain('$ 120.000')
    expect(text(items[0]!)).toContain('Gastaste $ 30.000')
    expect(text(items[2]!)).toContain('Al principio')
  })

  it('shows a friendly page for unknown cards', async () => {
    const ctx = await makeCtx()

    for (const render of [cardScreen, historyScreen, explainerScreen, noteScreen]) {
      expect(text(render(ctx, 'nope'))).toContain('No encontré esa tarjeta')
    }
  })
})

describe('balance flow', () => {
  it('remembers the card, opens the page and can skip the explanation next time', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const ctx = await makeCtx()
    const el = explainerScreen(ctx, 'g1')

    el.querySelector<HTMLInputElement>('#no-mostrar')!.checked = true
    button(el, 'Ver mi saldo').click()
    await flush()
    await flush()

    expect(open).toHaveBeenCalled()
    expect(await store.getPref('skipBalanceExplainer')).toBe(true)
    expect(takePendingBalance()).toBe('g1')
    expect(ctx.go).toHaveBeenCalledWith({ name: 'card', id: 'g1' })
  })

  it('opens the balance page even if saving the preference fails', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    vi.spyOn(store, 'setPref').mockRejectedValue(new Error('cuota llena'))
    const el = explainerScreen(await makeCtx(), 'g1')

    el.querySelector<HTMLInputElement>('#no-mostrar')!.checked = true
    button(el, 'Ver mi saldo').click()

    expect(open).toHaveBeenCalledTimes(1)
    await flush()
  })

  it('saves only once when "Guardar" is tapped twice', async () => {
    const ctx = await makeCtx()
    const el = noteScreen(ctx, 'g1')
    document.body.append(el)

    el.querySelector<HTMLInputElement>('#monto')!.value = '100.000'
    el.querySelector('form')!.requestSubmit()
    el.querySelector('form')!.requestSubmit()
    await flush()
    await flush()

    expect(await store.balanceNotes()).toHaveLength(1)
  })

  it('asks for a valid number', async () => {
    const el = noteScreen(await makeCtx(), 'g1')
    document.body.append(el)

    el.querySelector<HTMLInputElement>('#monto')!.value = 'mucho'
    el.querySelector('form')!.requestSubmit()

    expect(el.querySelector<HTMLElement>('#error')!.hidden).toBe(false)
  })

  it('saves the amount, confirms and goes back to the card', async () => {
    const ctx = await makeCtx()
    const el = noteScreen(ctx, 'g1')
    document.body.append(el)

    el.querySelector<HTMLInputElement>('#monto')!.value = '120.000'
    el.querySelector('form')!.requestSubmit()
    await flush()
    await flush()

    expect(await store.balanceNotes()).toMatchObject([{ cardId: 'g1', amount: 120000 }])
    expect(ctx.announce).toHaveBeenCalledWith('¡Listo! Anotaste que te quedan $ 120.000.')
    expect(ctx.go).toHaveBeenCalledWith({ name: 'card', id: 'g1' })
  })

  it('asks to confirm a balance higher than before and lets the user fix it', async () => {
    const ctx = await makeCtx()
    const el = noteScreen(ctx, 'g1')
    document.body.append(el)

    el.querySelector<HTMLInputElement>('#monto')!.value = '500.000'
    el.querySelector('form')!.requestSubmit()

    const confirmBox = el.querySelector<HTMLElement>('.confirm')!
    expect(confirmBox.hidden).toBe(false)
    expect(text(confirmBox)).toContain('¿Seguro? Antes tenías $ 150.000.')

    button(confirmBox, 'Corregir').click()
    expect(confirmBox.hidden).toBe(true)

    el.querySelector('form')!.requestSubmit()
    button(confirmBox, 'Sí, es correcto').click()
    await flush()
    await flush()

    expect(await store.balanceNotes()).toMatchObject([{ amount: 500000 }])
  })

  it('mentions the last noted amount as a reference', async () => {
    const notes = [{ cardId: 'g1', amount: 120000, at: '2026-09-25T15:00:00.000Z' }]

    expect(text(noteScreen(await makeCtx({ notes }), 'g1'))).toContain('La última vez anotaste $ 120.000.')
  })
})

describe('balance return', () => {
  it('returns the pending card only once', () => {
    const open = vi.fn()

    openBalancePage('https://x', 'g1', sessionStorage, open)

    expect(open).toHaveBeenCalledWith('https://x', '_blank', 'noopener')
    expect(takePendingBalance()).toBe('g1')
    expect(takePendingBalance()).toBeNull()
  })
})

describe('status screens', () => {
  it('asks for the link without technical words', () => {
    expect(text(noLinkScreen())).toContain('pedile el link a tu familiar')
    expect(text(notFoundScreen('No está'))).toContain('No está')
  })

  it('retries from the offline screen', () => {
    const retry = vi.fn()

    button(offlineFirstScreen(retry), 'Probar de nuevo').click()

    expect(retry).toHaveBeenCalled()
  })

  it('shows a soft banner when offline', async () => {
    expect(banners((await makeCtx({ offline: true })).state).map(text)).toEqual([
      'Sin internet. Te muestro la última información guardada.',
    ])
    expect(banners((await makeCtx()).state)).toEqual([])
  })

  it('waits for approval showing the pairing code big', () => {
    const el = waitingScreen('4821')

    expect(text(el.querySelector('.pairing-code')!)).toBe('4821')
    expect(text(el)).toContain('Esperando que tu familiar te habilite')
    expect(text(el)).not.toContain('Volver al inicio')
  })

  it('welcomes with install steps or the install button', async () => {
    const ctx = await makeCtx()
    const start = vi.fn()

    const manual = welcomeScreen(ctx.state, null, start)
    expect(text(manual)).toContain('Agregar a la pantalla de inicio')
    button(manual, 'Empezar').click()
    expect(start).toHaveBeenCalled()

    const prompt = vi.fn(async () => undefined)
    button(welcomeScreen(ctx.state, { prompt }, start), 'Agregar a la pantalla de inicio').click()
    expect(prompt).toHaveBeenCalled()
  })
})

describe('settings', () => {
  const secret = new Uint8Array(32).fill(7)

  it('shows the phone npub and pairing code, and hides the private key behind a warning', () => {
    const el = settingsScreen(secret)
    document.body.append(el)

    expect(text(el)).toMatch(/npub1[02-9ac-hj-np-z]{58}/)
    expect(el.querySelector('.pairing-code')?.textContent).toMatch(/^\d{6}$/)
    expect(text(el)).not.toContain('nsec1')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    button(el, 'Mostrar clave privada').click()

    expect(text(el)).toMatch(/nsec1[02-9ac-hj-np-z]{58}/)
  })

  it('keeps the private key hidden if the user cancels', () => {
    const el = settingsScreen(secret)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    button(el, 'Mostrar clave privada').click()

    expect(text(el)).not.toContain('nsec1')
  })
})

describe('media', () => {
  it('recognizes image formats by their signature', () => {
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
    const webp = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')])
    expect(sniffImageType(webp)).toBe('image/webp')
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBe('application/octet-stream')
  })

  it('reveals the image once it is ready', async () => {
    const ctx = await makeCtx()
    ctx.imageUrl.mockResolvedValueOnce('blob:foto')

    const img = asyncImage(ctx, 'img1', 'Foto')
    expect(img.hidden).toBe(true)
    await flush()

    expect(img.hidden).toBe(false)
    expect(img.getAttribute('src')).toBe('blob:foto')
  })
})
