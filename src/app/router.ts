// Rutas con hash: el sitio es estático y GitHub Pages no reescribe URLs.
export type Route =
  | { name: 'home' }
  | { name: 'messages' }
  | { name: 'message'; id: string }
  | { name: 'reminders' }
  | { name: 'cards' }
  | { name: 'card'; id: string }
  | { name: 'card-explainer'; id: string }
  | { name: 'card-note'; id: string }
  | { name: 'card-history'; id: string }

const CARD_SUBPAGES = {
  'ver-saldo': 'card-explainer',
  anotar: 'card-note',
  historial: 'card-history',
} as const

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [section, id, sub] = parts

  if (section === 'mensajes' && parts.length === 1) return { name: 'messages' }
  if (section === 'mensajes' && id && parts.length === 2) return { name: 'message', id }
  if (section === 'recordatorios' && parts.length === 1) return { name: 'reminders' }
  if (section === 'tarjetas' && parts.length === 1) return { name: 'cards' }
  if (section === 'tarjetas' && id && parts.length === 2) return { name: 'card', id }
  if (section === 'tarjetas' && id && sub && sub in CARD_SUBPAGES && parts.length === 3) {
    return { name: CARD_SUBPAGES[sub as keyof typeof CARD_SUBPAGES], id }
  }
  return { name: 'home' }
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'messages':
      return '#/mensajes'
    case 'message':
      return `#/mensajes/${encodeURIComponent(route.id)}`
    case 'reminders':
      return '#/recordatorios'
    case 'cards':
      return '#/tarjetas'
    case 'card':
      return `#/tarjetas/${encodeURIComponent(route.id)}`
    case 'card-explainer':
      return `#/tarjetas/${encodeURIComponent(route.id)}/ver-saldo`
    case 'card-note':
      return `#/tarjetas/${encodeURIComponent(route.id)}/anotar`
    case 'card-history':
      return `#/tarjetas/${encodeURIComponent(route.id)}/historial`
  }
}
