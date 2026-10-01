import { defineConfig, devices } from '@playwright/test'

// Clave de prueba fija: solo cifra los datos de ejemplo del seed.
export const E2E_KEY = 'qC8FpiQqZ7ZqHBEfxk4sd5eZUkVjutzu078hOO6I2_Y'
const PORT = 5174

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node scripts/seed.ts && npx vite --port ${PORT} --strictPort`,
    env: { MAMATA_SEED_KEY: E2E_KEY },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
})
