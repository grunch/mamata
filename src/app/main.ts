import '../styles/app.css'
import { InvalidKeyError, importKey } from '../shared/crypto.ts'
import type { Content } from '../shared/model.ts'
import { takePendingBalance } from './balance-return.ts'
import { ContentLoadError, decryptContent, keyFromHash, loadContent, loadImageBytes, type LoadFailure } from './content.ts'
import type { AppContext, AppState } from './context.ts'
import { LocalStore } from './local-store.ts'
import { sniffImageType } from './media.ts'
import { parseRoute, routeHref, type Route } from './router.ts'
import { explainerScreen, noteScreen } from './screens/balance-flow.ts'
import { cardScreen, cardsScreen, historyScreen } from './screens/giftcards.ts'
import { homeScreen } from './screens/home.ts'
import { messageScreen, messagesScreen } from './screens/messages.ts'
import { remindersScreen } from './screens/reminders.ts'
import {
  banners,
  emptyScreen,
  noLinkScreen,
  offlineFirstScreen,
  welcomeScreen,
  type InstallPrompt,
} from './screens/status.ts'
import { announce, replaceScreen } from './ui.ts'

const REFRESH_MS = 5 * 60 * 1000

type Loaded = { content: Content; outdatedKey: boolean } | { failure: LoadFailure }

// Trae lo publicado; si no se puede, usa la última versión buena guardada en el teléfono.
async function loadWithFallback(key: CryptoKey, store: LocalStore): Promise<Loaded> {
  try {
    const { content, sealed } = await loadContent(key)
    // Guardar la copia es una red de seguridad: si falla (por ejemplo, sin espacio),
    // igual se muestra lo que se acaba de descargar.
    await store.setLastGoodContent(sealed).catch(() => undefined)
    return { content, outdatedKey: false }
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error
    const lastGood = await store.getLastGoodContent()
    if (lastGood) {
      try {
        return { content: await decryptContent(key, lastGood), outdatedKey: error.reason === 'wrong-key' }
      } catch {
        // La copia guardada tampoco sirve: se informa el problema original.
      }
    }
    return { failure: error.reason }
  }
}

function screenFor(route: Route, ctx: AppContext): HTMLElement {
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
  }
}


// Guarda la clave que viene en el link y la saca de la barra de direcciones.
async function adoptKeyFromLink(store: LocalStore): Promise<void> {
  const fromLink = keyFromHash(location.hash)
  if (!fromLink) return
  // Primero sacarla de la barra de direcciones, pase lo que pase después.
  history.replaceState(null, '', `${location.pathname}#/`)
  try {
    await importKey(fromLink)
    await store.setKey(fromLink)
  } catch (error) {
    if (!(error instanceof InvalidKeyError)) throw error
  }
}

async function readKey(store: LocalStore): Promise<CryptoKey | null> {
  const encoded = await store.getKey()
  if (!encoded) return null
  try {
    return await importKey(encoded)
  } catch {
    return null
  }
}

let installPrompt: InstallPrompt | null = null
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  installPrompt = event as unknown as InstallPrompt
})

// Imágenes descifradas como blob: URL, una sola vez por id.
function imageLoader(key: CryptoKey) {
  const cache = new Map<string, Promise<string | null>>()
  return {
    get(id: string): Promise<string | null> {
      const cached = cache.get(id)
      if (cached) return cached
      const pending = loadImageBytes(key, id)
        .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: sniffImageType(bytes) })))
        .catch(() => null)
      cache.set(id, pending)
      return pending
    },
    clear: () => cache.clear(),
  }
}

function createContext(root: HTMLElement, store: LocalStore, initial: AppState, imageUrl: (id: string) => Promise<string | null>) {
  let state = initial
  const render = (moveFocus: boolean) => {
    replaceScreen(root, [...banners(state), screenFor(parseRoute(location.hash), ctx)], moveFocus)
  }
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

// Navegación, conexión, vuelta desde "Ver saldo" y refresco periódico del contenido.
function listenForChanges(ctx: AppContext, render: (moveFocus: boolean) => void, refresh: () => Promise<void>): void {
  window.addEventListener('hashchange', () => render(true))
  window.addEventListener('online', () => ctx.update({ offline: false }))
  window.addEventListener('offline', () => ctx.update({ offline: true }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    const pendingCard = takePendingBalance()
    if (pendingCard) ctx.go({ name: 'card-note', id: pendingCard })
    void refresh()
  })
  setInterval(() => void refresh(), REFRESH_MS)
}

async function boot(root: HTMLElement): Promise<void> {
  const store = await LocalStore.open()
  await adoptKeyFromLink(store)
  const key = await readKey(store)
  if (!key) return replaceScreen(root, [noLinkScreen()], true)

  const loaded = await loadWithFallback(key, store)
  if ('failure' in loaded) {
    if (loaded.failure === 'offline') return replaceScreen(root, [offlineFirstScreen(() => location.reload())], true)
    return replaceScreen(root, [loaded.failure === 'empty' ? emptyScreen() : noLinkScreen()], true)
  }

  const [reads, done, notes] = await Promise.all([store.readMessageIds(), store.doneOccurrences(), store.balanceNotes()])
  const images = imageLoader(key)
  const initial: AppState = { ...loaded, reads, done, notes, offline: !navigator.onLine }
  const { ctx, render } = createContext(root, store, initial, images.get)

  const refresh = async () => {
    const next = await loadWithFallback(key, store).catch(() => null)
    if (!next || 'failure' in next) return
    if (next.content.updatedAt === ctx.state.content.updatedAt && next.outdatedKey === ctx.state.outdatedKey) return
    images.clear()
    ctx.update(next)
  }
  listenForChanges(ctx, render, refresh)

  if (await store.getPref('onboarded')) return render(true)
  // Si no se pudo guardar, se vuelve a mostrar la bienvenida la próxima vez; no traba.
  const start = () => void store.setPref('onboarded', true).catch(() => undefined).then(() => render(true))
  replaceScreen(root, [welcomeScreen(ctx.state, installPrompt, start)], true)
}

const root = document.getElementById('app')
if (root) {
  boot(root).catch(() => {
    root.replaceChildren(offlineFirstScreen(() => location.reload()))
  })
}
