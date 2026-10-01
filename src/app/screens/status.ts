// Pantallas y avisos de estado: sin link, sin contenido, sin internet, bienvenida.
// Lenguaje simple: nunca "error", "caché", "sincronizar" ni "clave".
import type { AppState } from '../context.ts'
import { bigButton, greeting, h, screen } from '../ui.ts'

export function noLinkScreen(): HTMLElement {
  return screen('¡Hola!', [h('p', { class: 'body', text: 'Para ver tus cosas, pedile el link a tu familiar.' })], { showHome: false })
}

export function offlineFirstScreen(onRetry: () => void): HTMLElement {
  return screen(
    'Sin internet',
    [
      h('p', { class: 'body', text: 'No pude traer tu información. Revisá que el teléfono tenga internet.' }),
      bigButton('🔄', 'Probar de nuevo', onRetry),
    ],
    { showHome: false },
  )
}

export function notFoundScreen(message: string): HTMLElement {
  return screen('No lo encontré', [h('p', { class: 'body', text: message })])
}

export function banners(state: AppState): HTMLElement[] {
  if (!state.offline) return []
  return [h('p', { class: 'banner', attrs: { role: 'status' }, text: 'Sin internet. Te muestro la última información guardada.' })]
}

// Teléfono todavía sin habilitar (o al que se le quitó el acceso).
export function waitingScreen(code: string): HTMLElement {
  return screen(
    '¡Hola!',
    [
      h('p', { class: 'body', text: 'Esperando que tu familiar te habilite.' }),
      h('p', { class: 'body', text: 'Mostrale este número:' }),
      h('p', { class: 'pairing-code', text: code, attrs: { 'aria-label': `Código ${code.split('').join(' ')}` } }),
      h('p', { class: 'caption', text: 'Cuando te habilite, tus cosas aparecen solas acá.' }),
    ],
    { showHome: false },
  )
}

export interface InstallPrompt {
  prompt(): Promise<void>
}

export function welcomeScreen(state: AppState, install: InstallPrompt | null, onStart: () => void): HTMLElement {
  const { userName, adminName } = state.content
  const steps = install
    ? [bigButton('📲', 'Agregar a la pantalla de inicio', () => void install.prompt(), 'secondary')]
    : [
        h('ol', { class: 'steps' }, [
          h('li', { text: 'Tocá los tres puntitos ⋮ de arriba a la derecha.' }),
          h('li', { text: 'Tocá "Agregar a la pantalla de inicio".' }),
          h('li', { text: 'Tocá "Agregar".' }),
        ]),
      ]

  return screen(
    greeting(userName),
    [
      h('p', { class: 'body', text: `Acá vas a ver los mensajes, recordatorios y tarjetas de regalo que te cargue ${adminName}.` }),
      h('section', { attrs: { 'aria-labelledby': 'instalar' } }, [
        h('h2', { text: 'Para tenerla siempre a mano', attrs: { id: 'instalar' } }),
        h('p', { class: 'body', text: 'Ponela en la pantalla de inicio de tu teléfono, como las otras aplicaciones:' }),
        ...steps,
      ]),
      bigButton('👉', 'Empezar', onStart),
    ],
    { showHome: false },
  )
}
