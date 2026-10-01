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

**Solo un sitio estático. No hay backend ni servidor propio.**

- **Frontend**: sitio estático generado con **Vite** (HTML, CSS y JavaScript/TypeScript sin framework pesado), publicado en **GitHub Pages** con una GitHub Action, con el dominio propio **`mamata.live`** (`base` de Vite = `/`, archivo `public/CNAME`, HTTPS forzado).
  - Repo: `https://github.com/grunch/mamata` (público). Sitio: `https://mamata.live/`. El README explica los registros DNS (A/AAAA del apex hacia GitHub Pages, `www` como CNAME a `grunch.github.io`) y cómo verificar el dominio en GitHub.
  - Sin la clave, la app no muestra ningún contenido: solo una pantalla amable "Para ver tus cosas, pedile el link a tu familiar." (sin mencionar claves ni cifrado).
- **Datos del admin** (mensajes, recordatorios, gift cards, imágenes): viven **dentro del repo**, pero **cifrados**:
  - Un archivo `data/data.enc` con todo el contenido en JSON, cifrado con **AES-GCM 256** (Web Crypto API), y una imagen cifrada por archivo en `data/img/<id>.enc`.
  - La **clave** es aleatoria (256 bits) y **nunca** se guarda en el repo. Viaja solo en el fragmento del link de vinculación (`https://…/#k=<clave>`): el fragmento no se envía al servidor ni queda en los logs de GitHub.
  - El repo es público: el contenido cifrado (y todo su historial en git) es visible para cualquiera. Si la clave se filtra, se puede leer todo, incluso lo viejo. El README tiene que explicar esto y cómo rotar la clave.
- **Cómo publica el admin**: el panel `/admin` corre en el navegador del admin y:
  1. le pide una vez la **clave** y un **token de GitHub de alcance fino** (fine-grained PAT con permiso *Contents: read and write* solo sobre este repo), y los guarda en el `localStorage` de su navegador;
  2. descarga y descifra `data/data.enc`, deja editar, vuelve a cifrar y hace commit con la API REST de GitHub (`PUT /repos/{owner}/{repo}/contents/{path}`, usando el `sha` para detectar conflictos);
  3. el commit dispara la GitHub Action y en uno o dos minutos el usuario ve lo nuevo. El panel muestra "Publicado. El teléfono lo va a ver en unos minutos."
  - Sin clave y sin token, `/admin` no puede leer ni publicar nada, aunque sea una página pública. No hace falta contraseña aparte.
- **Datos del usuario** (leídos, hechos, saldos anotados): se guardan **solo en su teléfono** (IndexedDB). El admin **no** los ve. Nunca se borran por una actualización del contenido.
- **Vinculación del usuario**: el admin genera un **link de vinculación** con la clave (y código QR). El usuario lo abre una vez, la app guarda la clave y desde ahí no vuelve a pedir nada. Nunca pedirle contraseñas al usuario.
  - Instalar la PWA **después** de abrir el link, desde la misma app de Chrome, para que la app instalada tenga la clave.
- **Rotar la clave** desde `/admin`: genera una clave nueva, vuelve a cifrar todo, publica y muestra el link nuevo. El link viejo deja de servir para el contenido nuevo.
- **Sin notificaciones push**: un sitio estático no puede mandar avisos con la app cerrada. Los mensajes nuevos y los recordatorios del día se muestran **al abrir la app**. Dejá el código organizado para poder agregar push más adelante sin rehacer todo, pero no lo implementes.

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
- Primera vez: pide la clave (o permite generar una nueva si todavía no hay datos) y el token de GitHub. Explicar en una línea cómo crear el token, con link a la página de GitHub.
- Secciones:
  - **Mensajes**: crear, editar y archivar. Vista previa de cómo lo va a ver el usuario.
  - **Recordatorios**: crear, editar, pausar y borrar.
  - **Tarjetas de regalo**: alta, edición y baja; subir imagen (comprimir y redimensionar en el navegador antes de cifrar y subir); elegir proveedor; código de canje para armar la URL de consulta (o pegar directamente el link de la gift card virtual); monto inicial y vencimiento; cargar un saldo corregido.
  - **Vincular teléfono**: mostrar el link de vinculación y su código QR; rotar la clave.
- Todo lo que el admin borra pasa primero a una papelera recuperable (dentro del mismo JSON, con fecha de borrado). Además queda el historial de git.
- Los cambios se juntan y se publican con un botón **"Publicar cambios"** (un solo commit), mostrando si hay cambios sin publicar.
- Si el commit falla por conflicto (`sha` viejo), volver a descargar, avisar y no perder lo que el admin estaba editando.

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
  - *network-first* (con tiempo máximo) para `data/data.enc`: con internet siempre lo último, sin internet lo guardado. Se descartó *stale-while-revalidate* para este archivo porque, después de cambiar la clave, el link nuevo recibiría primero el archivo viejo y no podría abrirlo;
  - *stale-while-revalidate* para las imágenes (no cambian para un mismo id);
  - al volver a la app (`visibilitychange`) y cada pocos minutos mientras está abierta, revisar si hay contenido nuevo.
- Si no hay conexión, mostrar un aviso suave: "Sin internet. Te muestro la última información guardada."
- Si el contenido no se puede descifrar (clave vieja después de rotarla), mostrar: "Hay información nueva. Pedile a [nombre del admin] que te mande el link otra vez." Nunca borrar lo que ya estaba guardado.
- **Onboarding de una sola vez** al abrir el link de vinculación: pantalla grande de bienvenida y un banner o instrucciones simples para instalar la app en la pantalla de inicio.

## 7. Entregables

1. Proyecto Vite en la raíz del repo, con la app del usuario y `/admin` como dos entradas (multi-page) del mismo build.
2. GitHub Action para build y despliegue a GitHub Pages, que corre en cada push a `main` (incluidos los commits del admin).
3. Módulo de cifrado (Web Crypto, AES-GCM) compartido entre la app y el admin, con tests.
4. Datos de ejemplo (seed) para probar en local sin datos reales, más un script para cifrarlos con una clave de prueba.
5. README paso a paso, pensado para alguien que nunca usó GitHub Pages: crear el repo, activar Pages, crear el token de alcance fino, generar la clave en `/admin`, cargar el contenido, vincular el teléfono del usuario e instalar la app, y rotar la clave.
6. Una lista de verificación de accesibilidad y una de pruebas manuales en Android: vincular e instalar; modo sin conexión; ver contenido nuevo después de publicar desde `/admin`; abrir la página de saldo y volver con la X y con el botón atrás; que aparezca la pregunta "¿Cuánto te queda?"; que los saldos anotados sigan ahí después de una actualización.

## 8. Restricciones

- Mantener el proyecto simple y mantenible por una sola persona; no agregar dependencias innecesarias.
- Sin backend ni servicios externos propios: solo GitHub Pages y la API de GitHub desde el panel del admin.
- Ningún dato sensible sin cifrar en el repo (códigos de tarjetas, imágenes, mensajes, nombres). Nunca la clave ni el token en el repo, en logs ni en la consola.
- No usar servicios pagos.
- No hacer scraping ni consultas automáticas a los sitios de las gift cards.
- Antes de escribir código, presentá un plan breve con la estructura de archivos y el modelo de datos (mensajes, recordatorios, gift cards, proveedores, registros de saldo, papelera y el formato del archivo cifrado) y esperá confirmación.
