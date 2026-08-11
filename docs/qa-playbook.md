---
tags: [type/reference, domain/sync]
up: "[[00-index]]"
---

# QA playbook

Lo que **solo** se valida a mano en un navegador real. Los tests unitarios cubren la lógica pura del
sync (diff, mezcla, reparación, sellos) pero **ningún test ejerce el ciclo completo** contra Supabase:
no hay tests de integración ni de `initSync`. Ver [[testing]] para el reparto exacto.

Antes de nada, la comprobación automática:

```bash
npm test && npm run lint && npm run build
```

## Preparación

- `.env.local` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` → [[comandos-y-entorno]].
- `npm run dev` → http://localhost:5173 (puerto fijo, `strictPort`).
- Para probar dos "dispositivos" sin desplegar: dos **perfiles de navegador distintos** (o uno normal
  y uno de incógnito). Dos pestañas del mismo perfil **comparten IndexedDB**, así que sirven para
  probar el web lock pero **no** para probar dos dispositivos.
- DevTools → Application → IndexedDB → `finhub-finanzas` para inspeccionar `outbox` y `meta`.
- DevTools → Network → *Offline* para simular la caída de red.

## Casos críticos

### 1. Login y sesión → [[login]]

- Credenciales incorrectas → "Correo o contraseña incorrectos" (no distingue si el correo existe).
- Sin red al enviar → "Sin conexión. Inténtalo cuando vuelvas a tener red."
- Muchos intentos seguidos → "Demasiados intentos. Espera unos minutos."
- Entrar y recargar la página: no debe volver a pedir login.
- **Offline con sesión previa**: entra, pon el navegador offline, recarga. La app debe abrirse con los
  datos locales (el fallback a `meta.userId`), no mandarte al login.
- **Cerrar sesión con cola pendiente**: crea un movimiento offline y pulsa "Cerrar sesión" → debe
  pedir confirmación nombrando cuántos cambios hay sin sincronizar.

### 2. Escritura offline y vuelta de red → [[escritura-local]]

1. Offline. Crea, edita y borra movimientos.
2. El chip de la cabecera debe decir "N cambios pendientes" y el aside "Sin conexión".
3. Vuelve a online: sube solo, el chip pasa a "Sincronizado" y `outbox` queda vacío en DevTools.

### 3. Sync entre dos dispositivos → [[pull]]

- Crea un movimiento en el perfil A; en el perfil B, **cambia a otra pestaña y vuelve**
  (`visibilitychange` dispara el sync) → debe aparecer sin recargar.
- Si no cambias de pestaña, el sondeo lo trae en **≤ 60 s**.
- Con la pestaña en segundo plano el sondeo **no** corre: es intencionado, al volver ya sincroniza.

### 4. Vinculación de un dispositivo nuevo → [[first-sync]]

El flujo más delicado del proyecto. Dos escenarios distintos:

- **Servidor virgen** (primera vez de todas): entra y comprueba que suben las categorías por defecto y
  los movimientos que ya hubiera en local.
- **Segundo dispositivo**: entra en un perfil nuevo con el servidor ya poblado → debe quedarse con el
  árbol del servidor **sin duplicar categorías** y sin perder lo que solo existiera en local.
- Caso concreto que ya se rompió una vez: crea un movimiento **antes** de que el dispositivo se
  vincule; sus categorías deben subir **delante** en la cola o la FK rechaza el movimiento.

### 5. Conflictos y LWW → [[sync-model]]

- Renombra la **misma** categoría en A y en B mientras B está offline; al volver la red gana el sello
  más reciente, sin errores en consola.
- Renombra **dos subcategorías distintas** de la misma categoría en A y en B: **los dos cambios deben
  sobrevivir** (es la razón de que las subcategorías sean filas propias en Postgres).
- **Anti-resurrección**: B edita un movimiento offline, A lo borra y sincroniza, B vuelve a la red →
  el movimiento **no** debe reaparecer.

### 6. Borrar todo → [[borrado-total]]

- Pide **dos** confirmaciones.
- **Sin conexión debe fallar** con "Necesitas conexión para borrar todo" y no borrar nada.
- Con conexión: borra local y remoto, resiembra las categorías por defecto.
- En el otro dispositivo (con cambios encolados incluso): al sincronizar debe **tirar su cola** y
  quedarse vacío, no repoblar lo borrado.

### 7. Cambio de usuario en el mismo navegador → [[login]]

Cierra sesión y entra con otra cuenta: la caché del anterior **no** puede mezclarse (`adoptUser`
vacía la cola y `key={userId}` remonta el árbol entero).

### 8. UI, móvil y accesibilidad → [[ui-app]] · [[design-system]]

- Ancho ≤ 760 px: el aside desaparece y queda el nav inferior; el **chip de sync sigue visible** en la
  cabecera (es su razón de existir).
- Modal en móvil: al abrirlo el teclado **no** debe salir solo, y el fondo no debe hacer scroll.
- `Escape` y clic en el fondo cierran el modal.
- Navegación solo con teclado: un único indicador de foco visible en todos los controles.
- Con lector de pantalla, los avisos ("Movimiento añadido", "Sin conexión") se anuncian una sola vez.
- Un mes de febrero de 28 días debe mostrar **4** columnas de semana en la vista Semanal.

Related: [[testing]] · [[comandos-y-entorno]] · [[00-index]]
