// Pantallas y avisos de estado: sin link, sin contenido, sin internet, bienvenida.
// Lenguaje simple: nunca "error", "caché", "sincronizar" ni "clave".
import type { AppState } from '../context.ts'
import { bigButton, h, screen } from '../ui.ts'

export function noLinkScreen(): HTMLElement {
  return screen('¡Hola!', [h('p', { class: 'body', text: 'Para ver tus cosas, pedile el link a tu familiar.' })], { showHome: false })
}

export function emptyScreen(): HTMLElement {
  return screen(
    '¡Hola!',
    [h('p', { class: 'body', text: 'Todavía no hay nada para mostrar. Cuando tu familiar cargue información, va a aparecer acá.' })],
    { showHome: false },
  )
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
  const admin = state.content.adminName || 'tu familiar'
  const result: HTMLElement[] = []
  if (state.offline) {
    result.push(h('p', { class: 'banner', attrs: { role: 'status' }, text: 'Sin internet. Te muestro la última información guardada.' }))
  }
  if (state.outdatedKey) {
    result.push(
      h('p', { class: 'banner', attrs: { role: 'status' }, text: `Hay información nueva. Pedile a ${admin} que te mande el link otra vez.` }),
    )
  }
  return result
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
    `¡Hola, ${userName}!`,
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
