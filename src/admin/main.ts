import '../styles/app.css'
import '../styles/admin.css'
import { sniffImageType } from '../app/media.ts'
import { h } from '../app/ui.ts'
import { DecryptError, decryptBytes, imageAad, importKey } from '../shared/crypto.ts'
import { ContentError } from '../shared/model.ts'
import { SECTIONS, isDirty, type AdminContext, type AdminSession, type Section } from './context.ts'
import { newId } from './draft.ts'
import { AuthError, ConflictError, GitHubError, GitHubRepo } from './github.ts'
import { imageFile, openContent, publish, rotateKey, type Published } from './publisher.ts'
import { cardsSection } from './screens/cards.ts'
import { linkSection } from './screens/link.ts'
import { messagesSection } from './screens/messages.ts'
import { remindersSection } from './screens/reminders.ts'
import { setupScreen } from './screens/setup.ts'
import { trashSection } from './screens/trash.ts'
import { REPO, clearSettings, loadSettings, saveSettings, type AdminSettings } from './settings.ts'

const TOAST_MS = 5000
const DEFAULT_NAMES = { userName: 'Marta', adminName: 'tu familiar' }
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

// Si el commit quedó pero GitHub no arrancó el despliegue, decir cómo arrancarlo a mano.
function deployMessage(result: Published, ok: string): string {
  return result.deployRequested
    ? ok
    : 'Se guardó, pero GitHub no arrancó la publicación. En el repo: Actions → "Publicar en GitHub Pages" → Run workflow.'
}

function explain(error: unknown): string {
  if (error instanceof AuthError && error.status === 401) {
    return `GitHub dice que el token no es válido (${error.detail}). Revisá que se haya copiado completo: empieza con github_pat_.`
  }
  if (error instanceof AuthError) {
    return `El token funciona pero no tiene permiso sobre grunch/mamata (${error.detail}). Revisá "Repository access" y "Contents: Read and write".`
  }
  if (error instanceof DecryptError) return 'La clave no corresponde al contenido publicado.'
  if (error instanceof ContentError) return `El contenido publicado tiene un problema: ${error.message}`
  if (error instanceof ConflictError) return error.message
  if (error instanceof GitHubError && error.status === 422) return error.message
  return 'No se pudo conectar con GitHub. Revisá la conexión y probá de nuevo.'
}

async function openSession(settings: AdminSettings, names = DEFAULT_NAMES): Promise<AdminSession> {
  const repo = new GitHubRepo({ ...REPO, token: settings.token })
  const key = await importKey(settings.key)
  const opened = await openContent(repo, key, names)
  return {
    repo,
    key,
    encodedKey: settings.key,
    baseCommit: opened.baseCommit,
    content: opened.content,
    // Si es nuevo, todavía no hay nada publicado: queda "con cambios" para publicarlo.
    publishedJson: opened.isNew ? '' : JSON.stringify(opened.content),
    newImages: new Map(),
  }
}

function showSetup(initialError?: string): void {
  if (!root) return
  const screen = setupScreen(async (result) => {
    try {
      const session = await openSession(result, result)
      saveSettings({ token: result.token, key: result.key })
      startPanel(session)
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

// Imagen para la vista previa: la recién subida (sin publicar) o la publicada, descifrada.
async function loadImageUrl(session: AdminSession, id: string): Promise<string | null> {
  let plain = session.newImages.get(id) ?? null
  if (!plain) {
    const sealed = session.baseCommit ? await session.repo.readFile(imageFile(id), session.baseCommit) : null
    plain = sealed ? await decryptBytes(session.key, sealed, imageAad(id)) : null
  }
  return plain ? URL.createObjectURL(new Blob([plain], { type: sniffImageType(plain) })) : null
}

// Genera una clave nueva, vuelve a cifrar y publica una foto del contenido actual.
async function rotateSession(session: AdminSession, now: string): Promise<{ patch: Partial<AdminSession>; rotation: Published }> {
  const snapshot = session.content
  const base = await session.repo.headCommit()
  const rotated = await rotateKey(session.repo, session.key, base, snapshot, session.newImages, now)
  const settings = loadSettings()
  if (settings) saveSettings({ ...settings, key: rotated.encodedKey })
  const patch = {
    key: await importKey(rotated.encodedKey),
    encodedKey: rotated.encodedKey,
    baseCommit: rotated.commit,
    publishedJson: JSON.stringify(snapshot),
    newImages: new Map(),
  }
  return { patch, rotation: rotated }
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

function publishBar(dirty: boolean, busy: boolean, onPublish: () => void): HTMLElement {
  return h('div', { class: `publish-bar${dirty ? ' dirty' : ''}` }, [
    h('p', { text: busy ? 'Publicando…' : dirty ? 'Hay cambios sin publicar.' : 'Todo publicado.' }),
    h('button', {
      class: 'small-button primary',
      text: 'Publicar cambios',
      attrs: { type: 'button', ...(dirty && !busy ? {} : { disabled: '' }) },
      on: { click: onPublish },
    }),
  ])
}

function startPanel(initial: AdminSession): void {
  if (!root) return
  let session = initial
  let busy = false
  const imageUrls = new Map<string, Promise<string | null>>()

  // Publica una foto del contenido: lo que se edite mientras sube queda "sin publicar".
  const doPublish = async (): Promise<void> => {
    if (busy) return
    busy = true
    render()
    const snapshot = session.content
    const images = session.newImages
    const send = (base: string | null) => publish(session.repo, session.key, base, snapshot, images, ctx.now())
    try {
      let result: Published
      try {
        result = await send(session.baseCommit)
      } catch (error) {
        const overwrite = error instanceof ConflictError && window.confirm(`${explain(error)}. ¿Publicar igual tu versión encima?`)
        if (!overwrite) throw error
        result = await send(await session.repo.headCommit())
      }
      const pending = new Map([...session.newImages].filter(([id]) => !images.has(id)))
      session = { ...session, baseCommit: result.commit, publishedJson: JSON.stringify(snapshot), newImages: pending }
      toast(deployMessage(result, 'Publicado. El teléfono lo va a ver en unos minutos.'))
    } catch (error) {
      toast(explain(error))
    } finally {
      busy = false
      render()
    }
  }

  const ctx: AdminContext = {
    get session() {
      return session
    },
    now: () => new Date().toISOString(),
    edit(next) {
      session = { ...session, content: next }
      render()
    },
    addImage(bytes) {
      const id = newId()
      session = { ...session, newImages: new Map(session.newImages).set(id, bytes) }
      return id
    },
    imageUrl(id) {
      const cached = imageUrls.get(id)
      if (cached) return cached
      const pending = loadImageUrl(session, id).catch(() => null)
      imageUrls.set(id, pending)
      return pending
    },
    toast,
    rerender: () => render(),
    async rotate() {
      if (busy) return
      busy = true
      render()
      try {
        // Se aplica sobre la sesión actual: lo editado mientras tanto no se pierde.
        const { patch, rotation } = await rotateSession(session, ctx.now())
        session = { ...session, ...patch }
        imageUrls.clear()
        toast(deployMessage(rotation, 'Clave cambiada. Mandá el link nuevo al teléfono.'))
      } catch (error) {
        toast(explain(error))
      } finally {
        busy = false
        render()
      }
    },
    logout() {
      if (isDirty(session) && !window.confirm('Hay cambios sin publicar que se van a perder. ¿Salir igual?')) return
      clearSettings()
      location.hash = ''
      showSetup()
    },
  }

  function render(): void {
    if (!root) return
    const dirty = isDirty(session)
    root.replaceChildren(
      panelHeader(sectionFromHash()),
      h('main', { class: 'admin-screen' }, [renderSection(ctx)]),
      publishBar(dirty, busy, () => void doPublish()),
    )
  }

  window.addEventListener('hashchange', render)
  window.addEventListener('beforeunload', (event) => {
    if (isDirty(session)) event.preventDefault()
  })
  render()
}

async function boot(): Promise<void> {
  const settings = loadSettings()
  if (!settings) return showSetup()
  try {
    startPanel(await openSession(settings))
  } catch (error) {
    showSetup(explain(error))
  }
}

void boot()
