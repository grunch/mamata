// @vitest-environment jsdom
import { npubEncode } from 'nostr-tools/nip19'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminContext, AdminSession } from '../src/admin/context.ts'
import type { Device } from '../src/admin/devices.ts'
import { cardsSection } from '../src/admin/screens/cards.ts'
import { linkSection } from '../src/admin/screens/link.ts'
import { messagesSection } from '../src/admin/screens/messages.ts'
import { remindersSection } from '../src/admin/screens/reminders.ts'
import { setupScreen } from '../src/admin/screens/setup.ts'
import { trashSection } from '../src/admin/screens/trash.ts'
import { moveToTrash } from '../src/admin/draft.ts'
import type { Content } from '../src/shared/model.ts'
import { sampleContent } from './fixtures.ts'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(async () => undefined) } }))

const NOW = '2026-10-01T15:00:00.000Z'
const ADMIN = getPublicKey(generateSecretKey())

function makeCtx(content: Content = sampleContent(), devices: Device[] = []) {
  let session: AdminSession = { adminPubkey: ADMIN, content, devices, publishing: false, unpublished: 0 }
  const ctx = {
    get session() {
      return session
    },
    now: () => NOW,
    edit: vi.fn((next: Content) => {
      session = { ...session, content: next }
    }),
    addImage: vi.fn(() => 'img-nueva'),
    imageUrl: vi.fn(async (): Promise<string | null> => null),
    toast: vi.fn(),
    rerender: vi.fn(),
    approve: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
    refreshDevices: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    logout: vi.fn(),
  } satisfies AdminContext
  return ctx
}

const text = (el: Element) => el.textContent ?? ''
function button(root: Element, label: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('button, a')].find((b) => text(b).includes(label))
  if (!found) throw new Error(`No hay botón "${label}"`)
  return found
}
function input(root: Element, label: string): HTMLInputElement {
  const found = [...root.querySelectorAll('label')].find((l) => text(l).startsWith(label))
  const control = found && root.querySelector<HTMLInputElement>(`#${found.htmlFor}`)
  if (!control) throw new Error(`No hay campo "${label}"`)
  return control
}
function mount<T extends HTMLElement>(el: T): T {
  document.body.replaceChildren(el)
  return el
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('messages section', () => {
  it('lists messages newest first with their state', () => {
    const items = messagesSection(makeCtx()).querySelectorAll('.admin-list li')

    expect(text(items[0]!)).toContain('¡Mañana vamos a almorzar!')
    expect(text(items[1]!)).toContain('Archivado')
  })

  it('archives, unarchives and sends to the trash', () => {
    const ctx = makeCtx()
    const el = messagesSection(ctx)
    const [first, second] = el.querySelectorAll('.admin-list li')

    button(first!, 'Archivar').click()
    expect(ctx.session.content.messages.find((m) => m.id === 'm1')?.archivedAt).toBe(NOW)

    button(second!, 'Desarchivar').click()
    expect(ctx.session.content.messages.find((m) => m.id === 'm2')).not.toHaveProperty('archivedAt')

    button(first!, 'Borrar').click()
    expect(ctx.session.content.trash).toHaveLength(1)
    expect(ctx.toast).toHaveBeenCalledWith('Lo mandaste a la papelera.')
  })

  it('validates and saves a new message with a live preview', async () => {
    const ctx = makeCtx()
    const el = mount(messagesSection(ctx))
    button(el, 'Nuevo mensaje').click()

    el.querySelector('form')!.requestSubmit()
    expect(text(el.querySelector('.error')!)).toContain('Faltan el título o el texto')

    input(el, 'Título').value = 'Hola'
    input(el, 'Título').dispatchEvent(new Event('input'))
    expect(text(el.querySelector('.preview')!)).toContain('Hola')
    ;(el.querySelector('textarea') as HTMLTextAreaElement).value = 'Paso a las 5'
    input(el, 'Emoji').value = '☕'
    el.querySelector('form')!.requestSubmit()
    await flush()

    const saved = ctx.session.content.messages.at(-1)
    expect(saved).toMatchObject({ title: 'Hola', body: 'Paso a las 5', emoji: '☕', style: 'normal', createdAt: NOW })
    expect(ctx.rerender).toHaveBeenCalled()
  })

  it('edits an existing message keeping its id', async () => {
    const ctx = makeCtx()
    const el = mount(messagesSection(ctx))
    button(el.querySelector('.admin-list li')!, 'Editar').click()

    expect(input(el, 'Título').value).toBe('¡Mañana vamos a almorzar!')
    input(el, 'Título').value = 'Cambiado'
    el.querySelector('form')!.requestSubmit()
    await flush()

    expect(ctx.session.content.messages.find((m) => m.id === 'm1')?.title).toBe('Cambiado')
  })
})

describe('reminders section', () => {
  it('saves a reminder in Argentina time', () => {
    const ctx = makeCtx()
    const el = mount(remindersSection(ctx))
    button(el, 'Nuevo recordatorio').click()

    el.querySelector('form')!.requestSubmit()
    expect(text(el.querySelector('.error')!)).toContain('Falta el título')

    input(el, 'Título').value = 'Médico'
    input(el, 'Fecha').value = '2026-10-05'
    input(el, 'Hora').value = '09:30'
    el.querySelector('form')!.requestSubmit()

    expect(ctx.session.content.reminders.at(-1)).toMatchObject({
      title: 'Médico',
      startsAt: '2026-10-05T12:30:00.000Z',
      repeat: 'once',
      icon: '⏰',
    })
  })

  it('pauses, resumes and deletes', () => {
    const ctx = makeCtx()
    const el = remindersSection(ctx)

    button(el, 'Pausar').click()
    expect(ctx.session.content.reminders[0]?.pausedAt).toBe(NOW)

    const paused = remindersSection(ctx)
    button(paused, 'Reanudar').click()
    expect(ctx.session.content.reminders[0]).not.toHaveProperty('pausedAt')

    button(paused, 'Borrar').click()
    expect(ctx.session.content.reminders).toEqual([])
  })

  it('pre-fills the form when editing', () => {
    const el = mount(remindersSection(makeCtx()))
    button(el, 'Editar').click()

    expect(input(el, 'Fecha').value).toBe('2026-09-01')
    expect(input(el, 'Hora').value).toBe('08:00')
  })
})

describe('cards section', () => {
  it('validates and saves a card from the balance link', async () => {
    const ctx = makeCtx()
    const el = mount(cardsSection(ctx))
    button(el, 'Nueva tarjeta').click()

    input(el, 'Nombre').value = 'Navidad'
    input(el, 'Código').value = 'no sé'
    el.querySelector('form')!.requestSubmit()
    await flush()
    expect(text(el.querySelector('.error')!)).toContain('16 números')

    input(el, 'Código').value = 'https://tienda.ohgiftcard.com.ar/redeem?redeemCode=1111222233334444'
    input(el, 'Monto inicial').value = '50.000'
    input(el, 'Vence el').value = '2027-01-31'
    el.querySelector('form')!.requestSubmit()
    await flush()

    expect(ctx.session.content.giftCards.at(-1)).toMatchObject({
      label: 'Navidad',
      redeemCode: '1111222233334444',
      initialAmount: 50000,
      expiresOn: '2027-01-31',
      brands: ['Día', 'Carrefour'],
    })
  })

  it('loads a corrected balance and hides most of the code', () => {
    const ctx = makeCtx()
    const el = cardsSection(ctx)

    expect(text(el)).toContain('••••3333')
    expect(text(el)).not.toContain('0000111122223333')

    const form = el.querySelector<HTMLFormElement>('.admin-list form')!
    form.querySelector('input')!.value = '90.000'
    form.dispatchEvent(new Event('submit', { cancelable: true }))

    expect(ctx.session.content.giftCards[0]?.adminBalances.at(-1)).toEqual({ amount: 90000, at: NOW })
  })

  it('sends a card to the trash', () => {
    const ctx = makeCtx()

    button(cardsSection(ctx), 'Borrar').click()

    expect(ctx.session.content.giftCards).toEqual([])
  })
})

describe('trash section', () => {
  it('restores deleted items', () => {
    const ctx = makeCtx(moveToTrash(sampleContent(), 'giftCard', 'g1', NOW))
    const el = trashSection(ctx)

    expect(text(el)).toContain('Gift card del cumpleaños')
    button(el, 'Recuperar').click()

    expect(ctx.session.content.giftCards.map((c) => c.id)).toEqual(['g1'])
  })

  it('says when it is empty', () => {
    expect(text(trashSection(makeCtx()))).toContain('La papelera está vacía')
  })
})

describe('link section', () => {
  const device = (status: Device['status'], code = '482113', suspicious = false): Device => ({
    pubkey: getPublicKey(generateSecretKey()),
    code,
    status,
    requestedAt: Date.parse('2026-10-01T14:58:00.000Z') / 1000,
    suspicious,
    keyAt: 0,
  })

  it('shows the public pairing link with the admin npub and copies it', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const ctx = makeCtx()
    const el = linkSection(ctx)
    const link = `https://mamata.live/#npub=${npubEncode(ADMIN)}`

    expect(el.querySelector<HTMLInputElement>('input')!.value).toBe(link)
    button(el, 'Copiar link').click()
    await flush()

    expect(writeText).toHaveBeenCalledWith(link)
  })

  it('shows pending phones with their code and approves them', () => {
    const pending = device('pending', '482113')
    const ctx = makeCtx(sampleContent(), [pending])
    const el = linkSection(ctx)

    expect(text(el)).toContain('482113')
    button(el, 'Aprobar').click()

    expect(ctx.approve).toHaveBeenCalledWith(pending.pubkey)
  })

  it('does not let you approve two phones that share a code', () => {
    const ctx = makeCtx(sampleContent(), [device('pending', '482113', true), device('pending', '482113', true)])
    const el = linkSection(ctx)

    expect(text(el)).toContain('Hay otro pedido con el mismo código')
    expect(el.querySelectorAll('button')).not.toContain(expect.objectContaining({ textContent: 'Aprobar' }))
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Aprobar')).toBe(false)
  })

  it('says when each phone asked for access', () => {
    const el = linkSection(makeCtx(sampleContent(), [device('pending')]))

    expect(text(el)).toContain('Pidió acceso hoy a las 11:58')
  })

  it('removes access to an approved phone only after confirming', () => {
    const approved = device('approved', '123456')
    const ctx = makeCtx(sampleContent(), [approved])
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const el = linkSection(ctx)

    button(el, 'Quitar acceso').click()
    expect(ctx.revoke).not.toHaveBeenCalled()
    button(el, 'Quitar acceso').click()

    expect(ctx.revoke).toHaveBeenCalledWith(approved.pubkey)
  })

  it('says when there are no phones yet and can look for new requests', () => {
    const ctx = makeCtx()
    const el = linkSection(ctx)

    expect(text(el)).toContain('Todavía no hay teléfonos')
    button(el, 'Buscar pedidos nuevos').click()

    expect(ctx.refreshDevices).toHaveBeenCalled()
  })

  it('logs out', () => {
    const ctx = makeCtx()

    button(linkSection(ctx), 'Cerrar sesión').click()

    expect(ctx.logout).toHaveBeenCalled()
  })
})

describe('setup screen', () => {
  it('requires a valid nsec', async () => {
    const onSubmit = vi.fn(async () => null)
    const el = mount(setupScreen(onSubmit))

    input(el, 'Clave privada').value = 'npub1noesunansec'
    el.querySelector('form')!.requestSubmit()
    await flush()

    expect(text(el.querySelector('.error')!)).toContain('nsec')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('enters with the nsec and the names for a first publication', async () => {
    const onSubmit = vi.fn(async () => 'No pude conectar con los relays')
    const el = mount(setupScreen(onSubmit))
    const nsec = nsecEncode(generateSecretKey())

    input(el, 'Clave privada').value = ` ${nsec} `
    input(el, 'Nombre de quien usa la app').value = 'Marta'
    el.querySelector('form')!.requestSubmit()
    await flush()

    expect(onSubmit).toHaveBeenCalledWith({
      setting: { mode: 'nsec', nsec },
      names: { userName: 'Marta', adminName: 'tu familiar' },
    })
    expect(text(el.querySelector('.error')!)).toContain('No pude conectar')
  })

  it('generates a new nsec, shows it once to save it and enters with it', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onSubmit = vi.fn(async () => null)
    const el = mount(setupScreen(onSubmit))

    button(el, 'Generar una clave nueva').click()

    const nsec = input(el, 'Clave privada').value
    expect(nsec).toMatch(/^nsec1[02-9ac-hj-np-z]{58}$/)
    const shown = el.querySelector('.new-key')!
    expect(text(shown)).toContain(nsec)
    expect(text(shown)).toContain('gestor de contraseñas')

    button(shown, 'Copiar clave').click()
    await flush()
    expect(writeText).toHaveBeenCalledWith(nsec)

    el.querySelector('form')!.requestSubmit()
    await flush()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ setting: { mode: 'nsec', nsec } }))
  })

  it('can use a browser extension instead', async () => {
    const onSubmit = vi.fn(async () => null)
    const el = mount(setupScreen(onSubmit, 'Mensaje inicial'))
    expect(text(el.querySelector('.error')!)).toBe('Mensaje inicial')

    button(el, 'Usar extensión').click()
    await flush()

    expect(onSubmit).toHaveBeenCalledWith({ setting: { mode: 'nip07' }, names: { userName: 'Marta', adminName: 'tu familiar' } })
  })
})
