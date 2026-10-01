// Mini ayudante de DOM. Nunca usa innerHTML: todo texto entra como texto,
// así lo que escribe el admin no se puede interpretar como HTML.

type Child = Node | string | null | undefined | false
type Handler = (event: Event) => void

export interface Props {
  class?: string
  text?: string
  attrs?: Record<string, string>
  on?: Record<string, Handler>
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props.class) el.className = props.class
  if (props.text !== undefined) el.textContent = props.text
  for (const [name, value] of Object.entries(props.attrs ?? {})) el.setAttribute(name, value)
  for (const [event, handler] of Object.entries(props.on ?? {})) el.addEventListener(event, handler)
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(child)
  }
  return el
}

// Ícono decorativo + texto: los lectores de pantalla solo leen el texto.
function iconLabel(icon: string, label: string): Child[] {
  return [h('span', { class: 'icon', text: icon, attrs: { 'aria-hidden': 'true' } }), h('span', { text: label })]
}

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'

export function bigButton(icon: string, label: string, onClick: () => void, variant: ButtonVariant = 'primary'): HTMLButtonElement {
  return h('button', { class: `big-button ${variant}`, attrs: { type: 'button' }, on: { click: onClick } }, iconLabel(icon, label))
}

export function bigLink(icon: string, label: string, href: string, variant: ButtonVariant = 'primary'): HTMLAnchorElement {
  return h('a', { class: `big-button ${variant}`, attrs: { href } }, iconLabel(icon, label))
}

export function homeLink(): HTMLAnchorElement {
  return bigLink('🏠', 'Volver al inicio', '#/', 'secondary')
}

// Pantalla estándar: título (recibe el foco al navegar) + contenido + "Volver al inicio".
export function screen(title: string, children: Child[], options: { showHome?: boolean } = {}): HTMLElement {
  const { showHome = true } = options
  return h('main', { class: 'screen', attrs: { id: 'contenido' } }, [
    h('h1', { text: title, attrs: { tabindex: '-1' } }),
    ...children,
    showHome && h('nav', { class: 'home-nav', attrs: { 'aria-label': 'Navegación' } }, [homeLink()]),
  ])
}

// Reemplaza la pantalla. Al navegar, el foco va al título. Si solo cambió el estado
// (un aviso, algo marcado), se conserva lo escrito y el foco donde estaba.
export function replaceScreen(root: HTMLElement, elements: HTMLElement[], moveFocus: boolean): void {
  const active = document.activeElement
  const activeId = active instanceof HTMLElement && root.contains(active) ? active.id : null
  const typed = [...root.querySelectorAll<HTMLInputElement>('input[id]:not([type="checkbox"])')].map((i) => [i.id, i.value])

  root.replaceChildren(...elements)
  const title = root.querySelector<HTMLElement>('h1')
  if (moveFocus) {
    window.scrollTo(0, 0)
    title?.focus()
    return
  }
  for (const [id, value] of typed) {
    const input = root.querySelector<HTMLInputElement>(`input[id="${id}"]`)
    if (input && !input.value) input.value = value ?? ''
  }
  if (activeId === null) return
  const again = activeId ? root.querySelector<HTMLElement>(`[id="${activeId}"]`) : null
  ;(again ?? title)?.focus()
}

const TOAST_MS = 6000
let toastTimer: ReturnType<typeof setTimeout> | undefined

// Confirmación visible y anunciada ("¡Listo! …").
export function announce(message: string): void {
  const region = document.getElementById('aviso')
  if (!region) return
  region.textContent = message
  region.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    region.hidden = true
  }, TOAST_MS)
}
