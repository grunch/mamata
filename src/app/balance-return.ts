// "Ver saldo": abre la página del comercio y, cuando el usuario vuelve a la app,
// avisa qué tarjeta estaba mirando para preguntarle cuánto le queda.
//
// Se abre con window.open: en la PWA instalada en Android, Chrome la muestra en una
// pestaña superpuesta con una X que vuelve a la app sin perder su estado. Sin instalar,
// abre una pestaña nueva y la app queda abierta en la original.

const PENDING_KEY = 'mamata:pendingBalanceCard'

type Opener = (url: string, target: string, features: string) => unknown

export function openBalancePage(
  url: string,
  cardId: string,
  storage: Storage = sessionStorage,
  open: Opener = (u, t, f) => window.open(u, t, f),
): void {
  storage.setItem(PENDING_KEY, cardId)
  open(url, '_blank', 'noopener')
}

// Devuelve la tarjeta pendiente una sola vez ("Ahora no" no vuelve a preguntar).
export function takePendingBalance(storage: Storage = sessionStorage): string | null {
  const cardId = storage.getItem(PENDING_KEY)
  if (cardId !== null) storage.removeItem(PENDING_KEY)
  return cardId
}
