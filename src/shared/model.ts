// Modelo del contenido que carga el admin (data.enc) y su validación.
// Todo lo que llega descifrado se valida antes de usarse: nunca confiar en el archivo.

export const SCHEMA_VERSION = 1

export const MESSAGE_STYLES = ['normal', 'importante', 'buena-noticia', 'urgente'] as const
export const REPEATS = ['once', 'daily', 'weekly', 'monthly'] as const
export const TRASH_KINDS = ['message', 'reminder', 'giftCard'] as const

export type MessageStyle = (typeof MESSAGE_STYLES)[number]
export type Repeat = (typeof REPEATS)[number]
export type TrashKind = (typeof TRASH_KINDS)[number]

export interface Message {
  id: string
  title: string
  body: string
  style: MessageStyle
  emoji?: string
  imageId?: string
  createdAt: string
  archivedAt?: string
}

export interface Reminder {
  id: string
  title: string
  description: string
  icon: string
  startsAt: string
  repeat: Repeat
  pausedAt?: string
  createdAt: string
}

export interface BalanceRecord {
  amount: number
  at: string
}

export interface GiftCard {
  id: string
  providerId: string
  label: string
  redeemCode: string
  imageId?: string
  brands: string[]
  initialAmount: number
  currency: 'ARS'
  expiresOn: string
  adminBalances: BalanceRecord[]
  createdAt: string
}

export type TrashItem =
  | { kind: 'message'; item: Message; deletedAt: string }
  | { kind: 'reminder'; item: Reminder; deletedAt: string }
  | { kind: 'giftCard'; item: GiftCard; deletedAt: string }

export interface Content {
  schemaVersion: typeof SCHEMA_VERSION
  updatedAt: string
  userName: string
  adminName: string
  messages: Message[]
  reminders: Reminder[]
  giftCards: GiftCard[]
  trash: TrashItem[]
}

export class ContentError extends Error {
  constructor(path: string, problem: string) {
    super(`${path || 'contenido'}: ${problem}`)
    this.name = 'ContentError'
  }
}

export function emptyContent(userName: string, adminName: string): Content {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    userName,
    adminName,
    messages: [],
    reminders: [],
    giftCards: [],
    trash: [],
  }
}

// --- validadores mínimos ---

type Obj = Record<string, unknown>

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// Los ids de imagen se usan como nombre de archivo: solo caracteres seguros.
const IMAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContentError(path, 'tiene que ser un objeto')
  }
  return value as Obj
}

function str(o: Obj, key: string, path: string): string {
  const value = o[key]
  if (typeof value !== 'string') throw new ContentError(`${path}.${key}`, 'tiene que ser texto')
  return value
}

function optStr(o: Obj, key: string, path: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, path)
}

function optImageId(o: Obj, key: string, path: string): string | undefined {
  const value = optStr(o, key, path)
  if (value !== undefined && !IMAGE_ID.test(value)) throw new ContentError(`${path}.${key}`, 'id de imagen inválido')
  return value
}

function timestamp(o: Obj, key: string, path: string): string {
  const value = str(o, key, path)
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ContentError(`${path}.${key}`, 'fecha y hora inválida')
  }
  return value
}

function optTimestamp(o: Obj, key: string, path: string): string | undefined {
  return o[key] === undefined ? undefined : timestamp(o, key, path)
}

function amount(o: Obj, key: string, path: string): number {
  const value = o[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ContentError(`${path}.${key}`, 'tiene que ser un monto mayor o igual a cero')
  }
  return value
}

function oneOf<T extends string>(o: Obj, key: string, options: readonly T[], path: string): T {
  const value = str(o, key, path)
  if (!(options as readonly string[]).includes(value)) {
    throw new ContentError(`${path}.${key}`, `tiene que ser uno de: ${options.join(', ')}`)
  }
  return value as T
}

function list<T>(o: Obj, key: string, path: string, parse: (v: unknown, p: string) => T): T[] {
  const value = o[key]
  if (!Array.isArray(value)) throw new ContentError(`${path}.${key}`, 'tiene que ser una lista')
  return value.map((item, i) => parse(item, `${path}.${key}[${i}]`))
}

// Agrega la clave solo si tiene valor, así no aparecen `undefined` sueltos.
function withOptional<T extends object>(base: T, extras: Record<string, string | undefined>): T {
  const defined = Object.entries(extras).filter(([, v]) => v !== undefined)
  return { ...base, ...Object.fromEntries(defined) }
}

// --- entidades ---

export function parseMessage(value: unknown, path: string): Message {
  const o = obj(value, path)
  return withOptional(
    {
      id: str(o, 'id', path),
      title: str(o, 'title', path),
      body: str(o, 'body', path),
      style: oneOf(o, 'style', MESSAGE_STYLES, path),
      createdAt: timestamp(o, 'createdAt', path),
    },
    {
      emoji: optStr(o, 'emoji', path),
      imageId: optImageId(o, 'imageId', path),
      archivedAt: optTimestamp(o, 'archivedAt', path),
    },
  )
}

export function parseReminder(value: unknown, path: string): Reminder {
  const o = obj(value, path)
  return withOptional(
    {
      id: str(o, 'id', path),
      title: str(o, 'title', path),
      description: str(o, 'description', path),
      icon: str(o, 'icon', path),
      startsAt: timestamp(o, 'startsAt', path),
      repeat: oneOf(o, 'repeat', REPEATS, path),
      createdAt: timestamp(o, 'createdAt', path),
    },
    { pausedAt: optTimestamp(o, 'pausedAt', path) },
  )
}

function parseBalance(value: unknown, path: string): BalanceRecord {
  const o = obj(value, path)
  return { amount: amount(o, 'amount', path), at: timestamp(o, 'at', path) }
}

export function parseGiftCard(value: unknown, path: string): GiftCard {
  const o = obj(value, path)
  const expiresOn = str(o, 'expiresOn', path)
  if (!ISO_DATE.test(expiresOn)) throw new ContentError(`${path}.expiresOn`, 'fecha inválida (AAAA-MM-DD)')
  return withOptional(
    {
      id: str(o, 'id', path),
      providerId: str(o, 'providerId', path),
      label: str(o, 'label', path),
      redeemCode: str(o, 'redeemCode', path),
      brands: list(o, 'brands', path, (v, p) => {
        if (typeof v !== 'string') throw new ContentError(p, 'tiene que ser texto')
        return v
      }),
      initialAmount: amount(o, 'initialAmount', path),
      currency: oneOf(o, 'currency', ['ARS'] as const, path),
      expiresOn,
      adminBalances: list(o, 'adminBalances', path, parseBalance),
      createdAt: timestamp(o, 'createdAt', path),
    },
    { imageId: optImageId(o, 'imageId', path) },
  )
}

function parseTrashItem(value: unknown, path: string): TrashItem {
  const o = obj(value, path)
  const kind = oneOf(o, 'kind', TRASH_KINDS, path)
  const deletedAt = timestamp(o, 'deletedAt', path)
  const itemPath = `${path}.item`
  switch (kind) {
    case 'message':
      return { kind, item: parseMessage(o.item, itemPath), deletedAt }
    case 'reminder':
      return { kind, item: parseReminder(o.item, itemPath), deletedAt }
    case 'giftCard':
      return { kind, item: parseGiftCard(o.item, itemPath), deletedAt }
  }
}

export function parseContent(value: unknown): Content {
  const o = obj(value, '')
  if (o.schemaVersion !== SCHEMA_VERSION) {
    throw new ContentError('schemaVersion', `versión no soportada (se esperaba ${SCHEMA_VERSION})`)
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: timestamp(o, 'updatedAt', ''),
    userName: str(o, 'userName', ''),
    adminName: str(o, 'adminName', ''),
    messages: list(o, 'messages', '', parseMessage),
    reminders: list(o, 'reminders', '', parseReminder),
    giftCards: list(o, 'giftCards', '', parseGiftCard),
    trash: list(o, 'trash', '', parseTrashItem),
  }
}
