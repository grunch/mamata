// Vincular teléfonos: link público con la npub del admin, pedidos pendientes con su
// código de 6 dígitos, teléfonos aprobados y quitar acceso.
import QRCode from 'qrcode'
import { h } from '../../app/ui.ts'
import { formatNoted } from '../../shared/dates.ts'
import { linkFor } from '../../shared/nostr/pairing.ts'
import type { AdminContext } from '../context.ts'
import type { Device } from '../devices.ts'
import { smallButton } from '../forms.ts'

const STATUS_LABEL: Record<Device['status'], string> = {
  pending: 'Pide acceso',
  approved: 'Habilitado',
  revoked: 'Sin acceso',
}

function deviceRow(ctx: AdminContext, device: Device): HTMLLIElement {
  const revoke = () => {
    const ok = window.confirm(
      `Se genera una clave nueva, se vuelve a publicar todo y el teléfono ${device.code} deja de ver el contenido. ¿Seguir?`,
    )
    if (ok) void ctx.revoke(device.pubkey)
  }
  const askedAt = formatNoted(new Date(device.requestedAt * 1000), new Date(ctx.now()))
  // Con dos pedidos del mismo código, uno puede ser un impostor: no se deja aprobar ninguno.
  const canApprove = device.status !== 'approved' && !device.suspicious
  return h('li', {}, [
    h('p', { class: 'item-title', text: `Teléfono · código ${device.code}` }),
    h('p', { class: 'hint', text: `${STATUS_LABEL[device.status]} · Pidió acceso ${askedAt}` }),
    device.suspicious &&
      h('p', {
        class: 'warning',
        text: 'Hay otro pedido con el mismo código: alguien podría estar haciéndose pasar por el teléfono. No apruebes ninguno; borrá los datos de la app en el teléfono y volvé a abrir el link.',
      }),
    canApprove && h('p', { class: 'hint', text: 'Aprobalo solo si el código coincide con el que muestra el teléfono ahora.' }),
    h('div', { class: 'row' }, [
      canApprove && smallButton('Aprobar', () => void ctx.approve(device.pubkey), 'primary'),
      device.status === 'approved' && smallButton('Quitar acceso', revoke, 'danger'),
    ]),
  ])
}

export function linkSection(ctx: AdminContext): HTMLElement {
  const link = linkFor(ctx.session.adminPubkey)
  const canvas = h('canvas', { attrs: { 'aria-label': 'Código QR del link de vinculación', role: 'img' } })
  void QRCode.toCanvas(canvas, link, { width: 280, margin: 2, errorCorrectionLevel: 'M' }).catch(() => undefined)

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

  const { devices } = ctx.session
  return h('section', { class: 'admin-section' }, [
    h('h2', { text: 'Vincular teléfono' }),
    h('ol', { class: 'steps' }, [
      h('li', { text: 'En el teléfono, abrí Chrome y escaneá el código (o mandale el link).' }),
      h('li', { text: 'El teléfono muestra un código de 6 números. Aprobalo acá si coincide.' }),
      h('li', { text: 'Para instalarla: tres puntitos ⋮ → "Agregar a la pantalla de inicio".' }),
    ]),
    canvas,
    linkBox,
    h('div', { class: 'row' }, [smallButton('Copiar link', () => void copy(), 'primary')]),
    h('p', { class: 'hint', text: 'El link no tiene nada secreto: sin tu aprobación, nadie ve el contenido.' }),
    h('h3', { text: 'Teléfonos' }),
    devices.length === 0 && h('p', { class: 'hint', text: 'Todavía no hay teléfonos. Abrí el link en el teléfono.' }),
    h('ul', { class: 'admin-list' }, devices.map((d) => deviceRow(ctx, d))),
    smallButton('Buscar pedidos nuevos', () => void ctx.refreshDevices()),
    h('h3', { text: 'Este navegador' }),
    smallButton('Cerrar sesión (olvidar la clave en este navegador)', () => ctx.logout()),
  ])
}
