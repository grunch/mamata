import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_KEY } from '../playwright.config.ts'

// Simula la vuelta desde la pestaña de Chrome (la X): la app vuelve a estar visible.
async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

test.describe('app del usuario', () => {
  test.beforeEach(async ({ page }) => {
    // window.open se reemplaza para registrar qué página se abrió sin salir del test.
    await page.addInitScript(() => {
      const opened: string[] = []
      Object.assign(window, { __opened: opened })
      window.open = (url) => {
        opened.push(String(url))
        return null
      }
    })
  })

  test('sin link muestra cómo pedirlo', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('Para ver tus cosas, pedile el link a tu familiar.')).toBeVisible()
  })

  test('vincula, saca la clave de la URL y muestra el inicio', async ({ page }) => {
    await page.goto(`/#k=${E2E_KEY}`)

    await expect(page).toHaveURL(/#\/$/)
    await page.getByRole('button', { name: 'Empezar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '¡Hola, Marta!' })).toBeVisible()
    await expect(page.getByText('Tenés 2 mensajes nuevos')).toBeVisible()
  })

  test('si todavía no hay nada publicado, aparece solo cuando se publica', async ({ page }) => {
    await page.route('**/data/data.enc', (route) => route.fulfill({ status: 404, body: 'no' }))
    await page.goto(`/#k=${E2E_KEY}`)
    await expect(page.getByText('Todavía no hay nada para mostrar')).toBeVisible()

    // Se publica: el archivo ya existe. La app reintenta al volver a primer plano, sin recargar.
    await page.unroute('**/data/data.enc')
    await comeBack(page)

    await expect(page.getByRole('button', { name: 'Empezar' })).toBeVisible()
  })

  test('marca un mensaje como leído', async ({ page }) => {
    await page.goto(`/#k=${E2E_KEY}`)
    await page.getByRole('button', { name: 'Empezar' }).click()

    await page.getByRole('link', { name: 'Ver mensaje' }).click()
    await page.getByRole('button', { name: 'Entendido' }).click()

    await expect(page.getByText('¡Listo! Lo marcaste como leído.')).toBeVisible()
    await expect(page.getByText('✔ Ya lo leíste')).toBeVisible()
  })

  test('ver saldo, volver y anotar cuánto queda', async ({ page }) => {
    await page.goto(`/#k=${E2E_KEY}`)
    await page.getByRole('button', { name: 'Empezar' }).click()
    await page.getByRole('link', { name: 'Tarjetas de regalo' }).click()
    await page.getByRole('link', { name: /Tarjeta del cumpleaños/ }).click()

    await page.getByRole('button', { name: 'Ver saldo' }).click()
    await expect(page.getByText('Para volver acá, tocá la X')).toBeVisible()
    await page.getByRole('button', { name: 'Ver mi saldo' }).click()

    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
    expect(opened).toEqual(['https://tienda.ohgiftcard.com.ar/redeem?redeemCode=0000111122223333'])

    await comeBack(page)
    await expect(page.getByRole('heading', { name: '¿Cuánto te queda en esta gift card?' })).toBeVisible()

    const amount = page.getByLabel('Escribí el número que te mostró la página:')
    await amount.fill('250.000')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText('¿Seguro? Antes tenías $ 200.000.')).toBeVisible()
    await page.getByRole('button', { name: 'Corregir' }).click()

    await amount.fill('120.000')
    await page.getByRole('button', { name: 'Guardar' }).click()

    await expect(page.getByText('¡Listo! Anotaste que te quedan $ 120.000.')).toBeVisible()
    await expect(page.locator('.amount.big')).toHaveText('$ 120.000')

    // Lo anotado sobrevive a recargar la app.
    await page.reload()
    await expect(page.locator('.amount.big')).toHaveText('$ 120.000')
  })

  test('funciona sin internet con lo último guardado', async ({ page, context }) => {
    await page.goto(`/#k=${E2E_KEY}`)
    await page.getByRole('button', { name: 'Empezar' }).click()
    await expect(page.getByRole('heading', { name: '¡Hola, Marta!' })).toBeVisible()

    await context.setOffline(true)

    await expect(page.getByText('Sin internet. Te muestro la última información guardada.')).toBeVisible()
    await page.getByRole('link', { name: 'Recordatorios' }).click()
    await expect(page.getByText('Tomar la pastilla').first()).toBeVisible()
  })
})

test.describe('panel admin', () => {
  test('entra, crea un mensaje y lo publica en un solo commit', async ({ page }) => {
    const seedData = readFileSync(join(import.meta.dirname, '..', 'seed-out', 'data', 'data.enc'))
    const calls: string[] = []
    await page.route('https://api.github.com/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname.replace('/repos/grunch/mamata', '')
      calls.push(`${request.method()} ${path}`)
      const json = (body: unknown, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (request.method() === 'GET' && path === '/git/ref/heads/data') return json({ object: { sha: 'c0' } })
      if (request.method() === 'GET' && path === '/contents/data.enc') return route.fulfill({ body: seedData })
      if (request.method() === 'GET' && path === '/git/commits/c0') return json({ tree: { sha: 't0' } })
      if (request.method() === 'POST' && path === '/git/blobs') return json({ sha: 'b1' }, 201)
      if (request.method() === 'POST' && path === '/git/trees') return json({ sha: 't1' }, 201)
      if (request.method() === 'POST' && path === '/git/commits') return json({ sha: 'c1' }, 201)
      if (request.method() === 'PATCH' && path === '/git/refs/heads/data') return json({ object: { sha: 'c1' } })
      if (request.method() === 'POST' && path === '/dispatches') return route.fulfill({ status: 204 })
      return json({ message: 'Not Found' }, 404)
    })

    await page.goto('/admin/')
    await page.getByLabel('Token de GitHub').fill('token-de-prueba')
    await page.getByLabel('Clave').fill(`https://mamata.live/#k=${E2E_KEY}`)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByText('¡Bienvenida a tu app!')).toBeVisible()

    await page.getByRole('button', { name: '＋ Nuevo mensaje' }).click()
    await page.getByLabel('Título').fill('¡Hola mamá!')
    await page.getByLabel('Texto').fill('Mañana paso a las 5.')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText('Hay cambios sin publicar.')).toBeVisible()

    await page.getByRole('button', { name: 'Publicar cambios' }).click()

    await expect(page.getByText('Todo publicado.')).toBeVisible()
    // Escribe solo en la rama de datos y pide el despliegue.
    expect(calls.filter((c) => c.startsWith('PATCH'))).toEqual(['PATCH /git/refs/heads/data'])
    expect(calls).toContain('POST /dispatches')
  })
})
