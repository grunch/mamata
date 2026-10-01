import { expect, test, type Page } from '@playwright/test'
import { npubEncode, nsecEncode } from 'nostr-tools/nip19'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { KIND } from '../src/shared/nostr/constants.ts'
import { generateContentKey, openItem, sealItem } from '../src/shared/nostr/content-key.ts'
import { envelopeFor, itemTemplate } from '../src/shared/nostr/events.ts'
import {
  deviceKeyTemplate,
  openDeviceKey,
  pairingRequestTemplate,
  revokedDeviceKeyTemplate,
} from '../src/shared/nostr/keys.ts'
import { pairingCode } from '../src/shared/nostr/pairing.ts'
import { LocalSigner } from '../src/shared/nostr/signer.ts'
import { FakeRelay } from './fake-relay.ts'

const DAY = 24 * 60 * 60 * 1000

// Un admin "de mentira" que publica desde el test, como lo haría el panel.
function testAdmin() {
  const secret = generateSecretKey()
  const signer = new LocalSigner(secret)
  const pubkey = getPublicKey(secret)
  const contentKey = generateContentKey()
  let clock = Math.floor(Date.now() / 1000)
  const item = async (kind: number, d: string, value: unknown) =>
    signer.signEvent(itemTemplate(kind, d, sealItem(contentKey, value), ++clock))
  return {
    pubkey,
    link: `/#npub=${npubEncode(pubkey)}`,
    profile: () => item(KIND.profile, 'perfil', { userName: 'Marta', adminName: 'Fer' }),
    message: (id: string, title: string) =>
      item(
        KIND.message,
        id,
        envelopeFor({
          kind: KIND.message,
          item: { id, title, body: 'Paso a las 5.', style: 'buena-noticia', createdAt: new Date().toISOString() },
        }),
      ),
    giftCard: () =>
      item(
        KIND.giftCard,
        'cumple',
        envelopeFor({
          kind: KIND.giftCard,
          item: {
            id: 'cumple',
            providerId: 'ohgiftcard',
            label: 'Tarjeta del cumpleaños',
            redeemCode: '0000111122223333',
            brands: ['Día', 'Carrefour'],
            initialAmount: 200000,
            currency: 'ARS',
            expiresOn: new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10),
            adminBalances: [],
            createdAt: new Date().toISOString(),
          },
        }),
      ),
    approve: async (phone: string) => signer.signEvent(await deviceKeyTemplate(signer, phone, contentKey, ++clock)),
    revoke: (phone: string) => signer.signEvent(revokedDeviceKeyTemplate(phone, ++clock)),
  }
}

async function waitForPairingRequest(relay: FakeRelay): Promise<string> {
  await expect.poll(() => relay.find({ kinds: [KIND.pairingRequest] }).length).toBeGreaterThan(0)
  return relay.find({ kinds: [KIND.pairingRequest] })[0]!.pubkey
}

// Teléfono vinculado y aprobado, con contenido y la bienvenida ya pasada.
async function pairedPhone(page: Page) {
  const relay = await FakeRelay.attach(page)
  const admin = testAdmin()
  relay.publish(await admin.profile())
  relay.publish(await admin.message('hola', '¡Hola mamá!'))
  relay.publish(await admin.giftCard())
  await page.goto(admin.link)
  const phone = await waitForPairingRequest(relay)
  relay.publish(await admin.approve(phone))
  await page.getByRole('button', { name: 'Empezar' }).click()
  return { relay, admin, phone }
}

// Simula la vuelta desde la pestaña de Chrome (la X): la app vuelve a estar visible.
async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

test.describe('app del usuario', () => {
  test.beforeEach(async ({ page }) => {
    // window.open se reemplaza para registrar qué página se abrió sin salir del test.
    await page.addInitScript(() => {
      const opened: string[] = []
      Object.assign(window, { __opened: opened })
      window.open = (url) => {
        opened.push(String(url))
        return null
      }
    })
  })

  test('sin link muestra cómo pedirlo', async ({ page }) => {
    await FakeRelay.attach(page)
    await page.goto('/')

    await expect(page.getByText('Para ver tus cosas, pedile el link a tu familiar.')).toBeVisible()
  })

  test('con el link pide acceso y muestra el código para comparar', async ({ page }) => {
    const relay = await FakeRelay.attach(page)
    const admin = testAdmin()

    await page.goto(admin.link)
    const phone = await waitForPairingRequest(relay)

    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByText('Esperando que tu familiar te habilite.')).toBeVisible()
    await expect(page.locator('.pairing-code')).toHaveText(pairingCode(phone))
    expect(relay.find({ kinds: [KIND.pairingRequest] })[0]?.tags).toContainEqual(['p', admin.pubkey])
  })

  test('un link de otro admin no cambia a quién le hace caso el teléfono', async ({ page }) => {
    const relay = await FakeRelay.attach(page)
    const admin = testAdmin()
    const intruder = testAdmin()
    await page.goto(admin.link)
    await waitForPairingRequest(relay)

    await page.goto(intruder.link)
    await page.reload()
    await expect(page.getByText('Esperando que tu familiar te habilite.')).toBeVisible()

    const asked = relay.find({ kinds: [KIND.pairingRequest] }).flatMap((e) => e.tags.filter((t) => t[0] === 'p').map((t) => t[1]))
    expect(asked).not.toContain(intruder.pubkey)
  })

  test('cuando el admin aprueba aparece todo, y lo nuevo llega en vivo', async ({ page }) => {
    const { relay, admin } = await pairedPhone(page)

    await expect(page.getByRole('heading', { level: 1, name: '¡Hola, Marta!' })).toBeVisible()
    await expect(page.getByText('¡Hola mamá!')).toBeVisible()

    relay.publish(await admin.message('nuevo', 'Mensaje en vivo'))

    await expect(page.getByText('Tenés 2 mensajes nuevos')).toBeVisible()
  })

  test('ver saldo, volver y anotar cuánto queda', async ({ page }) => {
    await pairedPhone(page)
    await page.getByRole('link', { name: 'Tarjetas de regalo' }).click()
    await page.getByRole('link', { name: /Tarjeta del cumpleaños/ }).click()

    await page.getByRole('button', { name: 'Ver saldo' }).click()
    await expect(page.getByText('Para volver acá, tocá la X')).toBeVisible()
    await page.getByRole('button', { name: 'Ver mi saldo' }).click()

    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
    expect(opened).toEqual(['https://tienda.ohgiftcard.com.ar/redeem?redeemCode=0000111122223333'])

    await comeBack(page)
    await expect(page.getByRole('heading', { name: '¿Cuánto te queda en esta gift card?' })).toBeVisible()
    const amount = page.getByLabel('Escribí el número que te mostró la página:')
    await amount.fill('250.000')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText('¿Seguro? Antes tenías $ 200.000.')).toBeVisible()
    await page.getByRole('button', { name: 'Corregir' }).click()
    await amount.fill('120.000')
    await page.getByRole('button', { name: 'Guardar' }).click()

    await expect(page.getByText('¡Listo! Anotaste que te quedan $ 120.000.')).toBeVisible()
    await expect(page.locator('.amount.big')).toHaveText('$ 120.000')
  })

  test('sin internet sigue mostrando lo guardado', async ({ page, context }) => {
    await pairedPhone(page)
    await expect(page.getByRole('heading', { name: '¡Hola, Marta!' })).toBeVisible()

    await context.setOffline(true)

    await expect(page.getByText('Sin internet. Te muestro la última información guardada.')).toBeVisible()
    await expect(page.getByText('¡Hola mamá!')).toBeVisible()
  })

  test('si el admin le quita el acceso, vuelve a esperar', async ({ page }) => {
    const { relay, admin, phone } = await pairedPhone(page)
    await expect(page.getByText('¡Hola mamá!')).toBeVisible()

    relay.publish(await admin.revoke(phone))

    await expect(page.getByText('Esperando que tu familiar te habilite.')).toBeVisible()
  })

  test('ajustes muestra la identidad del teléfono', async ({ page }) => {
    const { phone } = await pairedPhone(page)

    await page.getByRole('link', { name: 'Ajustes' }).click()

    await expect(page.getByText(npubEncode(phone))).toBeVisible()
    await expect(page.locator('.pairing-code')).toHaveText(pairingCode(phone))
  })
})

test.describe('panel admin', () => {
  test('entra con la nsec, publica cifrado y aprueba un teléfono', async ({ page }) => {
    const relay = await FakeRelay.attach(page)
    const adminSecret = generateSecretKey()
    const adminPubkey = getPublicKey(adminSecret)
    page.on('dialog', (dialog) => void dialog.accept())

    await page.goto('/admin/')
    await page.getByLabel('Clave privada (nsec)').fill(nsecEncode(adminSecret))
    await page.getByRole('button', { name: 'Entrar con la nsec' }).click()

    // Sin nombres todavía: abre en Ajustes para cargarlos.
    await expect(page.getByText('Completá los nombres')).toBeVisible()
    await page.getByLabel('Nombre de quien usa la app').fill('Marta')
    await page.getByLabel('Tu nombre (así te nombra la app)').fill('Fer')
    await page.getByRole('button', { name: 'Guardar nombres' }).click()
    await expect(page.getByText('Todo publicado.')).toBeVisible()
    await expect.poll(() => relay.find({ kinds: [KIND.profile], authors: [adminPubkey] }).length).toBe(1)

    await page.getByRole('link', { name: '💌 Mensajes' }).click()
    await page.getByRole('button', { name: '＋ Nuevo mensaje' }).click()
    await page.getByLabel('Título').fill('¡Hola mamá!')
    await page.getByLabel('Texto').fill('Mañana paso a las 5.')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText('Todo publicado.')).toBeVisible()

    await expect.poll(() => relay.find({ kinds: [KIND.message], authors: [adminPubkey] }).length).toBe(1)
    const [message] = relay.find({ kinds: [KIND.message], authors: [adminPubkey] })
    expect(message?.content).not.toContain('Hola')
    expect(relay.find({ kinds: [KIND.adminKey], authors: [adminPubkey] })).toHaveLength(1)

    // Un teléfono pide acceso: aparece en vivo con su código y se aprueba.
    const phoneSecret = generateSecretKey()
    const phone = getPublicKey(phoneSecret)
    await page.getByRole('link', { name: '📱 Vincular teléfono' }).click()
    relay.publish(finalizeEvent(pairingRequestTemplate(adminPubkey, Math.floor(Date.now() / 1000)), phoneSecret))
    await expect(page.getByText(`Teléfono · código ${pairingCode(phone)}`)).toBeVisible()
    await page.getByRole('button', { name: 'Aprobar' }).click()

    await expect(page.getByText('Habilitado')).toBeVisible()
    const keyEvent = relay.find({ kinds: [KIND.deviceKey], '#p': [phone] })[0]
    expect(keyEvent?.pubkey).toBe(adminPubkey)
    // Con su clave, el teléfono puede leer el mensaje.
    const contentKey = openDeviceKey(phoneSecret, keyEvent!)!
    expect(openItem(contentKey, message!.content)).toMatchObject({ item: { title: '¡Hola mamá!' } })
  })
})
