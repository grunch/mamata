# Prompt: PWA informativa y de recordatorios para una persona mayor

Actuá como un desarrollador senior frontend con experiencia en PWAs, accesibilidad (WCAG 2.2 AA) y diseño para personas mayores. Construí el proyecto completo descrito abajo, listo para publicar. Escribí todo el código, la configuración y un README con los pasos de despliegue. Idioma de la interfaz: español rioplatense, simple y cálido.

## 1. Contexto y problema

- Hay dos tipos de usuario:
  - **Usuario**: persona de la tercera edad, poca experiencia con tecnología, usa un teléfono Android.
  - **Admin**: persona joven (familiar) que carga y mantiene la información.
- Hoy la información se le pasa por Google Keep, y el usuario **borra notas sin darse cuenta** y después no entiende qué pasó.
- Requisito central: **el usuario no puede borrar, editar ni perder nada de lo que carga el admin**. Ese contenido es de solo lectura para él.
  - Únicas acciones que el usuario puede hacer: marcar mensajes como leídos, marcar recordatorios como hechos y **anotar cuánto le queda en una gift card**. Las tres solo agregan información en su propio teléfono; nunca borran ni modifican lo que cargó el admin.

## 2. Arquitectura (obligatoria)

**Sitio estático + Nostr. No hay backend ni servidor propio.**

- **Frontend**: sitio estático generado con **Vite** (HTML, CSS y TypeScript sin framework pesado), publicado en **GitHub Pages** con una GitHub Action en cada push a `main`, con el dominio propio **`mamata.live`** (`base` de Vite = `/`, `public/CNAME`, HTTPS forzado). Repo: `https://github.com/grunch/mamata` (público); `main` protegida (solo PRs). GitHub Pages sirve **solo el código**: el contenido no pasa por GitHub.
- **Contenido por Nostr, en tiempo real.** Relays: `wss://relay.mostro.network`, `wss://relay.shadowbip.com`, `wss://nos.lol` (probados: aceptan los kinds 36000–36012).
- **Claves**:
  - **Admin**: firma todo lo que se publica. En el panel se usa pegando la nsec (guardada solo en ese navegador) **o** con una extensión NIP-07 (nos2x u otras) que soporte `nip44`.
  - **Teléfono**: la app genera su propio par de claves al abrirse por primera vez y lo guarda en IndexedDB. Nunca sale del teléfono. Se puede ver en ⚙️ Ajustes (npub siempre; nsec solo detrás de un aviso).
  - **Clave de contenido** (32 bytes aleatorios): la genera el panel. Cifra todos los ítems e imágenes. Viaja cifrada con NIP-44 a cada teléfono aprobado y a la propia pubkey del admin (para abrir el panel en otro navegador).
- **Link y QR de vinculación**: `https://mamata.live/#npub=npub1…` (la npub del admin). **No contiene ningún secreto.**
- **Eventos** (kinds libres en el registro de NIPs; todos firmados por el admin salvo el 36010):

  | kind | qué | `d` | contenido |
  |---|---|---|---|
  | 36000 | mensaje | id | NIP-44 v2 con la clave de contenido |
  | 36001 | recordatorio | id | ídem |
  | 36002 | gift card | id | ídem |
  | 36003 | perfil (nombres) | `perfil` | ídem |
  | 36010 | pedido de vinculación (firma el **teléfono**, `p` = admin) | `vincular` | vacío (la pubkey es el autor) |
  | 36011 | clave de contenido para un teléfono (`p` = teléfono) | npub del teléfono | NIP-44 admin → teléfono |
  | 36012 | copia de la clave de contenido para el admin (`p` = admin) | `admin` | NIP-44 admin → admin |

  - Cada ítem es su propio evento reemplazable: editar = publicar una versión nueva con el mismo `d`.
  - Borrar, archivar o pausar = nueva versión con un campo de estado (papelera recuperable). Nunca se depende de que un relay borre.
- **Vinculación**: el teléfono abre el link, genera sus claves, publica un 36010 y muestra un **código de 4 dígitos** derivado de su pubkey. El panel muestra el pedido con el mismo código; el admin lo compara y toca **Aprobar** (publica el 36011). **Quitar acceso** a un teléfono = nueva clave de contenido, volver a cifrar y publicar todo, y mandar 36011 solo a los teléfonos que quedan.
- **Imágenes**: comprimidas en el navegador, cifradas con AES-GCM (clave derivada de la clave de contenido) y subidas a **Blossom** (`nostr.download`, `blossom.yakihonne.com`; aceptan archivos cifrados) con una autorización kind 24242 firmada por el admin. La app las baja por SHA-256 y verifica el hash antes de descifrar.
- **Datos del usuario** (leídos, hechos, saldos anotados): solo en su teléfono (IndexedDB). El admin no los ve.
- **Sin notificaciones push** con la app cerrada. Con la app abierta, lo nuevo aparece en segundos (suscripción en vivo).

## 3. App del usuario (vista principal)

### Pantalla de inicio
- Saludo con el nombre del usuario y la fecha de hoy escrita completa ("Jueves 1 de octubre").
- Como máximo 3 o 4 botones grandes con ícono y texto: **Mensajes**, **Recordatorios**, **Tarjetas de regalo**.
- Si hay un mensaje nuevo sin leer, se muestra arriba de todo, destacado.
- Si hay recordatorios para hoy, se muestran debajo, con la hora en letra grande.

### Mensajes llamativos del admin
- El admin puede enviar mensajes con: título, texto, color o estilo destacado (por ejemplo: aviso importante, buena noticia, recordatorio urgente), imagen opcional y emoji opcional.
- Los mensajes nuevos se muestran en tarjetas grandes y coloridas. El usuario puede tocar **"Entendido"** para marcarlo como leído (esto solo cambia el estado de "leído" en su teléfono, nunca lo borra).
- Los mensajes viejos quedan en un historial simple, ordenado del más nuevo al más viejo.
- Botón **"Leer en voz alta"** en cada mensaje (Web Speech API, voz en español).

### Recordatorios
- El admin crea recordatorios con: título, descripción, fecha y hora, repetición (una vez, diario, semanal, mensual) e ícono.
- En la app se ven agrupados en **"Hoy"**, **"Próximos"** y **"Pasados"**, con la hora en letra grande. Las repeticiones se calculan en el teléfono.
- El usuario puede tocar **"Ya lo hice"**; eso solo lo marca como cumplido en su teléfono (para esa ocurrencia, si se repite).
- No hay aviso a la hora indicada (ver sección 2).

### Tarjetas de regalo (gift cards)

**Decisión tomada:** la app **no consulta saldos automáticamente**. Se investigó oh! Gift Card (el emisor de las tarjetas que usa el usuario, canjeables en Día, Carrefour y otras marcas): no tiene API pública para particulares (la API es solo para empresas y comercios con credenciales), y la página de consulta carga el saldo con JavaScript y tiene verificación de seguridad. En lugar de eso, el usuario ve el saldo en la página oficial y la app le pide que **anote cuánto le queda**.

- Proveedores como configuración extensible: un registro con nombre, logo, color y plantilla de URL de consulta de saldo (por ejemplo, oh! Gift Card: `https://tienda.ohgiftcard.com.ar/redeem?redeemCode={codigo}`). Agregar un proveedor no requiere tocar la interfaz.
- Cada tarjeta muestra:
  - la **imagen de la tarjeta** que subió el admin, en grande;
  - las marcas donde se puede usar (por ejemplo, logos de Día y Carrefour);
  - el **último saldo anotado** en letra grande, con la fecha ("Anotado hoy a las 10:30"). Si nunca se anotó, el monto inicial cargado por el admin;
  - la fecha de vencimiento, destacada si faltan menos de 30 días;
  - un botón grande **"Ver saldo"**.

#### Flujo "Ver saldo"
1. Al tocar **"Ver saldo"**, la app primero muestra una pantalla de explicación, grande y simple:
   - "Te voy a mostrar la página de la tarjeta.";
   - "Para volver acá, tocá la **X** de arriba a la izquierda, o el botón **atrás** de tu teléfono.";
   - una imagen o dibujo que señala dónde está la X;
   - botones **"Ver mi saldo"** y **"Volver al inicio"**.
   - Casilla opcional "No mostrar más esta explicación".
2. Al tocar **"Ver mi saldo"**, la app abre la URL de consulta de esa tarjeta **sin salir de la app**:
   - **Restricción técnica verificada**: la página de oh! Gift Card envía `X-Frame-Options: SAMEORIGIN`, así que **no se puede mostrar dentro de un iframe**. No intentes saltear esa restricción con un proxy.
   - Con la PWA instalada en Android, al abrir un link fuera del `scope` Chrome lo muestra en una pestaña superpuesta, con una **X para cerrar** que vuelve a la app (el botón atrás del sistema hace lo mismo). El usuario nunca ve la pantalla de inicio del teléfono ni otra app.
   - Verificá en un dispositivo real qué forma de abrir el link (`location.href` o `window.open`/`target="_blank"`) da la experiencia más clara en Chrome para Android con la PWA instalada, y documentalo.
   - Si la app **no** está instalada (pestaña común de Chrome), abrila en una pestaña nueva, para que la app siga abierta en la pestaña original.
3. **Al volver a la app** (detectarlo con `visibilitychange`/`pageshow`, guardando antes en `sessionStorage` qué tarjeta se abrió), mostrar una pantalla grande con la pregunta:
   - **"¿Cuánto te queda en esta gift card?"**
   - un campo numérico grande (`inputmode="decimal"`), con el signo `$` fijo y el último saldo anotado como referencia ("La última vez anotaste $ 150.000");
   - botones **"Guardar"** y **"Ahora no"**.
   - Al guardar: "¡Listo! Anotaste que te quedan $ 120.000." Y se vuelve a la tarjeta.
   - Validación amable: si el número es mayor que el último anotado o que el monto inicial, preguntar "¿Seguro? Antes tenías $ X." con **"Sí, es correcto"** y **"Corregir"**. Nunca bloquear al usuario.
   - "Ahora no" no anota nada y no vuelve a preguntar hasta la próxima vez que abra la página de esa tarjeta.
4. Cada saldo anotado se guarda en el teléfono como un **registro nuevo** (monto, fecha y hora). Nunca se pisa ni se borra el anterior: así queda un **historial de gasto** de la tarjeta.
- En la tarjeta, un link secundario **"Ver lo que fui anotando"** muestra el historial simple: fecha, saldo y cuánto se gastó entre un registro y el siguiente.
- Si el admin carga un saldo corregido para esa tarjeta, se muestra como un registro más del historial, con su fecha; vale el más reciente.

## 4. Panel del admin (`/admin`)

- Diseño práctico, pensado para el celular del admin.
- Primera vez: elegir cómo firmar: pegar la nsec del admin o usar una extensión NIP-07. Si no hay clave de contenido publicada (kind 36012), se genera una.
- Secciones:
  - **Mensajes**: crear, editar y archivar. Vista previa de cómo lo va a ver el usuario.
  - **Recordatorios**: crear, editar, pausar y borrar.
  - **Tarjetas de regalo**: alta, edición y baja; subir imagen (comprimir y redimensionar en el navegador antes de cifrar y subir); elegir proveedor; código de canje para armar la URL de consulta (o pegar directamente el link de la gift card virtual); monto inicial y vencimiento; cargar un saldo corregido.
  - **Vincular teléfono**: link y QR con la npub del admin; pedidos pendientes con su código de 4 dígitos (Aprobar / Rechazar); teléfonos aprobados con "Quitar acceso"; estado de los relays.
- Todo lo que el admin borra pasa primero a una papelera recuperable (el evento queda con estado "en la papelera").
- Cada cambio se publica al guardar (un evento por ítem), mostrando en cuántos relays quedó. Menos de 2 relays = error visible.
- Antes de reemplazar un ítem, si en los relays hay una versión más nueva que la que se estaba editando, avisar y no pisarla sin confirmar.

## 5. Accesibilidad y diseño para persona mayor

- Texto base de al menos 20px; títulos de 28px o más. Respetar el tamaño de letra del sistema.
- Contraste alto (mínimo AA, idealmente AAA), fondo claro y sin texto sobre imágenes.
- Botones de al menos 64px de alto, separados entre sí, siempre con ícono y texto (nunca solo ícono).
- Sin gestos ocultos: nada de deslizar para borrar, mantener apretado, menús hamburguesa ni pantallas que dependan de swipe.
- Navegación plana: máximo un nivel de profundidad y un botón grande **"Volver al inicio"** siempre visible.
- Lenguaje simple, frases cortas, sin tecnicismos (no decir "sincronizar", "error 500", "caché").
- Confirmaciones claras y visibles después de cada acción ("¡Listo! Lo marcaste como hecho").
- Sin animaciones bruscas; respetar `prefers-reduced-motion`.
- Etiquetas ARIA correctas y orden de foco lógico para lectores de pantalla.

## 6. PWA y modo sin conexión

- `manifest.json` completo (nombre, íconos 192 y 512, maskable, `display: standalone`, colores) y `scope` y `start_url` = `/` (dominio `mamata.live`).
- Service worker con:
  - caché de la app (shell) para que abra sin internet;
  - caché permanente para las imágenes de Blossom (se piden por SHA-256: nunca cambian).
- Contenido: suscripción en vivo a los relays mientras la app está a la vista; al pasar a segundo plano se cierra y al volver se reabre. Lo último bueno de cada ítem queda en IndexedDB y **nunca se reemplaza por una versión más vieja** (`created_at`).
- Si no hay conexión, mostrar un aviso suave: "Sin internet. Te muestro la última información guardada."
- Si el teléfono todavía no fue aprobado (o se le quitó el acceso), mostrar en grande el código de 4 dígitos y "Esperando que [nombre del admin] te habilite". Nunca borrar lo que ya estaba guardado.
- **Onboarding de una sola vez** al abrir el link de vinculación: pantalla grande de bienvenida y un banner o instrucciones simples para instalar la app en la pantalla de inicio.

## 7. Entregables

1. Proyecto Vite en la raíz del repo, con la app del usuario y `/admin` como dos entradas (multi-page) del mismo build.
2. GitHub Action para build y despliegue a GitHub Pages en cada push a `main`.
3. Módulos compartidos de Nostr (kinds, eventos, cifrado NIP-44 con la clave de contenido, código de vinculación) y Blossom, con tests.
4. Datos de ejemplo para probar en local contra relays simulados.
5. README paso a paso: activar Pages y el dominio, entrar al panel con la nsec o la extensión, cargar contenido, vincular y aprobar el teléfono, quitar acceso.
6. Una lista de verificación de accesibilidad y una de pruebas manuales en Android: vincular e instalar; modo sin conexión; ver contenido nuevo después de publicar desde `/admin`; abrir la página de saldo y volver con la X y con el botón atrás; que aparezca la pregunta "¿Cuánto te queda?"; que los saldos anotados sigan ahí después de una actualización.

## 8. Restricciones

- Mantener el proyecto simple y mantenible por una sola persona; no agregar dependencias innecesarias.
- Sin backend propio: GitHub Pages (código), relays Nostr y servidores Blossom.
- Ningún dato sensible sin cifrar en relays, en Blossom ni en el repo (códigos de tarjetas, imágenes, mensajes, nombres). Nunca una nsec ni la clave de contenido en el repo, en logs ni en la consola.
- No usar servicios pagos.
- No hacer scraping ni consultas automáticas a los sitios de las gift cards.
- Antes de escribir código, presentá un plan breve con la estructura de archivos y el modelo de datos (mensajes, recordatorios, gift cards, proveedores, registros de saldo, papelera y el formato del archivo cifrado) y esperá confirmación.
