// Datos de ejemplo para probar en local, cifrados con una clave de prueba nueva.
// Escribe en seed-out/data/ (ignorado por git). Nunca toca public/data/.
//   npm run seed  →  después `npm run dev` y abrir el link que imprime.
//   MAMATA_SEED_KEY=<clave> npm run seed  →  usa esa clave (para los tests e2e).
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_AAD, encryptJson, generateKey, importKey } from '../src/shared/crypto.ts'
import { parseContent, type Content } from '../src/shared/model.ts'

const OUT_DIR = join(import.meta.dirname, '..', 'seed-out', 'data')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function sampleContent(now: Date): Content {
  const iso = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString()
  // Hora fija de Argentina (UTC-3) para el día de hoy.
  const todayAt = (hour: number, plusDays = 0) => {
    const local = new Date(now.getTime() - 3 * HOUR)
    return new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + plusDays, hour + 3),
    ).toISOString()
  }

  return {
    schemaVersion: 1,
    updatedAt: iso(0),
    userName: 'Marta',
    adminName: 'Fer',
    messages: [
      {
        id: 'bienvenida',
        title: '¡Bienvenida a tu app!',
        body: 'Acá te voy a dejar mensajes, recordatorios y tus tarjetas de regalo.\nNo se borra nada, quedate tranquila.',
        style: 'buena-noticia',
        emoji: '🌻',
        createdAt: iso(-2 * HOUR),
      },
      {
        id: 'medico',
        title: 'Turno con el médico',
        body: 'El jueves a las 10 tenés turno con la doctora. Llevá la credencial.',
        style: 'importante',
        emoji: '🩺',
        createdAt: iso(-3 * DAY),
      },
    ],
    reminders: [
      {
        id: 'pastilla',
        title: 'Tomar la pastilla',
        description: 'La blanca, con el desayuno.',
        icon: '💊',
        startsAt: todayAt(9),
        repeat: 'daily',
        createdAt: iso(-10 * DAY),
      },
      {
        id: 'agua-plantas',
        title: 'Regar las plantas',
        description: '',
        icon: '🪴',
        startsAt: todayAt(18),
        repeat: 'weekly',
        createdAt: iso(-10 * DAY),
      },
      {
        id: 'almuerzo',
        title: 'Almuerzo en casa de Fer',
        description: 'Te paso a buscar a las 12.',
        icon: '🍝',
        startsAt: todayAt(12, 2),
        repeat: 'once',
        createdAt: iso(-1 * DAY),
      },
    ],
    giftCards: [
      {
        id: 'cumple',
        providerId: 'ohgiftcard',
        label: 'Tarjeta del cumpleaños',
        // Código de prueba: no es una tarjeta real.
        redeemCode: '0000111122223333',
        brands: ['Día', 'Carrefour'],
        initialAmount: 200000,
        currency: 'ARS',
        expiresOn: new Date(now.getTime() + 20 * DAY).toISOString().slice(0, 10),
        adminBalances: [],
        createdAt: iso(-15 * DAY),
      },
    ],
    trash: [],
  }
}

async function main(): Promise<void> {
  // Los tests e2e pasan una clave fija; si no, se genera una nueva cada vez.
  const encodedKey = process.env.MAMATA_SEED_KEY ?? (await generateKey())
  const key = await importKey(encodedKey)
  const content = parseContent(sampleContent(new Date()))

  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(join(OUT_DIR, 'img'), { recursive: true })
  await writeFile(join(OUT_DIR, 'data.enc'), await encryptJson(key, content, DATA_AAD))

  console.log('Datos de ejemplo listos en seed-out/data/')
  console.log(`Abrí: http://localhost:5173/#k=${encodedKey}`)
}

await main()
