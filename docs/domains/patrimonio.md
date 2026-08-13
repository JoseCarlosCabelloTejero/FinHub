---
tags: [type/domain, domain/patrimonio, area/cliente]
up: "[[00-index]]"
---

# Dominio: patrimonio

> **Implementado por completo** en cinco fases: cuentas y cierres mensuales, patrimonio neto y
> disponible, Δ mensual con el reparto ahorro/rentabilidad y su gráfico, el "sin clasificar" con su
> aviso, y la vinculación de movimientos a una cuenta. Las decisiones grandes están extraídas en
> [[009-la-foto-manda-cierre-mensual]].

La app registraba **flujos**: gastos e ingresos con sus categorías, porcentajes y gráficos. No sabía
**cuánto dinero existe** ni dónde está. Este dominio añade la dimensión que faltaba: **saldo**.

**Fuente de verdad**: el código. El esquema y el sync en `supabase/migrations/*_patrimonio.sql`,
`src/db.ts` y `src/sync.ts` → [[postgres-schema]] · [[indexeddb-stores]] · [[sync]]; los cálculos en
`src/calculations.ts` → [[calculations]]; la pantalla en `src/Patrimonio.tsx` → [[ui-app]]. Este documento
manda solo en lo que aún no existe.

## 1. Contexto

Este módulo añade la dimensión de **saldo**: cuánto hay en cada cuenta bancaria y en el broker, cómo
evoluciona el patrimonio en el tiempo, y qué parte de esa evolución viene del ahorro y qué parte del
mercado.

**Restricción de partida:** toda la entrada de datos es **manual**. No hay integración bancaria ni API de
broker. El diseño se optimiza para que el mantenimiento mensual cueste menos de dos minutos.

Esa restricción no es un detalle de implementación, es **la que decide el modelo entero**. Un diseño que
exija registrar el 100 % de los movimientos para que el saldo sea correcto no se mantiene tres meses. De
ahí la decisión de la sección 3.

## 2. Objetivos

1. Saber el patrimonio neto actual ✅ y su evolución mensual ✅.
2. Saber cuánto dinero es disponible mañana sin vender nada ✅.
3. Separar el **ahorro** de la **rentabilidad** en la variación del patrimonio ✅.
4. Vincular los movimientos existentes a una cuenta, sin romper los agregados actuales ✅.

### No objetivos

- Posiciones individuales del broker (tickers, cantidades, precios de entrada). El broker se trata como
  **caja negra**: un valor y un aportado.
- Importación de CSV, agregación bancaria PSD2, sincronización automática.
- Granularidad diaria.
- Rentabilidad ponderada por tiempo (XIRR). Se evalúa más adelante.

## 3. La decisión de partida: la foto manda

Hay dos formas de saber el saldo de una cuenta, y son incompatibles:

| Enfoque | Cómo funciona | Por qué se descarta / se elige |
|---|---|---|
| **Derivado** | Saldo inicial + suma de todos los movimientos. | Cuadra siempre **por construcción**, y por eso miente: si olvidas un gasto, el saldo queda mal **para siempre** y nada te avisa. Exige registrar el 100 %. Incompatible con los dos minutos. |
| **Foto mensual** ✅ | Cada mes escribes el saldo real de cada cuenta. | Nunca se desalinea de la realidad, porque la realidad es el dato de entrada. Los movimientos **explican** el cambio, no lo definen. |

**Se elige la foto.** La consecuencia importante es que las dos fuentes —saldos y movimientos— pueden no
coincidir, y esa diferencia deja de ser un problema para convertirse en la funcionalidad más valiosa del
módulo. Ver la sección 6.

## 4. El modelo

```mermaid
erDiagram
    CUENTA ||--o{ CIERRE : "como mucho uno por mes"
    CUENTA ||--o{ MOVIMIENTO : "referencia opcional"

    CUENTA {
        string nombre
        enum   naturaleza "activo o pasivo"
        bool   esInversion
        bool   esLiquida
        bool   archivada
    }
    CIERRE {
        string mes "YYYY-MM"
        number saldo "siempre positivo"
        number aportado
        string nota
    }
    MOVIMIENTO {
        string cuentaId "opcional"
    }
```

### Cuenta

Un contenedor de dinero. Lo que hay que entender no es la lista de campos, sino **qué decide cada uno**:

| Atributo | Qué decide | Ejemplos |
|---|---|---|
| **Naturaleza** (activo / pasivo) | El signo con el que entra en el patrimonio. **Nunca lo teclea la persona.** | Corriente y broker son activos; hipoteca y tarjeta son pasivos. |
| **Es de inversión** | Si su valor puede moverse *sin que tú metas dinero*. Solo a estas se les pregunta el aportado. | Broker sí; cuenta de ahorro no. |
| **Es líquida** | Si cuenta para el *"disponible mañana"*. Aplica a activos **y** a pasivos. | Corriente sí, tarjeta sí (resta), broker no, hipoteca no. |
| **Archivada** | Las cuentas **se archivan, nunca se borran**, porque los cierres históricos las referencian. | Mismo patrón y misma razón que las categorías → [[005-categorias-se-archivan]] |

El invariante central está tomado prestado de [[movimientos]], donde ya lleva tiempo funcionando: **el
importe nunca es negativo; el signo lo da el tipo**. Aquí el signo lo da la naturaleza de la cuenta. Se
teclea *"debo 84.300"* en positivo y la app lo resta. Esto elimina de raíz el error de entrada manual más
probable —un pasivo tecleado en negativo que dispara el patrimonio— sin necesidad de validación alguna.

Fíjate en que **"es líquida" hace dos trabajos con un solo interruptor**: suma la corriente y resta la
tarjeta, ignorando el broker y la hipoteca. No hace falta un segundo atributo de "exigible a corto plazo".

### Cierre

El valor de **una cuenta** en **un mes**. El grano es la pareja `(cuenta, mes)`, con el mes en formato
`YYYY-MM`. No hay granularidad diaria, y eso es un no objetivo, no una limitación pendiente.

- **Saldo** — siempre positivo. El signo ya lo puso la cuenta.
- **Aportado** — dinero *propio* que entró en esa cuenta ese mes. Solo se pregunta en cuentas de
  inversión, porque en el resto es deducible de los movimientos. Es el único dato que permite separar
  ahorro de rentabilidad, y es un número al mes.
- **Nota** — opcional, para acordarte de por qué ese mes fue raro.

> ⚠️ **"Snapshot" no se puede usar como nombre.** En este proyecto ya significa *"el estado completo del
> servidor"* → [[glossary]]. De ahí **cierre**.

## 5. Las cifras derivadas

Todo lo que ve la persona se calcula desde los cierres. Nada se guarda calculado.

```mermaid
flowchart TB
    C["Cierres del mes<br/>un saldo por cuenta"]
    A["Σ activos"]
    P["Σ pasivos"]
    N["Patrimonio neto<br/>activos − pasivos"]
    D["Disponible mañana<br/>solo cuentas líquidas, con su signo"]

    C --> A --> N
    C --> P --> N
    C --> D

    N --> DP["Δ patrimonio<br/>respecto al mes anterior"]
    DP --> AH["Ahorro real<br/>lo que pusiste tú"]
    DP --> R["Rentabilidad<br/>lo que puso el mercado"]

    M["Movimientos del mes"] --> AC["Ahorro contable<br/>ingresos − gastos"]
    AH --> X["Descuadre<br/>real − contable"]
    AC --> X
```

| Cifra | Definición | Objetivo que cubre | Estado |
|---|---|---|---|
| **Patrimonio neto** | Σ activos − Σ pasivos | 1 | ✅ `netWorth()` |
| **Disponible mañana** | Σ cuentas líquidas, con su signo | 2 | ✅ `available()` |
| **Ahorro real** | Variación de las cuentas no de inversión + aportado a las de inversión | 3 | ✅ `monthDelta()` |
| **Rentabilidad del mes** | Saldo final − saldo inicial − aportado, en cada cuenta de inversión | 3 | ✅ `investmentReturns()` |
| **Descuadre** | Ahorro real − ahorro contable − principal amortizado | (lo que hace fiable todo lo demás) | ✅ `unclassified()` |

Todas viven en [[calculations]]. **El saldo se muestra en gris y la variación en verde/rojo**: el nivel no
es flujo, el Δ sí → [[design-system]]. El Δ compara siempre contra el **mes anterior** —nunca contra el
último mes disponible, que llamaría rentabilidad a varios meses de ahorro— y la serie del gráfico deja los
meses sin cierre como **hueco**, porque interpolarlos inventaría rentabilidad que nadie ganó.

### Sobre la rentabilidad: euros, no porcentaje

Se muestra en **euros ganados**, y es una decisión, no una simplificación pendiente. El porcentaje ingenuo
—ganancia dividida entre lo aportado— miente cuando las aportaciones se concentran en el tiempo: aportar
en diciembre y en enero no es lo mismo, y ese número no lo distingue. Es además el número que uno se ve
tentado de comparar con un índice, que es exactamente la comparación que no soporta.

Lo honesto de afirmar con esta cifra es *"el mercado me dio 200 € este mes"*. Lo que **no** se puede
afirmar es *"llevo un 8 % anual"*. Para eso hace falta XIRR, que es no objetivo hoy.

## 6. La identidad que sostiene el módulo

> **Δ patrimonio = ahorro + rentabilidad**

Se cumple **por construcción**: ahorro y rentabilidad son el mismo sumatorio `Σ (fin − inicio) · signo`
partido en dos según de quién fuera el dinero, así que el reparto no puede descuadrar → [[calculations]]

Un ejemplo completo, porque explica el modelo entero mejor que cualquier definición —y porque es el test
que sostiene el módulo, en `calculations.test.ts`—. Mes de marzo:

| Cuenta | Naturaleza | Cierre feb | Cierre mar | Aportado en mar |
|---|---|---|---|---|
| Corriente | activo | 10.000 | 9.500 | — |
| Broker | activo, de inversión | 5.000 | 6.200 | 1.000 |
| Hipoteca | pasivo | 100.000 | 99.700 | 0 |

Movimientos registrados en marzo: **2.000 de ingresos** y **1.500 de gastos**, de los cuales 400 son la
cuota de la hipoteca.

| Cifra | Cálculo | Resultado |
|---|---|---|
| Patrimonio neto (feb) | 10.000 + 5.000 − 100.000 | **−85.000** |
| Patrimonio neto (mar) | 9.500 + 6.200 − 99.700 | **−84.000** |
| Δ patrimonio | −84.000 − (−85.000) | **+1.000** |
| Rentabilidad | 6.200 − 5.000 − 1.000 | **+200** |
| Ahorro real | −500 (corriente) + 300 (menos deuda) + 1.000 (aportado) | **+800** |
| **Comprobación** | 800 + 200 | **= 1.000** ✅ |
| Ahorro contable | 2.000 − 1.500 | **+500** |
| Descuadre | 800 − 500 | **+300** |

Los 1.000 € que salieron de la corriente hacia el broker **no aparecen por ningún lado como ahorro
extra**: bajan la corriente y suben el aportado, y se cancelan. Eso es justo lo que se busca — mover
dinero de sitio no te hace más rico.

### El descuadre de este ejemplo no es un error

Son **exactamente los 300 € de principal amortizado de la hipoteca**. Contablemente pagaste 400 € de
gasto; en la realidad, 100 € fueron intereses (gasto de verdad) y 300 € fueron ahorro en forma de menos
deuda.

Esto es una **asimetría estructural conocida**, no un defecto: aparecerá todos los meses que tengas un
préstamo. Hay dos salidas y las dos son legítimas:

- **Dejarla.** El descuadre recurrente se lee sabiendo de dónde viene. Coste de mantenimiento: cero.
- **Rellenarla.** El mismo campo *aportado* sirve en un pasivo, donde significa "principal amortizado
  este mes". Coste: mirar el cuadro de amortización del banco una vez al mes.

El modelo no fuerza ninguna de las dos, porque son el mismo campo. Cómo entra ese número en la cuenta
—**corrige el lado contable, no suma al ahorro real**— está en [[calculations]] y en
[[009-la-foto-manda-cierre-mensual]]; el ejemplo de arriba es su test.

## 7. El descuadre es la funcionalidad, no el bug

Sin él no existe **ninguna** forma de saber si los movimientos están completos. Si un mes te olvidas de
registrar 300 € de gastos, `summary()` dice que ahorraste 300 € de más y nada lo contradice. El descuadre
es la primera medida real de esa laguna → [[calculations]] · [[ui-app]]

De ahí tres reglas de diseño, y las tres están aplicadas:

1. **Se muestra, no se corrige.** La tentación de cuadrarlo generando un movimiento de ajuste automático
   se rechaza: falsearía las categorías y contaminaría `categoryData()`, `weeklyBreakdown()` y los
   gráficos que ya existen. Si quieres cuadrar, registras el movimiento que falta, a mano, con su
   categoría.
2. **Se llama "sin clasificar", nunca "error".** Un número que te riñe todos los meses es un módulo que
   abandonas en marzo. Y en presencia de un préstamo, además, sería mentira (sección 6).
3. **No bloquea nada.** Se puede guardar un cierre descuadrado, ver el patrimonio y seguir con tu vida.

## 8. Movimientos y cuentas (objetivo 4)

Un movimiento tiene una referencia **opcional** a una cuenta. Opcional no es pereza: es lo único que no
huérfana los movimientos que ya existen, que nacieron sin cuenta y seguirán sin ella. Es el mismo patrón
que `subcategoryId` —y arrastra la misma trampa: la cadena vacía del `<select>` se mapea a nulo antes de
subir, porque la clave ajena rechaza el `''` → [[movimientos]] · [[sync]]

**Ningún cálculo actual cambia.** `summary`, `weeklyBreakdown`, `categoryData` y `trendData` no miran la
cuenta. La compatibilidad con los agregados de hoy es por construcción, no por cuidado, y eso es lo que
cumple el objetivo 4.

¿Para qué sirve entonces la vinculación? Para **localizar** el descuadre. Si sobran 300 €, saber en qué
cuenta reduce mucho la búsqueda del movimiento que falta. Lo hace `unclassifiedByAccount()`, con una fila
por cuenta más una **"Sin cuenta"** para lo que no está vinculado → [[calculations]]

Consecuencia asumida: mientras solo una parte de los movimientos lleve cuenta, la explicación por cuenta
es **parcial**. El descuadre global sigue siendo exacto; el reparto por cuenta, no. Es aceptable porque el
reparto es una ayuda de diagnóstico, no una cifra que se publique — y se presenta como tal, con su
disclaimer, en el desglose plegable de la subvista *Nivel* → [[ui-app]]

Lo que sí se garantiza es que **las filas suman exactamente el descuadre global**: un desglose que no
cuadra con la cifra de arriba es peor que no tener desglose. De ahí que un movimiento cuya cuenta ya no
existe caiga en la fila "Sin cuenta" en vez de desaparecer del reparto, igual que hace `repairDanglingRefs`
al subir.

## 9. Transferencias entre cuentas propias: no se modelan

Es el punto delicado del diseño. Mover dinero de la corriente al broker no es ni ingreso ni gasto, y el
modelo de movimientos solo tiene esos dos tipos.

| Opción | Veredicto |
|---|---|
| Un tercer tipo de movimiento, *traspaso* | **Descartada.** Toca la restricción de tipo en Postgres, los cuatro cálculos, el modal, y la relación categoría ↔ tipo (una categoría es de ingreso o de gasto). Mucho riesgo sobre el objetivo 4 para resolver algo que la foto mensual ya resuelve. |
| Una entidad *traspaso* aparte, fuera de movimientos | **En reserva.** Correcta y bien aislada —no entra en ningún agregado de flujo porque no es un movimiento—, pero es otra entidad que sincronizar. |
| **No modelarlas** | **Elegida.** Con la foto mandando, un traspaso no mueve el patrimonio: sale de una cuenta y entra en otra, y los cierres del mes ya lo reflejan. Y el traspaso que de verdad importa —la aportación al broker— ya lo captura el campo *aportado*. |

Coste asumido: el descuadre **por cuenta** se ensucia (la cuenta origen sale con descuadre negativo y la
destino con uno positivo, que se cancelan en el total). El total sigue cuadrando, que es lo que se publica.
Si ese ruido llega a molestar de verdad, la opción de la entidad aparte sigue disponible sin rediseñar nada.

## 10. El ritual mensual

Aquí se gana o se pierde el módulo: los dos minutos son el requisito duro, así que la interacción es parte
del diseño y no un detalle posterior. Está implementado en la subvista *Cierre mensual* → [[ui-app]]

- **Una sola pantalla**, *"Cierre de marzo"*: las cuentas activas en orden fijo, un campo por cuenta.
- **Campo vacío, con el último saldo conocido como pista en gris.** No prerrellenado. Prerrellenar
  arrastraría en silencio el número del mes pasado a la serie histórica cada vez que te saltas una cuenta.
  Un campo vacío significa *"no revisado"*, y eso es información. Teclear cinco números cabe de sobra en
  dos minutos.
- **El total se recalcula en vivo** con lo que hay en pantalla, para cazar un dedazo antes de guardar, y
  con él el contador de cuentas revisadas.
- **Un mes incompleto se pinta como incompleto.** No se completa con lo del mes anterior.
- **Editar un cierre pasado es posible**, y navegar hacia atrás no tiene límite. Los errores se descubren
  tres meses después, y como todo es derivado, corregir un saldo recalcula lo demás solo. Hacia delante
  el selector se detiene en el mes en curso: un cierre futuro no significa nada.
- **Un cierre se vacía, no se borra**: el saldo pasa a `null`, que es un estado real ("no revisado") y no
  una ausencia. Por eso este dominio no necesita lápidas → [[009-la-foto-manda-cierre-mensual]]

Ya aplicado: **los meses sin cierre no se interpolan** en el gráfico —la serie tiene un hueco, porque
interpolar inventaría rentabilidad que nadie ganó—, un mes al que le falten cuentas sale del Δ con su
aviso de "mes incompleto", y hay un **aviso discreto** en la subvista *Nivel* cuando quedan meses sin
cerrar, con un botón que abre el más antiguo pendiente. Nada de notificaciones push. Cuenta desde el mes
**anterior** al actual: el mes en curso todavía no toca cerrarlo → [[ui-app]]

## 11. Qué le exige este dominio al sync

Sin entrar en implementación, el motor actual impone contratos que el modelo tiene que respetar desde el
principio → [[sync-model]]

- **El grano del conflicto es el cierre de una cuenta en un mes**, no el mes entero. Editar el saldo del
  broker desde el móvil y el de la corriente desde el portátil no puede hacer que uno pise al otro. Es
  exactamente el precedente de las subcategorías, reutilizado → [[007-subcategorias-normalizadas-en-servidor]]
- **Orden causal en la cola**: la cuenta antes que sus cierres, porque la clave ajena del servidor lo exige.
- **Un cierre se edita o se vacía; no se borra.** Así este dominio no necesita su propia tabla de lápidas.
  Es una simplificación deliberada, y queda escrita para que nadie la deshaga sin darse cuenta.
- **"Borrar todo" tiene que barrer también cuentas y cierres**, o la próxima sincronización repoblaría un
  patrimonio que creías eliminado → [[borrado-total]]

## 12. Color

Verde y rojo están reservados en exclusiva a ingreso y gasto; todo lo demás es la escala de grises
→ [[design-system]]

**El nivel (el saldo, el patrimonio) va en gris**: el neto se pinta neutral aunque sea negativo, porque un
pasivo no es un gasto. **La variación (Δ) sí usa verde y rojo**, porque es un flujo con la misma semántica
de "mejora" y "empeora".

Las dos mitades están aplicadas, y juntas **extendieron el enunciado** de la regla de color: la frontera
nunca fue ingreso/gasto contra el resto, sino **flujo contra nivel**. El enunciado completo vive ahora en
[[design-system]], que es quien manda.

Nota relacionada: un gráfico de barras apiladas por cuenta es tentador y no se recomienda. La rampa del
proyecto solo distingue bien seis escalones, límite ya conocido y ya sufrido en el donut de categorías.
De ahí que el gráfico sea **una sola línea** de patrimonio neto y, si acaso algún día, una separación
activos / pasivos.

## 13. Riesgos

1. **El descuadre asusta y el módulo se abandona.** Se presenta como "sin clasificar", no bloquea nada, y
   la nota explica por qué con un préstamo nunca será cero.
2. **Tres meses sin cierre y la serie pierde su valor.** Mitigación: el aviso, y que rellenar hacia atrás
   sea siempre posible.
3. **Teclear un pasivo en negativo.** Imposible por diseño: el signo lo pone la cuenta y el campo solo
   admite positivos.
4. **Confundir la fecha de un cierre con la de un movimiento.** Un cierre es un mes (`YYYY-MM`), no un día;
   los cierres no pasan por el filtrado de periodo tal cual → [[periodos]]
5. **La presión de meter tickers, cantidades y precios de entrada.** Es no objetivo y la línea roja se
   escribe explícita, porque la tentación va a existir en cuanto el módulo funcione.

## Lo que este diseño NO resuelve

- **Rentabilidad comparable con un índice.** Hace falta XIRR, y para eso hacen falta las fechas de cada
  aportación, no un total mensual. Cambia el grano del dato de entrada.
- **Divisas.** Todo es euros.
- **El desglose real de una cuota de préstamo** en intereses y principal, salvo que lo teclees.
- **Saldo del día de hoy.** El dato es mensual; entre cierres, el patrimonio que se muestra es el del
  último cierre.
- **Detectar *qué* movimiento falta.** El descuadre dice cuánto y (parcialmente) dónde, nunca qué.

## Supuesto de dimensionamiento

Del orden de **3 a 8 cuentas**. Es lo que hace viable el ritual manual y lo que descarta la visualización
por cuenta de la sección 12. Con bastantes más, el ritual mensual habría que rediseñarlo.

Related: [[movimientos]] · [[periodos]] · [[calculations]] · [[sync-model]] · [[categorias]] · [[design-system]] · [[glossary]]
