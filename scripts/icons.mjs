// Genera los íconos PNG de la PWA a partir de public/icons/icon.svg usando el Chromium de Playwright.
//   node scripts/icons.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const dir = join(import.meta.dirname, '..', 'public', 'icons')
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')
const browser = await chromium.launch()
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`)
  await page.screenshot({ path: join(dir, `icon-${size}.png`) })
  await page.close()
}
await browser.close()
console.log('Íconos generados en public/icons/')
