# Listas de verificación

## Accesibilidad (WCAG 2.2 AA, pensado para una persona mayor)

- [ ] El texto base se ve de al menos 20px y los títulos de 28px o más.
- [ ] Con la letra del sistema en "Grande" (Android → Ajustes → Pantalla → Tamaño de fuente), todo crece y nada se corta.
- [ ] El contraste es alto en todas las pantallas (revisar con Lighthouse o axe), sin texto sobre imágenes.
- [ ] Todos los botones miden al menos 64px de alto, están separados y tienen ícono **y** texto.
- [ ] No hay gestos ocultos: nada de deslizar, mantener apretado ni menús hamburguesa.
- [ ] "Volver al inicio" está siempre visible abajo, en todas las pantallas menos el inicio.
- [ ] La navegación tiene un solo nivel: desde el inicio se llega a todo en uno o dos toques.
- [ ] No aparecen palabras técnicas ("error", "sincronizar", "caché", "clave", "servidor").
- [ ] Después de cada acción aparece una confirmación visible ("¡Listo! …").
- [ ] Con *Quitar animaciones* activado (Android → Accesibilidad), no hay movimientos.
- [ ] Con TalkBack: cada pantalla anuncia su título al entrar, los íconos no se leen y el orden de lectura es lógico.
- [ ] TalkBack lee el aviso "¡Listo! …" sin mover el foco.
- [ ] En "¿Cuánto te queda?", el campo tiene etiqueta y el error se anuncia.

## Pruebas manuales en Android (Chrome)

### Vincular e instalar
- [ ] Abrir `https://mamata.live/` sin link: dice "Para ver tus cosas, pedile el link a tu familiar."
- [ ] Abrir el link de vinculación (o escanear el QR): el teléfono muestra "Esperando que tu familiar te habilite" y un código de 4 números; la npub ya no se ve en la barra de direcciones.
- [ ] En el panel aparece "Teléfono · código XXXX" con el mismo código. Aprobar: en segundos el teléfono muestra la bienvenida.
- [ ] Instalar desde la bienvenida o con ⋮ → "Agregar a la pantalla de inicio". El ícono aparece y la app abre a pantalla completa.
- [ ] Cerrar la app del todo y volver a abrirla desde el ícono: entra directo al inicio, sin pedir nada.
- [ ] ⚙️ Ajustes muestra el mismo código, la npub del teléfono y la clave privada solo después del aviso.

### Contenido
- [ ] Publicar un mensaje desde el panel con la app abierta: aparece destacado arriba en segundos, sin tocar nada.
- [ ] "Entendido" lo marca como leído y no lo borra: sigue en "Mensajes anteriores".
- [ ] "Leer en voz alta" lo lee con voz en español (prueba: un mensaje que diga "hola" no tiene que sonar en inglés).
- [ ] Si el botón "Leer en voz alta" no aparece, el teléfono no tiene voz en español: Ajustes → Sistema → Idiomas → Salida de texto a voz → motor de Google → Instalar datos de voz → Español. Después reabrir la app.
- [ ] Un recordatorio de hoy aparece en el inicio y en "Hoy". "Ya lo hice" lo marca y sigue visible.
- [ ] Un recordatorio semanal aparece en "Próximos" con su próxima fecha.

### Sin conexión
- [ ] Con modo avión activado, la app abre y muestra lo último guardado con el aviso "Sin internet…".
- [ ] Al volver la conexión, el aviso desaparece.

### Gift cards
- [ ] La tarjeta muestra foto, saldo, fecha de vencimiento y dónde se puede usar.
- [ ] "Ver saldo" muestra primero la explicación de la X.
- [ ] "Ver mi saldo" abre la página de oh! **encima** de la app (pestaña de Chrome con una X arriba a la izquierda).
- [ ] Tocar la **X**: vuelve a la app y aparece "¿Cuánto te queda en esta gift card?".
- [ ] Repetir volviendo con el **botón atrás** del teléfono: pasa lo mismo.
- [ ] Anotar un monto: aparece "¡Listo! Anotaste que te quedan $ …" y la tarjeta muestra ese saldo.
- [ ] Anotar un monto mayor al anterior: pregunta "¿Seguro?" y permite corregir.
- [ ] "Ahora no" vuelve a la tarjeta sin anotar nada.
- [ ] "Ver lo que fui anotando" muestra el historial y cuánto se gastó.
- [ ] Probar con la app **sin instalar** (pestaña común de Chrome): "Ver mi saldo" abre otra pestaña y al volver a la de la app aparece la pregunta.
- [ ] Anotar un saldo sin internet: queda guardado en el teléfono y sigue ahí al reabrir la app.
- [ ] Documentar acá qué se vio en el teléfono real (forma de la X, si el botón atrás vuelve bien):
  - Modelo / versión de Android / versión de Chrome: …
  - Resultado: …

### Quitar acceso
- [ ] Con dos teléfonos aprobados, "Quitar acceso" a uno: ese vuelve a "Esperando que tu familiar te habilite"; el otro sigue viendo todo (incluidas las fotos).
- [ ] Borrar los datos del navegador en el teléfono: genera un código nuevo y aparece como pedido nuevo en el panel.
