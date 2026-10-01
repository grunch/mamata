// Kinds, relays y servidores Blossom de Mamata. Los kinds 36000–36012 no figuran
// asignados en el registro de NIPs (revisado el 2026-10-01).

export const SITE_URL = 'https://mamata.live/'

export const KIND = {
  message: 36000,
  reminder: 36001,
  giftCard: 36002,
  profile: 36003,
  pairingRequest: 36010,
  deviceKey: 36011,
  adminKey: 36012,
} as const

// Lo que ve el teléfono (además de su propia clave de contenido, kind 36011).
export const ITEM_KINDS = [KIND.message, KIND.reminder, KIND.giftCard, KIND.profile] as const

// Probados el 2026-10-01: aceptan los kinds 36000–36012 y reemplazan bien los eventos.
// (mostro-p2p.tech se descartó: rechaza estos kinds.)
export const RELAYS = ['wss://relay.mostro.network', 'wss://relay.shadowbip.com', 'wss://nos.lol']

// Probados el 2026-10-01: aceptan archivos cifrados (octet-stream) y responden con CORS.
// blossom.primal.net y blossom.band se descartaron: solo aceptan imágenes reconocibles.
export const BLOSSOM_SERVERS = ['https://nostr.download', 'https://blossom.yakihonne.com']

// Con menos relays que esto, una publicación se considera fallida.
export const MIN_RELAYS_OK = 2
