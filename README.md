# Mamata

App web (PWA) para que una persona mayor vea **mensajes, recordatorios y tarjetas de regalo** que le carga un familiar, sin poder borrar nada por error.

- App del usuario: **https://mamata.live/**
- Panel del admin: **https://mamata.live/admin/**

## Cómo funciona

- Es un **sitio estático** (Vite + TypeScript, sin framework) publicado en **GitHub Pages**. No hay servidor ni base de datos.
- Lo que carga el admin vive en la rama **`data`** de este repo, **cifrado** con AES-GCM 256: `data.enc` y una imagen por archivo en `img/<id>.enc`. El código vive en `main`, que está protegida: el token del panel no la puede tocar.
- La **clave** nunca está en el repo. Viaja solo en el link de vinculación (`https://mamata.live/#k=<clave>`). La parte después del `#` no se envía al servidor.
- El panel `/admin` descifra, deja editar, vuelve a cifrar y publica con la API de GitHub en **un solo commit** en la rama `data`. Después le pide a GitHub Actions que despliegue (un `repository_dispatch`). El workflow arma el sitio con el código de `main` y copia de `data` **solo** los archivos `.enc`. En uno o dos minutos el teléfono ve lo nuevo.
- Lo que hace el usuario ("Entendido", "Ya lo hice", los saldos que anota) queda **solo en su teléfono**, en IndexedDB.

### Lo que no hace, a propósito

- **No hay notificaciones push**, porque un sitio estático no puede mandarlas. Los mensajes y recordatorios se ven al abrir la app.
- **El admin no ve lo que hace el usuario**, como qué leyó o qué saldos anotó.
- **No consulta saldos automáticamente.** oh! Gift Card no tiene API pública para particulares, así que la app abre la página oficial y después pregunta "¿Cuánto te queda?".

### Privacidad: lo que hay que saber

- El repo es público: cualquiera puede descargar los archivos cifrados, pero sin la clave no sirven de nada.
- **El link con la clave es la llave de todo.** Quien lo tenga puede ver las tarjetas. No lo publiques, y si lo mandás por chat, borralo después.
- Lo cifrado queda para siempre en el historial de git. Si la clave se filtra, se puede leer todo lo publicado con esa clave, incluso lo viejo. Por eso existe **"Cambiar la clave"**: lo nuevo queda protegido con la clave nueva.
- Si perdés la clave, el contenido no se puede recuperar. **Guardala en un gestor de contraseñas.**

---

## Puesta en marcha (una sola vez)

### 1. Subir el código a GitHub

El repo es `https://github.com/grunch/mamata` (público).

```bash
git push -u origin main
```

### 2. Activar GitHub Pages

1. En GitHub, entrá a **Settings → Pages**.
2. En **Build and deployment → Source**, elegí **GitHub Actions**.
3. Andá a la pestaña **Actions** y verificá que el workflow "Publicar en GitHub Pages" termine en verde. Si no corrió, ejecutalo a mano con **Run workflow**.

### 3. Conectar el dominio `mamata.live`

En el panel de DNS de donde registraste el dominio:

| Tipo  | Nombre | Valor                 |
|-------|--------|-----------------------|
| A     | `@`    | `185.199.108.153`     |
| A     | `@`    | `185.199.109.153`     |
| A     | `@`    | `185.199.110.153`     |
| A     | `@`    | `185.199.111.153`     |
| AAAA  | `@`    | `2606:50c0:8000::153` |
| AAAA  | `@`    | `2606:50c0:8001::153` |
| AAAA  | `@`    | `2606:50c0:8002::153` |
| AAAA  | `@`    | `2606:50c0:8003::153` |
| CNAME | `www`  | `grunch.github.io`    |

Después, en GitHub:

1. **Verificá el dominio** (evita que otro lo use con su cuenta): en tu perfil, entrá a **Settings → Pages → Add a domain** y escribí `mamata.live`. GitHub te da un registro `TXT` para agregar en el DNS. Agregalo y tocá **Verify**.
2. En **Settings → Pages** del repo, en **Custom domain**, escribí `mamata.live` y guardá.
3. Cuando el chequeo de DNS esté en verde (puede tardar hasta un día), activá **Enforce HTTPS**.

> El archivo `public/CNAME` ya tiene `mamata.live`. Con despliegue por Actions, el dominio que vale es el que configurás en **Settings → Pages**.

### 4. Proteger `main` (para que el token del panel no pueda cambiar el código)

Si alguien te robara el token del panel, podría intentar subir código malicioso que se despliegue y le saque la clave a los teléfonos. Para evitarlo, `main` solo se cambia con pull requests, y el token no tiene permiso sobre pull requests.

1. **Settings → Rules → Rulesets → New ruleset → New branch ruleset**.
2. **Name:** `proteger-main`. **Enforcement:** *Active*. **Bypass list:** vacía (ni siquiera vos: si no, el token también podría saltarla).
3. **Target branches:** *Include default branch*.
4. Marcá **Restrict deletions**, **Block force pushes** y **Require a pull request before merging** (0 aprobaciones alcanza).
5. Desde ahora, los cambios de código se suben en una rama y se mergean con un PR desde la web de GitHub.

Además, en **Settings → Environments → github-pages → Deployment branches and tags**, dejá solo `main`.

### 5. Crear el token de GitHub para el panel

1. Entrá a <https://github.com/settings/personal-access-tokens/new> (*fine-grained token*).
2. **Token name:** `mamata-panel`. **Expiration:** la que prefieras (máximo un año). Agendá cuándo vence.
3. **Repository access:** *Only select repositories* → `grunch/mamata`.
4. **Permissions → Repository permissions → Contents:** *Read and write*. **Nada más**: sin *Workflows*, sin *Pull requests*, sin *Administration*. Así el token solo puede escribir en ramas sin protección (la de datos) y no puede crear workflows.
5. Generalo y copialo. Va a ir solo al panel, en tu navegador.

### 6. Primer uso del panel

1. Abrí <https://mamata.live/admin/>.
2. Pegá el token.
3. Tocá **"Es la primera vez: generar una clave nueva"** y **guardá esa clave** en tu gestor de contraseñas.
4. Completá el nombre de quien usa la app y el tuyo. Tocá **Entrar**.
5. Cargá mensajes, recordatorios y tarjetas, y tocá **Publicar cambios**. La primera vez se crea la rama `data`.
6. Si el panel avisa que GitHub no arrancó la publicación, en el repo andá a **Actions → Publicar en GitHub Pages → Run workflow**.

### 7. Vincular el teléfono

1. En el panel, entrá a **📱 Vincular teléfono**.
2. En el teléfono, abrí **Chrome** y escaneá el QR, o abrí el link.
3. Tocá **Empezar**.
4. Instalá la app: tocá **⋮ → Agregar a la pantalla de inicio**, o el botón que aparece en la bienvenida. Hacelo **después** de abrir el link, desde el mismo Chrome, así la app instalada tiene la clave.

### Si el link se filtró: cambiar la clave

En **📱 Vincular teléfono → Cambiar la clave**. Se genera una clave nueva, se vuelve a cifrar todo y se borran las imágenes que ya no se usan. Después tenés que volver a vincular el teléfono con el link nuevo. Mientras tanto, el teléfono sigue mostrando lo último que tenía, con un aviso de que hay información nueva.

---

## Desarrollo

Hace falta Node 24.

```bash
npm install
npm run seed      # datos de ejemplo cifrados en seed-out/ (no toca public/data/)
npm run dev       # abrir el link que imprimió el seed
```

| Comando            | Qué hace                                                   |
|--------------------|------------------------------------------------------------|
| `npm test`         | Tests unitarios y de pantallas (Vitest)                    |
| `npm run coverage` | Tests con cobertura (mínimo 80%)                           |
| `npm run e2e`      | Tests de punta a punta en un Chrome de Android emulado (Playwright) |
| `npm run build`    | Chequeo de tipos + build de producción en `dist/`          |
| `node scripts/icons.mjs` | Regenera los íconos PNG desde `public/icons/icon.svg` |

Para los tests e2e, la primera vez: `npx playwright install chromium`.

### Estructura

```
index.html            app del usuario
admin/index.html      panel admin
src/shared/           cifrado, modelo y validación, fechas, saldos, proveedores
src/app/              app del usuario (pantallas, almacenamiento local, contenido)
src/admin/            panel (borrador, GitHub, publicar, pantallas)
src/styles/           estilos (letra grande, contraste alto)
public/data/          (ignorado por git) el workflow copia acá el contenido de la rama `data`
scripts/              seed de ejemplo e íconos
tests/  e2e/          tests unitarios y de punta a punta
docs/checklists.md    accesibilidad y pruebas manuales en Android
```

### Agregar otro proveedor de gift cards

Sumá una entrada en `src/shared/providers.ts` con su nombre, color y la URL de consulta de saldo (`{codigo}` se reemplaza por el código de la tarjeta). No hay que tocar la interfaz.
