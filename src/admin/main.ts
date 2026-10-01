import '../styles/app.css'
import '../styles/admin.css'
import { sniffImageType } from '../app/media.ts'
import { h } from '../app/ui.ts'
import { decryptBytes, imageAad, type Bytes } from '../shared/crypto.ts'
import { BlossomError, downloadBlob, uploadBlobs } from '../shared/nostr/blossom.ts'
import { BLOSSOM_SERVERS, KIND } from '../shared/nostr/constants.ts'
import { ItemCryptoError, deriveImageKey } from '../shared/nostr/content-key.ts'
import type { Profile } from '../shared/nostr/events.ts'
import { Relays, publishedEnough } from '../shared/nostr/relays.ts'
import { LocalSigner, Nip07Signer, SignerError, parseSecretKey, type Signer, type WindowNostr } from '../shared/nostr/signer.ts'
import { SECTIONS, type AdminContext, type AdminSession, type Section } from './context.ts'
import { approveDevice, loadDevices, revokeDevice, type Device } from './devices.ts'
import { newId } from './draft.ts'
import { allEntries, changedEntries, findConflicts, loadAdmin, publishEntries, type AdminState, type Entry } from './nostr-admin.ts'
import { cardsSection } from './screens/cards.ts'
import { linkSection } from './screens/link.ts'
import { messagesSection } from './screens/messages.ts'
import { remindersSection } from './screens/reminders.ts'
import { setupScreen } from './screens/setup.ts'
import { trashSection } from './screens/trash.ts'
import { clearSignerSetting, loadSignerSetting, saveSignerSetting, type SignerSetting } from './settings.ts'

const TOAST_MS = 5000
const DEFAULT_NAMES: Profile = { userName: 'Marta', adminName: 'tu familiar' }
const root = document.getElementById('admin')

function toast(message: string): void {
  const region = document.getElementById('aviso')
  if (!region) return
  region.textContent = message
  region.hidden = false
  setTimeout(() => {
    region.hidden = true
  }, TOAST_MS)
}

function explain(error: unknown): string {
  if (error instanceof SignerError || error instanceof BlossomError) return error.message
  if (error instanceof ItemCryptoError) return 'No pude abrir lo publicado con esta clave. ¿Es la misma nsec de siempre?'
  return 'No pude conectar con los relays. Revisá la conexión y probá de nuevo.'
}

function signerFor(setting: SignerSetting): Signer {
  if (setting.mode === 'nip07') return Nip07Signer.from((window as { nostr?: WindowNostr }).nostr)
  const secret = parseSecretKey(setting.nsec)
  if (!secret) throw new SignerError('La nsec guardada no es válida. Volvé a pegarla.')
  return new LocalSigner(secret)
}

interface Panel {
  signer: Signer
  relays: Relays
  admin: string
  state: AdminState
  devices: Device[]
  // Imágenes elegidas que todavía no se subieron (sin cifrar).
  pending: Map<string, Bytes>
  // Ítems cuyos cambios no llegaron a suficientes relays.
  unpublished: Pick<Entry, 'kind' | 'd'>[]
  publishing: boolean
}

async function openPanel(setting: SignerSetting, names: Profile): Promise<Panel> {
  const signer = signerFor(setting)
  const relays = new Relays()
  const admin = await signer.getPublicKey()
  const state = await loadAdmin(relays, signer, names)
  const devices = await loadDevices(relays, admin)
  return { signer, relays, admin, state, devices, pending: new Map(), unpublished: [], publishing: false }
}

function showSetup(initialError?: string): void {
  if (!root) return
  const screen = setupScreen(async ({ setting, names }) => {
    try {
      const panel = await openPanel(setting, names)
      saveSignerSetting(setting)
      startPanel(panel)
      return null
    } catch (error) {
      return explain(error)
    }
  }, initialError)
  root.replaceChildren(screen)
}

function sectionFromHash(): Section {
  const id = location.hash.replace(/^#\/?/, '')
  return SECTIONS.some((s) => s.id === id) ? (id as Section) : 'mensajes'
}

function renderSection(ctx: AdminContext): HTMLElement {
  switch (sectionFromHash()) {
    case 'mensajes':
      return messagesSection(ctx)
    case 'recordatorios':
      return remindersSection(ctx)
    case 'tarjetas':
      return cardsSection(ctx)
    case 'vincular':
      return linkSection(ctx)
    case 'papelera':
      return trashSection(ctx)
  }
}

function panelHeader(current: Section): HTMLElement {
  return h('header', { class: 'admin-header' }, [
    h('h1', { text: 'Panel de Mamata' }),
    h(
      'nav',
      { class: 'admin-nav', attrs: { 'aria-label': 'Secciones' } },
      SECTIONS.map((s) =>
        h('a', {
          class: s.id === current ? 'active' : '',
          text: `${s.icon} ${s.label}`,
          attrs: { href: `#/${s.id}`, ...(s.id === current ? { 'aria-current': 'page' } : {}) },
        }),
      ),
    ),
  ])
}

function statusBar(session: AdminSession, onRetry: () => void): HTMLElement {
  const text = session.publishing
    ? 'Publicando…'
    : session.unpublished > 0
      ? `Hay ${session.unpublished} cambio(s) sin publicar.`
      : 'Todo publicado.'
  return h('div', { class: `publish-bar${session.unpublished > 0 ? ' dirty' : ''}` }, [
    h('p', { text }),
    session.unpublished > 0 &&
      h('button', {
        class: 'small-button primary',
        text: 'Reintentar',
        attrs: { type: 'button', ...(session.publishing ? { disabled: '' } : {}) },
        on: { click: onRetry },
      }),
  ])
}

const sameEntry = (a: Pick<Entry, 'kind' | 'd'>, b: Pick<Entry, 'kind' | 'd'>) => a.kind === b.kind && a.d === b.d
const nowSeconds = () => Math.floor(Date.now() / 1000)

async function imagePreview(panel: Panel, id: string): Promise<string | null> {
  let plain = panel.pending.get(id) ?? null
  const sha256 = panel.state.images.get(id)
  if (!plain && sha256) {
    const key = await deriveImageKey(panel.state.contentKey)
    plain = await decryptBytes(key, await downloadBlob(sha256, BLOSSOM_SERVERS), imageAad(id))
  }
  return plain ? URL.createObjectURL(new Blob([plain], { type: sniffImageType(plain) })) : null
}

type EntryKey = Pick<Entry, 'kind' | 'd'>
const hasKey = (keys: EntryKey[], entry: EntryKey) => keys.some((k) => sameEntry(k, entry))

// Publica los ítems indicados con el valor que tienen *ahora* (no el de cuando se guardaron):
// así dos ediciones seguidas o un "Reintentar" nunca publican una versión vieja.
async function publishChanges(panel: Panel, keys: EntryKey[]): Promise<string> {
  const entries = allEntries(panel.state.content, panel.state.images).filter((e) => hasKey(keys, e))
  const conflicts = await findConflicts(panel.relays, panel.admin, entries, panel.state.versions)
  if (conflicts.length > 0 && !window.confirm(`${conflicts.length} cambio(s) ya los modificó alguien más (o vos en otro navegador). ¿Publicar tu versión encima?`)) {
    const { userName, adminName } = panel.state.content
    panel.state = await loadAdmin(panel.relays, panel.signer, { userName, adminName })
    panel.unpublished = panel.unpublished.filter((u) => !hasKey(keys, u))
    return 'Cargué la versión más nueva. Revisá y volvé a guardar.'
  }
  const report = await publishEntries(entries, panel.pending, {
    relays: panel.relays,
    signer: panel.signer,
    contentKey: panel.state.contentKey,
    isNew: panel.state.isNew,
    versions: panel.state.versions,
    now: nowSeconds,
    upload: (blobs) => uploadBlobs(blobs, panel.signer, BLOSSOM_SERVERS),
  })
  for (const id of report.images.keys()) panel.pending.delete(id)
  const failed = entries.filter((e) => report.failed.some((f) => sameEntry(f, e)))
  panel.state = {
    ...panel.state,
    images: new Map([...panel.state.images, ...report.images]),
    versions: new Map([...panel.state.versions, ...report.versions]),
    isNew: panel.state.isNew && !report.versions.has(`${KIND.adminKey}:admin`),
  }
  panel.unpublished = [...panel.unpublished.filter((u) => !hasKey(keys, u)), ...failed]
  return failed.length > 0
    ? 'Algunos cambios no llegaron a suficientes relays. Tocá "Reintentar".'
    : 'Publicado. El teléfono lo ve en segundos.'
}

// Quitar acceso: el resultado se aplica sobre el estado actual, sin pisar lo editado.
async function revokeAccess(panel: Panel, devicePubkey: string): Promise<string> {
  const holders = panel.devices.filter((d) => d.status === 'approved').map((d) => ({ pubkey: d.pubkey, keyAt: d.keyAt }))
  const next = await revokeDevice(
    {
      relays: panel.relays,
      signer: panel.signer,
      state: panel.state,
      now: nowSeconds,
      upload: (blobs) => uploadBlobs(blobs, panel.signer, BLOSSOM_SERVERS),
      download: (sha256) => downloadBlob(sha256, BLOSSOM_SERVERS),
    },
    devicePubkey,
    holders,
  )
  panel.state = { ...panel.state, contentKey: next.contentKey, images: next.images, versions: next.versions, isNew: false }
  if (next.keyFailures.length > 0) return 'Se quitó el acceso, pero a algún teléfono no le llegó la clave nueva. Aprobalo de nuevo.'
  if (next.lostImages.length > 0) return `Se quitó el acceso. ${next.lostImages.length} foto(s) ya no estaban y hay que volver a subirlas.`
  return 'Listo: ese teléfono ya no ve el contenido.'
}

function startPanel(panel: Panel): void {
  if (!root) return
  const imageUrls = new Map<string, Promise<string | null>>()
  let queue = Promise.resolve()

  const session = (): AdminSession => ({
    adminPubkey: panel.admin,
    content: panel.state.content,
    devices: panel.devices,
    publishing: panel.publishing,
    unpublished: panel.unpublished.length,
  })

  // Publicaciones y "quitar acceso" van de a uno, en el orden en que se pidieron.
  const enqueue = (job: () => Promise<string>, onError?: () => void) => {
    queue = queue.then(async () => {
      panel.publishing = true
      render()
      try {
        toast(await job())
      } catch (error) {
        onError?.()
        toast(explain(error))
      } finally {
        panel.publishing = false
        render()
      }
    })
  }
  const enqueuePublish = (keys: EntryKey[]) =>
    enqueue(
      () => publishChanges(panel, keys),
      () => {
        panel.unpublished = [...panel.unpublished.filter((u) => !hasKey(keys, u)), ...keys]
      },
    )

  const ctx: AdminContext = {
    get session() {
      return session()
    },
    now: () => new Date().toISOString(),
    edit(next) {
      const entries = changedEntries(panel.state.content, next, panel.state.images)
      panel.state = { ...panel.state, content: next }
      render()
      if (entries.length > 0) enqueuePublish(entries)
    },
    addImage(bytes) {
      const id = newId()
      panel.pending.set(id, bytes)
      return id
    },
    imageUrl(id) {
      const cached = imageUrls.get(id)
      if (cached) return cached
      const pending = imagePreview(panel, id).catch(() => null)
      imageUrls.set(id, pending)
      return pending
    },
    toast,
    rerender: () => render(),
    async approve(devicePubkey) {
      const previous = panel.devices.find((d) => d.pubkey === devicePubkey)?.keyAt ?? 0
      const createdAt = Math.max(nowSeconds(), previous + 1)
      const result = await approveDevice(panel.relays, panel.signer, panel.state.contentKey, devicePubkey, createdAt)
      toast(publishedEnough(result) ? 'Listo: el teléfono ya puede ver todo.' : 'No llegó a suficientes relays. Probá de nuevo.')
      await ctx.refreshDevices()
    },
    async revoke(devicePubkey) {
      enqueue(async () => {
        const message = await revokeAccess(panel, devicePubkey)
        imageUrls.clear()
        panel.devices = await loadDevices(panel.relays, panel.admin).catch(() => panel.devices)
        return message
      })
    },
    async refreshDevices() {
      panel.devices = await loadDevices(panel.relays, panel.admin).catch(() => panel.devices)
      render()
    },
    async retry() {
      if (panel.unpublished.length > 0) enqueuePublish(panel.unpublished)
    },
    logout() {
      if (panel.unpublished.length > 0 && !window.confirm('Hay cambios sin publicar que se van a perder. ¿Salir igual?')) return
      clearSignerSetting()
      panel.relays.close()
      location.hash = ''
      showSetup()
    },
  }

  function render(): void {
    if (!root) return
    root.replaceChildren(
      panelHeader(sectionFromHash()),
      h('main', { class: 'admin-screen' }, [renderSection(ctx)]),
      statusBar(session(), () => void ctx.retry()),
    )
  }

  // Pedidos de vinculación en vivo: aparecen sin tener que recargar.
  panel.relays.subscribe({ kinds: [KIND.pairingRequest], '#p': [panel.admin] }, () => void ctx.refreshDevices())
  window.addEventListener('hashchange', render)
  window.addEventListener('beforeunload', (event) => {
    if (panel.unpublished.length > 0 || panel.publishing) event.preventDefault()
  })
  render()
}

async function boot(): Promise<void> {
  const setting = loadSignerSetting()
  if (!setting) return showSetup()
  try {
    startPanel(await openPanel(setting, DEFAULT_NAMES))
  } catch (error) {
    showSetup(explain(error))
  }
}

void boot()
