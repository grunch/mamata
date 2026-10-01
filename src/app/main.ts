import '../styles/app.css'
import { decryptBytes, imageAad } from '../shared/crypto.ts'
import { emptyContent } from '../shared/model.ts'
import { downloadBlob } from '../shared/nostr/blossom.ts'
import { BLOSSOM_SERVERS } from '../shared/nostr/constants.ts'
import { deriveImageKey } from '../shared/nostr/content-key.ts'
import { adminFromHash } from '../shared/nostr/pairing.ts'
import { Relays } from '../shared/nostr/relays.ts'
import { takePendingBalance } from './balance-return.ts'
import { ContentSync, type SyncState } from './content-sync.ts'
import type { AppContext, AppState } from './context.ts'
import { LocalStore } from './local-store.ts'
import { sniffImageType } from './media.ts'
import { parseRoute, routeHref, type Route } from './router.ts'
import { explainerScreen, noteScreen } from './screens/balance-flow.ts'
import { cardScreen, cardsScreen, historyScreen } from './screens/giftcards.ts'
import { homeScreen } from './screens/home.ts'
import { messageScreen, messagesScreen } from './screens/messages.ts'
import { remindersScreen } from './screens/reminders.ts'
import { settingsScreen } from './screens/settings.ts'
import {
  banners,
  noLinkScreen,
  offlineFirstScreen,
  waitingScreen,
  welcomeScreen,
  type InstallPrompt,
} from './screens/status.ts'
import { announce, replaceScreen } from './ui.ts'

function screenFor(route: Route, ctx: AppContext, phoneSecret: Uint8Array): HTMLElement {
  switch (route.name) {
    case 'home':
      return homeScreen(ctx)
    case 'messages':
      return messagesScreen(ctx)
    case 'message':
      return messageScreen(ctx, route.id)
    case 'reminders':
      return remindersScreen(ctx)
    case 'cards':
      return cardsScreen(ctx)
    case 'card':
      return cardScreen(ctx, route.id)
    case 'card-explainer':
      return explainerScreen(ctx, route.id)
    case 'card-note':
      return noteScreen(ctx, route.id)
    case 'card-history':
      return historyScreen(ctx, route.id)
    case 'settings':
      return settingsScreen(phoneSecret)
  }
}

// Guarda de quién aceptar contenido (la npub del link) y la saca de la barra de direcciones.
// Un teléfono ya vinculado ignora links de otro admin: si no, cualquiera podría mandarle
// un link y pasar a publicarle mensajes. Para cambiar de admin hay que borrar los datos de la app.
async function adoptAdminFromLink(store: LocalStore): Promise<void> {
  const linked = adminFromHash(location.hash)
  if (!linked) return
  history.replaceState(null, '', `${location.pathname}#/`)
  const current = await store.getAdminPubkey()
  if (current && current !== linked) return
  await store.setAdminPubkey(linked)
}

// Imágenes: se bajan de Blossom por hash, se descifran y se muestran como blob: URL.
function imageLoader() {
  const cache = new Map<string, Promise<string | null>>()
  let images = new Map<string, string>()
  let imageKey: Promise<CryptoKey> | null = null
  let currentKey: Uint8Array | null = null
  return {
    update(nextImages: Map<string, string>, contentKey: Uint8Array) {
      images = nextImages
      if (currentKey && currentKey.every((b, i) => b === contentKey[i])) return
      currentKey = contentKey
      imageKey = deriveImageKey(contentKey)
      cache.clear()
    },
    get(id: string): Promise<string | null> {
      const sha256 = images.get(id)
      if (!sha256 || !imageKey) return Promise.resolve(null)
      const cached = cache.get(sha256)
      if (cached) return cached
      const key = imageKey
      const pending = downloadBlob(sha256, BLOSSOM_SERVERS)
        .then(async (sealed) => decryptBytes(await key, sealed, imageAad(id)))
        .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: sniffImageType(bytes) })))
        .catch(() => null)
      cache.set(sha256, pending)
      return pending
    },
  }
}

function createContext(
  root: HTMLElement,
  store: LocalStore,
  initial: AppState,
  imageUrl: (id: string) => Promise<string | null>,
  view: (ctx: AppContext) => HTMLElement[],
) {
  let state = initial
  const render = (moveFocus: boolean) => replaceScreen(root, view(ctx), moveFocus)
  const ctx: AppContext = {
    get state() {
      return state
    },
    store,
    now: () => new Date(),
    update(patch) {
      state = { ...state, ...patch }
      render(false)
    },
    go(route) {
      const href = routeHref(route)
      if (location.hash === href) render(true)
      else location.hash = href
    },
    imageUrl,
    announce,
  }
  return { ctx, render }
}

let installPrompt: InstallPrompt | null = null
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  installPrompt = event as unknown as InstallPrompt
})

type Phase = { kind: 'loading' } | { kind: 'waiting'; code: string } | { kind: 'ready' }

async function boot(root: HTMLElement): Promise<void> {
  const store = await LocalStore.open()
  await adoptAdminFromLink(store)
  const admin = await store.getAdminPubkey()
  if (!admin) return replaceScreen(root, [noLinkScreen()], true)

  const phoneSecret = await store.phoneSecret()
  const [reads, done, notes] = await Promise.all([store.readMessageIds(), store.doneOccurrences(), store.balanceNotes()])
  let onboarded = await store.getPref('onboarded')
  let phase: Phase = { kind: 'loading' }
  const images = imageLoader()

  // Si no se pudo guardar, la bienvenida vuelve a aparecer la próxima vez; no traba.
  const start = () => {
    onboarded = true
    void store.setPref('onboarded', true).catch(() => undefined)
    render(true)
  }
  const view = (ctx: AppContext): HTMLElement[] => {
    if (phase.kind === 'waiting') return [waitingScreen(phase.code)]
    if (!onboarded) return [welcomeScreen(ctx.state, installPrompt, start)]
    return [...banners(ctx.state), screenFor(parseRoute(location.hash), ctx, phoneSecret)]
  }
  const initial: AppState = { content: emptyContent('', 'tu familiar'), reads, done, notes, offline: !navigator.onLine }
  const { ctx, render } = createContext(root, store, initial, images.get, view)

  const onChange = (next: SyncState) => {
    const wasReady = phase.kind === 'ready'
    if (next.status === 'waiting') {
      // El foco se mueve solo al entrar a la espera, no con cada evento que llega.
      const alreadyWaiting = phase.kind === 'waiting' && phase.code === next.code
      phase = { kind: 'waiting', code: next.code }
      return render(!alreadyWaiting)
    }
    images.update(next.images, next.contentKey)
    phase = { kind: 'ready' }
    ctx.update({ content: next.content })
    if (!wasReady) render(true)
  }
  const sync = new ContentSync({ relays: new Relays(), cache: store, admin, phoneSecret, onChange })

  window.addEventListener('hashchange', () => render(true))
  window.addEventListener('online', () => ctx.update({ offline: false }))
  window.addEventListener('offline', () => ctx.update({ offline: true }))
  // En segundo plano se cierra la suscripción (batería); al volver se reabre y se pone al día.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return sync.stop()
    const pendingCard = takePendingBalance()
    if (pendingCard) ctx.go({ name: 'card-note', id: pendingCard })
    void sync.start()
  })
  await sync.start()
}

const root = document.getElementById('app')
if (root) {
  boot(root).catch(() => {
    root.replaceChildren(offlineFirstScreen(() => location.reload()))
  })
}
