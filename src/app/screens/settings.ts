// ⚙️ Ajustes: la identidad Nostr del teléfono. La clave privada solo se muestra
// después de un aviso, porque quien la tenga puede hacerse pasar por este teléfono.
import { npubEncode, nsecEncode } from 'nostr-tools/nip19'
import { getPublicKey } from 'nostr-tools/pure'
import { pairingCode } from '../../shared/nostr/pairing.ts'
import { bigButton, h, screen } from '../ui.ts'

const REVEAL_WARNING =
  'La clave privada es como la llave de este teléfono. No se la mandes a nadie. ¿Mostrarla igual?'

export function settingsScreen(phoneSecret: Uint8Array): HTMLElement {
  const pubkey = getPublicKey(phoneSecret)
  const secretBox = h('div', { class: 'secret' })

  const reveal = () => {
    if (!window.confirm(REVEAL_WARNING)) return
    secretBox.replaceChildren(
      h('p', { class: 'caption', text: 'Clave privada de este teléfono:' }),
      h('p', { class: 'key-text', text: nsecEncode(phoneSecret) }),
    )
  }

  return screen('Ajustes', [
    h('section', { class: 'balance-box', attrs: { 'aria-labelledby': 'identidad' } }, [
      h('h2', { text: 'Este teléfono', attrs: { id: 'identidad' } }),
      h('p', { class: 'caption', text: 'Código para habilitarlo:' }),
      h('p', { class: 'pairing-code', text: pairingCode(pubkey) }),
      h('p', { class: 'caption', text: 'Identificación pública (npub):' }),
      h('p', { class: 'key-text', text: npubEncode(pubkey) }),
    ]),
    secretBox,
    bigButton('🔑', 'Mostrar clave privada', reveal, 'quiet'),
  ])
}
