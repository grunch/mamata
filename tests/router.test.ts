import { describe, expect, it } from 'vitest'
import { parseRoute, routeHref, type Route } from '../src/app/router.ts'

describe('parseRoute', () => {
  it.each<[string, Route]>([
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/mensajes', { name: 'messages' }],
    ['#/mensajes/m1', { name: 'message', id: 'm1' }],
    ['#/recordatorios', { name: 'reminders' }],
    ['#/tarjetas', { name: 'cards' }],
    ['#/tarjetas/g1', { name: 'card', id: 'g1' }],
    ['#/tarjetas/g1/ver-saldo', { name: 'card-explainer', id: 'g1' }],
    ['#/tarjetas/g1/anotar', { name: 'card-note', id: 'g1' }],
    ['#/tarjetas/g1/historial', { name: 'card-history', id: 'g1' }],
    ['#/ajustes', { name: 'settings' }],
  ])('parses %s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route)
  })

  it('falls back to home for unknown routes', () => {
    expect(parseRoute('#/cualquier-cosa/x/y')).toEqual({ name: 'home' })
  })

  it('decodes ids', () => {
    expect(parseRoute('#/mensajes/a%20b')).toEqual({ name: 'message', id: 'a b' })
  })
})

describe('routeHref', () => {
  it.each<Route>([
    { name: 'home' },
    { name: 'messages' },
    { name: 'message', id: 'm 1' },
    { name: 'reminders' },
    { name: 'cards' },
    { name: 'card', id: 'g1' },
    { name: 'card-explainer', id: 'g1' },
    { name: 'card-note', id: 'g1' },
    { name: 'card-history', id: 'g1' },
    { name: 'settings' },
  ])('round-trips %o', (route) => {
    expect(parseRoute(routeHref(route))).toEqual(route)
  })
})
