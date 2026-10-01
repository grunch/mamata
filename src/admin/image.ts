// Achica y comprime las fotos en el navegador antes de cifrarlas y subirlas.
import type { Bytes } from '../shared/crypto.ts'

const MAX_SIDE = 1280
const QUALITY = 0.8

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY))
}

export async function compressImage(file: File): Promise<Bytes> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('El navegador no puede procesar imágenes')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  // WebP pesa menos; si el navegador no lo soporta, devuelve PNG y se usa JPEG.
  let blob = await toBlob(canvas, 'image/webp')
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg')
  if (!blob) throw new Error('No se pudo comprimir la imagen')
  return new Uint8Array(await blob.arrayBuffer())
}
