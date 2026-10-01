// Datos del panel sobre Nostr: cargar lo publicado, detectar qué ítems cambiaron,
// publicarlos (cifrados con la clave de contenido) y avisar si alguien publicó antes.
import type { Event } from 'nostr-tools'
import { encryptBytes, imageAad, type Bytes } from '../shared/crypto.ts'
import { emptyContent, type Content } from '../shared/model.ts'
import type { StoredBlob } from '../shared/nostr/blossom.ts'
import { ITEM_KINDS, KIND } from '../shared/nostr/constants.ts'
import { deriveImageKey, generateContentKey, openItem, sealItem } from '../shared/nostr/content-key.ts'
import {
  buildContent,
  dTag,
  envelopeFor,
  itemTemplate,
  latestByAddress,
  parseEnvelope,
  parseProfile,
  type ItemEnvelope,
  type Profile,
} from '../shared/nostr/events.ts'
import { adminKeyTemplate, openAdminKey } from '../shared/nostr/keys.ts'
import { publishedEnough, type Relays } from '../shared/nostr/relays.ts'
import type { Signer } from '../shared/nostr/signer.ts'

export type AdminRelays = Pick<Relays, 'query' | 'publish'>

export interface AdminState {
  content: Content
  // imageId → sha256 en Blossom.
  images: Map<string, string>
  // `${kind}:${d}` → created_at de la versión que se cargó o publicó.
  versions: Map<string, number>
  contentKey: Uint8Array
  // Todavía no hay nada publicado: la primera publicación guarda también la clave (36012).
  isNew: boolean
}

export interface Entry {
  kind: number
  d: string
  value: unknown
}

const PROFILE_D = 'perfil'
const ADMIN_KEY_D = 'admin'
const versionKey = (kind: number, d: string): string => `${kind}:${d}`

export class AdminKeyExistsError extends Error {
  constructor() {
    super('Ya hay contenido publicado con esta clave de admin. Recargá el panel para verlo.')
    this.name = 'AdminKeyExistsError'
  }
}

export async function loadAdmin(relays: AdminRelays, signer: Signer, names: Profile): Promise<AdminState> {
  const admin = await signer.getPublicKey()
  const [keyEvent] = latestByAddress(await relays.query({ kinds: [KIND.adminKey], authors: [admin], '#d': [ADMIN_KEY_D] }))
  if (!keyEvent) {
    const content = emptyContent(names.userName, names.adminName)
    return { content, images: new Map(), versions: new Map(), contentKey: generateContentKey(), isNew: true }
  }

  const contentKey = await openAdminKey(signer, keyEvent)
  const events = latestByAddress(await relays.query({ kinds: [...ITEM_KINDS], authors: [admin] }))
  const versions = new Map<string, number>([[versionKey(KIND.adminKey, ADMIN_KEY_D), keyEvent.created_at]])
  const envelopes: ItemEnvelope[] = []
  let profile = names
  let latest = 0
  for (const event of events) {
    try {
      const value = openItem(contentKey, event.content)
      if (event.kind === KIND.profile) profile = parseProfile(value)
      else envelopes.push(parseEnvelope(event.kind, value))
      versions.set(versionKey(event.kind, dTag(event)), event.created_at)
      latest = Math.max(latest, event.created_at)
    } catch {
      // Cifrado con una clave anterior o mal formado: se ignora.
    }
  }
  const { content, images } = buildContent(profile, envelopes, latest)
  return { content, images, versions, contentKey, isNew: false }
}

function envelopeEntry(entry: ItemEnvelope, images: Map<string, string>): Entry {
  const imageId = 'imageId' in entry.item ? entry.item.imageId : undefined
  const sha256 = imageId ? images.get(imageId) : undefined
  const withImage = sha256 ? { ...entry, image: { sha256 } } : entry
  return { kind: entry.kind, d: entry.item.id, value: envelopeFor(withImage) }
}

// Cada ítem del Content como el evento que le corresponde (incluida la papelera).
function entriesOf(content: Content, images: Map<string, string>): Map<string, Entry> {
  const entries: Entry[] = [
    { kind: KIND.profile, d: PROFILE_D, value: { userName: content.userName, adminName: content.adminName } },
    ...content.messages.map((item) => envelopeEntry({ kind: KIND.message, item }, images)),
    ...content.reminders.map((item) => envelopeEntry({ kind: KIND.reminder, item }, images)),
    ...content.giftCards.map((item) => envelopeEntry({ kind: KIND.giftCard, item }, images)),
    ...content.trash.map((t) => {
      const base = { deletedAt: t.deletedAt }
      if (t.kind === 'message') return envelopeEntry({ kind: KIND.message, item: t.item, ...base }, images)
      if (t.kind === 'reminder') return envelopeEntry({ kind: KIND.reminder, item: t.item, ...base }, images)
      return envelopeEntry({ kind: KIND.giftCard, item: t.item, ...base }, images)
    }),
  ]
  return new Map(entries.map((e) => [versionKey(e.kind, e.d), e]))
}

export function allEntries(content: Content, images: Map<string, string>): Entry[] {
  return [...entriesOf(content, images).values()]
}

// isNew: en la primera publicación van siempre los nombres, aunque no hayan cambiado,
// así el teléfono nunca queda sin saber cómo se llama cada uno.
export function changedEntries(
  before: Content,
  after: Content,
  images: Map<string, string>,
  { isNew = false }: { isNew?: boolean } = {},
): Entry[] {
  const previous = entriesOf(before, images)
  const profileKey = versionKey(KIND.profile, PROFILE_D)
  return [...entriesOf(after, images).entries()]
    .filter(([key, entry]) => (isNew && key === profileKey) || JSON.stringify(previous.get(key)?.value) !== JSON.stringify(entry.value))
    .map(([, entry]) => entry)
}

export interface PublishContext {
  relays: AdminRelays
  signer: Signer
  contentKey: Uint8Array
  isNew: boolean
  versions?: Map<string, number>
  now: () => number
  upload: (blobs: Bytes[]) => Promise<StoredBlob[]>
}

export interface PublishReport {
  versions: Map<string, number>
  images: Map<string, string>
  failed: { kind: number; d: string; reason: string }[]
}

async function uploadImages(entries: Entry[], pending: Map<string, Bytes>, ctx: PublishContext): Promise<Map<string, string>> {
  const ids = entries.flatMap((e) => {
    const imageId = (e.value as { item?: { imageId?: string } }).item?.imageId
    return imageId && pending.has(imageId) ? [imageId] : []
  })
  if (ids.length === 0) return new Map()
  const imageKey = await deriveImageKey(ctx.contentKey)
  const sealed = await Promise.all(ids.map((id) => encryptBytes(imageKey, pending.get(id) as Bytes, imageAad(id))))
  const stored = await ctx.upload(sealed)
  return new Map(ids.map((id, i) => [id, stored[i]?.sha256 as string]))
}

async function publishOne(event: Event, ctx: PublishContext): Promise<string | null> {
  const result = await ctx.relays.publish(event)
  return publishedEnough(result) ? null : result.failed.map((f) => `${f.relay}: ${f.reason}`).join('; ') || 'sin relays'
}

// Copia de la clave de contenido para el admin (36012). Antes de escribirla se vuelve a
// buscar: si ya existe (otro navegador, o un relay que no respondió al cargar), no se pisa.
async function publishAdminKey(ctx: PublishContext, report: PublishReport): Promise<string | null> {
  const admin = await ctx.signer.getPublicKey()
  const existing = await ctx.relays.query({ kinds: [KIND.adminKey], authors: [admin], '#d': [ADMIN_KEY_D] })
  const key = versionKey(KIND.adminKey, ADMIN_KEY_D)
  const known = ctx.versions?.get(key) ?? 0
  if (existing.some((e) => e.created_at > known)) throw new AdminKeyExistsError()
  const createdAt = Math.max(ctx.now(), known + 1)
  const reason = await publishOne(await ctx.signer.signEvent(await adminKeyTemplate(ctx.signer, ctx.contentKey, createdAt)), ctx)
  if (!reason) report.versions.set(key, createdAt)
  return reason
}

export async function publishEntries(entries: Entry[], pendingImages: Map<string, Bytes>, ctx: PublishContext): Promise<PublishReport> {
  const report: PublishReport = { versions: new Map(), images: new Map(), failed: [] }
  if (ctx.isNew) {
    const reason = await publishAdminKey(ctx, report)
    if (reason) {
      const failed = [{ kind: KIND.adminKey, d: ADMIN_KEY_D, reason }, ...entries.map((e) => ({ kind: e.kind, d: e.d, reason }))]
      return { ...report, failed }
    }
  }

  report.images = await uploadImages(entries, pendingImages, ctx)
  for (const entry of entries) {
    const value = entry.value as { item?: { imageId?: string } }
    const sha256 = value.item?.imageId ? report.images.get(value.item.imageId) : undefined
    const finalValue = sha256 ? { ...(entry.value as object), image: { sha256 } } : entry.value
    const key = versionKey(entry.kind, entry.d)
    // created_at siempre crece: dos ediciones en el mismo segundo no pueden empatar.
    const createdAt = Math.max(ctx.now(), (ctx.versions?.get(key) ?? 0) + 1)
    const event = await ctx.signer.signEvent(itemTemplate(entry.kind, entry.d, sealItem(ctx.contentKey, finalValue), createdAt))
    const reason = await publishOne(event, ctx)
    if (reason) report.failed.push({ kind: entry.kind, d: entry.d, reason })
    else report.versions.set(key, createdAt)
  }
  return report
}

// Ítems que en los relays tienen una versión más nueva que la que se estaba editando.
export async function findConflicts(
  relays: AdminRelays,
  admin: string,
  entries: Entry[],
  versions: Map<string, number>,
): Promise<Entry[]> {
  if (entries.length === 0) return []
  const kinds = [...new Set(entries.map((e) => e.kind))]
  const remote = latestByAddress(await relays.query({ kinds, authors: [admin], '#d': entries.map((e) => e.d) }))
  return entries.filter((entry) => {
    const event = remote.find((r) => r.kind === entry.kind && dTag(r) === entry.d)
    return event !== undefined && event.created_at > (versions.get(versionKey(entry.kind, entry.d)) ?? 0)
  })
}
