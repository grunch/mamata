// Vincular el teléfono: link con la clave, código QR y rotación de la clave.
import QRCode from 'qrcode'
import { h } from '../../app/ui.ts'
import type { AdminContext } from '../context.ts'
import { smallButton } from '../forms.ts'
import { linkFor } from '../settings.ts'

export function linkSection(ctx: AdminContext): HTMLElement {
  const link = linkFor(ctx.session.encodedKey)
  const canvas = h('canvas', { attrs: { 'aria-label': 'Código QR del link de vinculación', role: 'img' } })
  void QRCode.toCanvas(canvas, link, { width: 280, margin: 2, errorCorrectionLevel: 'M' })

  const linkBox = h('input', { attrs: { type: 'text', readonly: '', 'aria-label': 'Link de vinculación' } })
  linkBox.value = link

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      ctx.toast('Link copiado.')
    } catch {
      linkBox.select()
      ctx.toast('Seleccioné el link: copialo a mano.')
    }
  }

  const rotate = () => {
    const ok = window.confirm(
      'Se genera una clave nueva y se vuelve a cifrar todo. El teléfono va a necesitar el link nuevo. ¿Seguir?',
    )
    if (ok) void ctx.rotate()
  }

  return h('section', { class: 'admin-section' }, [
    h('h2', { text: 'Vincular teléfono' }),
    h('ol', { class: 'steps' }, [
      h('li', { text: 'En el teléfono, abrí Chrome y escaneá el código (o mandale el link).' }),
      h('li', { text: 'Cuando abra la app, tocá los tres puntitos ⋮ y "Agregar a la pantalla de inicio".' }),
    ]),
    canvas,
    linkBox,
    h('div', { class: 'row' }, [smallButton('Copiar link', () => void copy(), 'primary')]),
    h('p', {
      class: 'warning',
      text: 'Este link es la llave de todo: quien lo tenga puede ver las tarjetas. Si lo mandás por chat, borralo después.',
    }),
    h('h3', { text: 'Si el link se filtró' }),
    h('p', {
      class: 'hint',
      text: 'Cambiar la clave vuelve a cifrar todo. El link viejo deja de servir para lo nuevo, pero lo ya publicado sigue en el historial de git.',
    }),
    smallButton('Cambiar la clave', rotate, 'danger'),
    h('h3', { text: 'Este navegador' }),
    smallButton('Cerrar sesión (olvidar token y clave)', () => ctx.logout()),
  ])
}
