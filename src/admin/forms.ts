// Campos de formulario del panel admin, con su etiqueta siempre visible.
import { h } from '../app/ui.ts'

let fieldCounter = 0
const nextId = () => `campo-${++fieldCounter}`

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || nextId()
  control.id = id
  return h('div', { class: 'field' }, [
    h('label', { text: label, attrs: { for: id } }),
    control,
    hint && h('p', { class: 'hint', text: hint }),
  ])
}

export function textInput(value = '', attrs: Record<string, string> = {}): HTMLInputElement {
  const input = h('input', { attrs: { type: 'text', autocomplete: 'off', ...attrs } })
  input.value = value
  return input
}

export function textArea(value = '', rows = 4): HTMLTextAreaElement {
  const area = h('textarea', { attrs: { rows: String(rows) } })
  area.value = value
  return area
}

export function selectInput(options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const select = h(
    'select',
    {},
    options.map((o) => h('option', { text: o.label, attrs: { value: o.value } })),
  )
  select.value = value
  return select
}

export function fileInput(): HTMLInputElement {
  return h('input', { attrs: { type: 'file', accept: 'image/*' } })
}

export function smallButton(label: string, onClick: () => void, variant = 'secondary'): HTMLButtonElement {
  return h('button', { class: `small-button ${variant}`, text: label, attrs: { type: 'button' }, on: { click: onClick } })
}

export function formError(): HTMLParagraphElement {
  return h('p', { class: 'error', attrs: { role: 'alert', hidden: '' } })
}

export function showError(el: HTMLParagraphElement, message: string): void {
  el.textContent = message
  el.hidden = false
}
