# Mamata

App web (PWA) para que una persona mayor vea **mensajes, recordatorios y tarjetas de regalo** que le carga un familiar, sin poder borrar nada por error.

- App del usuario: **https://mamata.live/**
- Panel del admin: **https://mamata.live/admin/**

## Cómo funciona

- **El código** es un sitio estático (Vite + TypeScript, sin framework) publicado en **GitHub Pages**.
- **El contenido** viaja por **Nostr**, en tiempo real. Lo que publica el admin le llega al teléfono en segundos, sin despliegues.
  - Relays: `wss://relay.mostro.network`, `wss://relay.shadowbip.com` y `wss://nos.lol`.
  - Imágenes: en **Blossom**, en `nostr.download` y `blossom.yakihonne.com`.
- **Todo va cifrado**:
  - cada mensaje, recordatorio o gift card es un evento propio, cifrado con NIP-44 usando una **clave de contenido**;
  - las imágenes van cifradas con AES-GCM.

  Los relays y Blossom solo ven datos ilegibles.
- **Solo vale lo que firma el admin.** La app muestra únicamente eventos firmados por la clave del admin.

### Claves

| Clave | Dónde vive | Para qué |
|---|---|---|
| **Admin** (nsec) | En el panel, pegada (queda en ese navegador) o en una extensión NIP-07 como nos2x | Firmar lo que se publica |
| **Teléfono** | Se genera en el teléfono la primera vez y nunca sale de ahí (se ve en ⚙️ Ajustes) | Pedir acceso y recibir la clave de contenido |
| **Contenido** | La genera el panel y la manda cifrada a cada teléfono aprobado | Cifrar mensajes, recordatorios, gift cards e imágenes |

### Eventos

| kind | qué |
|---|---|
| 36000 / 36001 / 36002 | mensaje / recordatorio / gift card (uno por ítem, reemplazable) |
| 36003 | nombres (perfil) |
| 36010 | pedido de vinculación del teléfono |
| 36011 | clave de contenido para un teléfono (vacía = sin acceso) |
| 36012 | copia de la clave de contenido para el admin (abrir el panel en otro navegador) |

### Lo que no hace, a propósito

- **No hay notificaciones push con la app cerrada.** Con la app abierta, lo nuevo aparece solo.
- **El admin no ve lo que hace el usuario**: lo que leyó, lo que marcó como hecho y los saldos que anotó quedan solo en su teléfono.
- **No consulta saldos automáticamente.** Abre la página oficial y después pregunta "¿Cuánto te queda?".

### Privacidad

- **El link de vinculación** (`https://mamata.live/#npub=…`) **no tiene nada secreto.** Sin tu aprobación, nadie ve el contenido.
- **La nsec del admin es la llave de todo:** quien la tenga puede publicar en la app. Usá **una clave dedicada a Mamata**, no tu identidad personal de Nostr, y guardala en un gestor de contraseñas.
- **Si perdés la nsec**, perdés la posibilidad de editar lo publicado. Empezás de nuevo con una clave nueva y volvés a vincular el teléfono.
- **Un teléfono ya vinculado ignora links de otro admin.** Para cambiar de admin hay que borrar los datos de la app en ese teléfono.
- **Al aprobar, compará el código de 6 números con el que muestra el teléfono en ese momento.** Si dos pedidos tienen el mismo código, el panel los marca como posible engaño y no deja aprobarlos.
- **Límites de "Quitar acceso":**
  - lo que ese teléfono ya vio (incluidos los códigos de las gift cards) lo pudo haber guardado; consideralo expuesto;
  - si un relay le oculta el aviso de "sin acceso", el teléfono revocado sigue mostrando lo último que tenía, pero no puede leer nada nuevo.

---

## Puesta en marcha

### 1. Sitio y dominio (una sola vez)

1. En GitHub, **Settings → Pages → Source: GitHub Actions**. Cada push a `main` despliega.
2. **DNS de `mamata.live`:**
   - registros `A` hacia `185.199.108.153`, `.109.153`, `.110.153` y `.111.153`;
   - registros `AAAA` hacia `2606:50c0:8000::153`, `8001::153`, `8002::153` y `8003::153`;
   - `www` como `CNAME` hacia `grunch.github.io`.
3. Verificá el dominio en tu perfil (**Settings → Pages**), escribí `mamata.live` en **Custom domain** y activá **Enforce HTTPS**.

`main` está protegida: los cambios de código entran por pull request.

### 2. Entrar al panel

1. Abrí <https://mamata.live/admin/>.
2. Elegí cómo firmar:
   - **Generar una clave nueva** (la primera vez): el panel crea una nsec para Mamata y te la muestra una sola vez. **Guardala en tu gestor de contraseñas** antes de entrar.
   - **Pegar la nsec** (`nsec1…`): queda guardada solo en ese navegador.
   - **Usar extensión de Nostr** (nos2x u otra con soporte de NIP-44): la nsec queda en la extensión.
3. La primera vez completá el nombre de quien usa la app y el tuyo.
4. Cargá un mensaje y tocá **Guardar**: se publica en el momento. La barra de abajo dice **"Todo publicado"**, o **"Reintentar"** si algún cambio no llegó a por lo menos 2 relays.

### 3. Vincular el teléfono

1. En el panel, entrá a **📱 Vincular teléfono** y escaneá el QR con el teléfono, o mandale el link.
2. El teléfono muestra **"Esperando que tu familiar te habilite"** y un **código de 6 números**.
3. En el panel aparece **"Teléfono · código XXXX"**. Si el código coincide, tocá **Aprobar**.
4. En segundos aparece todo en el teléfono. Instalá la app: **⋮ → Agregar a la pantalla de inicio**.

### Quitar acceso a un teléfono

En **📱 Vincular teléfono**, tocá **Quitar acceso** en ese teléfono. El panel:
1. genera una clave de contenido nueva;
2. vuelve a publicar todo, incluidas las imágenes, con esa clave;
3. se la manda solo a los teléfonos que siguen habilitados.

El teléfono al que se le quitó el acceso vuelve a la pantalla de espera.

> Si un teléfono borra los datos del navegador, pierde su clave y genera otra. Vas a ver un pedido nuevo: aprobalo de nuevo.

---

## Desarrollo

Hace falta Node 24.

```bash
npm install
npm run dev        # http://localhost:5173 (usa los relays reales)
```

| Comando | Qué hace |
|---|---|
| `npm test` | Tests unitarios y de pantallas (Vitest) |
| `npm run coverage` | Tests con cobertura (mínimo 80%) |
| `npm run e2e` | De punta a punta en un Chrome de Android emulado, con **relays simulados** (`e2e/fake-relay.ts`): nada sale a internet |
| `npm run build` | Chequeo de tipos + build de producción en `dist/` |
| `node scripts/icons.mjs` | Regenera los íconos PNG desde `public/icons/icon.svg` |

Para los tests e2e, la primera vez: `npx playwright install chromium`.

### Estructura

```
index.html  admin/index.html   app del usuario y panel
src/shared/nostr/              kinds, cifrado NIP-44, eventos, vinculación, firmantes, relays, Blossom
src/shared/                    modelo y validación, fechas, saldos, proveedores, AES-GCM
src/app/                       app del usuario (sincronización, pantallas, almacenamiento local)
src/admin/                     panel (publicar cambios, teléfonos, pantallas)
tests/  e2e/                   tests unitarios y de punta a punta
docs/checklists.md             accesibilidad y pruebas manuales en Android
```

### Cambiar relays o servidores Blossom

Están en `src/shared/nostr/constants.ts`. Antes de agregar uno, probá que:
- **un relay** acepte los kinds 36000–36012 y reemplace bien los eventos;
- **un servidor Blossom** acepte archivos `application/octet-stream`, porque las imágenes van cifradas.

La CSP del build se arma sola con esa lista.

### Agregar otro proveedor de gift cards

Sumá una entrada en `src/shared/providers.ts` con su nombre, color y la URL de consulta de saldo (`{codigo}` se reemplaza por el código de la tarjeta).
