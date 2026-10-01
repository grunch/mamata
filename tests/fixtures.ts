import type { Content } from '../src/shared/model.ts'

// Datos sintéticos para tests. Nada real.
export function sampleContent(): Content {
  return {
    schemaVersion: 1,
    updatedAt: '2026-10-01T12:00:00.000Z',
    userName: 'Marta',
    adminName: 'Fer',
    messages: [
      {
        id: 'm1',
        title: '¡Mañana vamos a almorzar!',
        body: 'Te paso a buscar a las 12.',
        style: 'buena-noticia',
        emoji: '🍝',
        createdAt: '2026-10-01T11:00:00.000Z',
      },
      {
        id: 'm2',
        title: 'Turno con el médico',
        body: 'El jueves a las 10, llevá la credencial.',
        style: 'importante',
        imageId: 'img1',
        createdAt: '2026-09-28T09:00:00.000Z',
        archivedAt: '2026-09-30T09:00:00.000Z',
      },
    ],
    reminders: [
      {
        id: 'r1',
        title: 'Tomar la pastilla',
        description: 'La blanca, con el desayuno.',
        icon: '💊',
        startsAt: '2026-09-01T11:00:00.000Z',
        repeat: 'daily',
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ],
    giftCards: [
      {
        id: 'g1',
        providerId: 'ohgiftcard',
        label: 'Gift card del cumpleaños',
        redeemCode: '0000111122223333',
        imageId: 'img2',
        brands: ['Día', 'Carrefour'],
        initialAmount: 200000,
        currency: 'ARS',
        expiresOn: '2026-11-19',
        adminBalances: [{ amount: 150000, at: '2026-09-20T15:00:00.000Z' }],
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ],
    trash: [],
  }
}
