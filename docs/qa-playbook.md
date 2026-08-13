---
tags: [type/reference, domain/sync]
up: "[[00-index]]"
---

# QA playbook

Lo que **solo** se valida a mano en un navegador real. Los tests cubren la lógica pura del sync **y** el
motor (push, vinculación, wipe) contra un **cliente de Supabase mockeado**; lo que ningún test ejerce es
el **Postgres de verdad** —FK, RLS, triggers LWW y de lápidas— ni `initSync` con sus disparadores del
navegador. Ver [[testing]] para el reparto exacto.

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

### 9. Post-deploy en un móvil real → [[deploy-vercel]]

> ⚠️ **Pendiente de verificar.** El deploy está hecho y comprobado a nivel de servidor (la pantalla de
> login renderiza, las variables van dentro del bundle, el manifest y los iconos se sirven), pero **esto
> todavía no se ha ejercido en un dispositivo real**. Hasta que se haga, el objetivo de la fase 6 —usar la
> app desde el móvil— está verificado solo a medias.

A diferencia del resto del playbook, esto **no se hace en `localhost`** sino contra producción, y **no se
puede sustituir por DevTools**: el *Offline* del navegador simula la red, no un móvil que se queda sin
cobertura, se suspende y vuelve horas después con el access token caducado.

1. **Instalar**: abrir el dominio en el móvil → *Añadir a pantalla de inicio* → comprobar que sale el
   icono correcto y que **abre sin barra de navegador** (`display: standalone`).
2. **Login** en el móvil y crear un movimiento.
3. **Comprobar el viaje completo**: ese movimiento debe aparecer en el portátil al cambiar de pestaña y
   volver, o en ≤ 60 s por el sondeo. → [[pull]]
4. **Modo avión** (el caso que de verdad valida el diseño local-first): con la sesión ya establecida, la
   app debe seguir **usable**, dejar crear movimientos y el chip avisar de lo pendiente. → [[escritura-local]]
5. **Volver la red**: la cola debe subir sola y el movimiento aparecer en el portátil.
6. **El caso de la sesión caducada**: dejar la app cerrada **más de una hora** (el access token dura 1 h) y
   abrirla **sin red**. Debe entrar con los datos locales por el fallback a `meta.userId`, **no** mandarte
   al login. Es la limitación asumida más fácil de romper sin darse cuenta. → [[supabase-auth]]

Si algo falla aquí, el sospechoso **no es el deploy** sino el motor de sync: empezar por [[sync-model]].

### 10. Patrimonio: el ritual, el descuadre y la vinculación → [[patrimonio]]

Dos tablas nuevas con clave ajena compuesta, checks, trigger LWW y un **id determinista**, más una
columna `account_id` en `movements`. Nada de eso lo ejerce un test: el cliente de Supabase está mockeado,
así que las FK y los checks solo existen de verdad aquí. Y el descuadre necesita **saldos y movimientos del
mismo mes**, que es justo la combinación que ningún fixture da hecha.

#### Preparación de los datos

Aquí se pierde la mitad del tiempo, así que conviene saberlo antes:

- Hacen falta **tres cuentas** que cubran los tres comportamientos: una **corriente** (activo, líquida),
  un **broker** (activo, de inversión, no líquida) y una **hipoteca** (pasivo, no líquida). Con menos no se
  puede ver ni el disponible ni el reparto ahorro/rentabilidad.
- Hacen falta **dos meses consecutivos cerrados**. Con uno solo, el Δ y el descuadre salen "—" y no un 0,
  que es correcto pero no prueba nada.
- Y hacen falta **movimientos en el mes que se pruebe**. Es el olvido más fácil: con cierres pero sin
  movimientos el descuadre sale igual al ahorro real entero, que parece un fallo y no lo es.
- El usuario de pruebas se crea desde Studio → Authentication → Add user, y **si el login local devuelve
  `422 email_provider_disabled` el problema no es la contraseña**: es `[auth.email].enable_signup`, que
  apaga el proveedor de email entero → [[comandos-y-entorno]]

Para el ejemplo del diseño (el que sostiene los tests), los números son: corriente 10.000 → 9.500, broker
5.000 → 6.200 con 1.000 aportados, hipoteca 100.000 → 99.700; y en el mes de destino, 2.000 de ingresos y
1.500 de gastos. Δ +1.000 = 800 de ahorro + 200 de mercado, y **+300 sin clasificar** → [[calculations]]

#### El ritual mensual

1. **Un campo vacío no se guarda.** Deja una cuenta sin tocar y guarda → esa cuenta debe quedar como *Sin
   revisar*, **no** con un saldo de 0. Compruébalo en `closings` de IndexedDB: no debe existir su fila.
2. **La pista en gris no se guarda tampoco.** El `placeholder` es el último saldo conocido; guardar sin
   escribir nada encima no debe meter ese número en la serie.
3. **Un saldo negativo se rechaza en el cliente**, con el aviso de que el signo lo pone la cuenta. Si
   llegara a Postgres, el check `balance >= 0` lo tumbaría y el push **descartaría la op en silencio**: por
   eso la validación está antes.
4. **Un aportado o una nota sin saldo también se rechazan**, por lo mismo: la fila se omitiría y ese dato
   se perdería sin avisar.
5. **Vaciar una fila con cierre guardado emite un upsert con `balance: null`, nunca un `delete`.** Míralo
   en el `outbox`: si ves un `delete`, se ha roto la decisión que permite a este dominio vivir **sin
   lápidas** → [[009-la-foto-manda-cierre-mensual]]
6. **Editar un mes pasado funciona y recalcula lo demás solo.** La flecha *›* debe estar **desactivada** en
   el mes en curso: un cierre futuro no significa nada.
7. **Cambiar de mes tira lo tecleado.** Escribe un saldo, cambia de mes sin guardar y vuelve: el campo debe
   estar vacío. Si se arrastrara, lo de marzo acabaría guardado en abril.

#### El Δ, la serie y el descuadre

1. **El Δ compara contra el mes anterior, no contra el último disponible.** Deja un hueco (cierra enero y
   marzo, no febrero) y mira marzo: debe salir "—", no un Δ contra enero que llamaría rentabilidad a dos
   meses de ahorro.
2. **La línea del gráfico se corta en el hueco**, no lo interpola. Y el nivel va **en gris**; solo el Δ usa
   verde y rojo → [[design-system]]
3. **Badge de mes incompleto** cuando una cuenta tiene cierre en uno de los dos meses y no en el otro.
   Archivar una cuenta **no** debe dejar el badge puesto para siempre.
4. **El sin clasificar va en gris**, con el préstamo dando +300 todos los meses. Teclea 300 en *Principal
   amortizado* de la hipoteca → debe pasar a **0**. Es la comprobación que valida la interpretación entera.
5. **No hay forma de "cuadrarlo" desde la UI**, y no debe haberla: si aparece un botón que genere un
   movimiento de ajuste, es un bug de diseño → [[patrimonio]] §7
6. **El aviso de meses sin cerrar lleva al más antiguo pendiente**, y al pulsarlo la subvista de cierre
   debe abrirse **ya en ese mes**. No debe aparecer por el mes en curso.

#### La vinculación y el desglose

1. **"Sin cuenta" es la opción por defecto** y los movimientos viejos siguen sin cuenta. El select solo
   aparece si hay cuentas creadas.
2. **La trampa de la cadena vacía**: guarda un movimiento con "Sin cuenta" y mira el payload en el
   `outbox` → `account_id` debe ser **`null`**, jamás `''`. Con `''`, Postgres lo rechaza y el push lo trata
   como irrecuperable: **el movimiento se pierde para siempre**. Es el mismo patrón que `subcategoryId`
   → [[sync]]
3. **Editar un movimiento cuya cuenta está archivada no le cambia la cuenta.** El select tiene que seguir
   mostrando esa cuenta aunque esté archivada.
4. **Los agregados no se mueven ni un céntimo.** Apunta ingresos, gastos, ahorro y el donut **antes** de
   vincular nada, vincula media docena de movimientos y compáralos: idénticos. Es el objetivo 4 y se cumple
   por construcción, pero es lo que hay que mirar si algo se rompe.
5. **El desglose por cuenta suma la cifra de arriba.** Sumas las filas a mano, incluida la de *Sin cuenta*,
   y tiene que dar el sin clasificar exacto. Si no cuadra, el desglose miente → [[calculations]]
6. **Un traspaso vinculado en las dos puntas** (gasto en la corriente, ingreso en el broker por el mismo
   importe) sale **negativo en una y positivo en la otra**, y el total no se entera. Es ruido conocido, no
   un fallo: los traspasos no se modelan a propósito → [[patrimonio]] §9

#### Lo que solo rompe contra el Postgres de verdad

1. **La FK de los cierres**: crea un cierre, borra su cuenta a mano desde Studio y sincroniza. El cliente
   nunca borra cuentas, así que esto es una simulación deliberada de corrupción — lo que se comprueba es
   que un `23503` no atasca la cola para siempre.
2. **La FK de los movimientos**: lo mismo con `account_id`. Al bajar, el movimiento debe **conservarse con
   la cuenta limpiada**, no desaparecer → `repairDanglingRefs` en [[sync]]
3. **El id determinista converge**: en A y en B (perfiles distintos, recuerda que **dos pestañas del mismo
   perfil comparten IndexedDB** y no valen), cierra **la misma cuenta y el mismo mes** con saldos distintos
   → debe quedar **una sola fila** y ganar el sello más nuevo, sin duplicados.
4. **El grano del conflicto es la cuenta, no el mes**: en A cierra el broker y en B la corriente, **del
   mismo mes** → **los dos cierres deben sobrevivir**. Es la razón de que el grano sea `(cuenta, mes)`
   → [[007-subcategorias-normalizadas-en-servidor]]
5. **"Borrar todo" barre también cuentas y cierres**, y **sin resembrar** (este dominio no tiene datos por
   defecto, a diferencia de las categorías). En el otro dispositivo, al sincronizar, el patrimonio debe
   quedarse vacío y no repoblarse → [[borrado-total]]

Related: [[testing]] · [[comandos-y-entorno]] · [[deploy-vercel]] · [[patrimonio]] · [[00-index]]
