---
tags: [type/decision, domain/sync, area/cliente, area/servidor]
up: "[[00-index]]"
---

# ADR 011 — Huella de sincronización en vez de pull incremental

**Estado**: aceptada

## Contexto

Todo el tráfico de la app salía de `fetchSnapshot()`: **cinco `select('*')`** sin filtros ni
paginación. Ese bloque lo dispara `runSync`, y `initSync` lo lanza en cinco situaciones — arranque,
`online`, `visibilitychange`, **sondeo cada 60 s con la pestaña visible** y 800 ms después de cada
escritura. Con el RPC del `wipe_epoch`, cada ciclo eran **6 peticiones**. El primer login eran **10
`select('*')`**: una ronda en `firstSync()` y otra en el `pullAndApply()` del mismo ciclo.

`lastPullKey` ya evitaba repintar cuando el snapshot no había cambiado, pero **compara después de
descargar**: los bytes ya habían viajado. En el móvil, bajarse la base entera cada minuto para casi
siempre tirarla.

Se barajaron tres salidas.

### Descartada: carga perezosa por sección

Era la idea de partida y es la que más engaña. **La UI de esta app nunca lee de la red**: las cinco
pantallas se pintan desde IndexedDB con `getAllData()`, así que cambiar de sección ya es instantáneo.
Pedir por sección no habría acelerado nada visible y habría roto cuatro cosas a la vez: el
funcionamiento sin conexión (una sección no visitada quedaría vacía), el merge LWW —`mergeWithServer`
y `applyPullToLocal` necesitan el snapshot completo—, el invariante de *pull solo con la cola vacía*
→ [[sync-model]], y el patrón de estado centralizado sin caché por pantalla → [[ui-app]].

**El problema no era pedir demasiadas secciones, sino pedir cuando no hacía falta pedir.**

### Descartada (por ahora): pull incremental

Filtrar por `updated_at > último` es lo obvio, y no vale: **no ve los borrados**. Los movimientos se
borran de verdad y su lápida vive en `movement_tombstones`, que es *server-only* sin grants ni
políticas a propósito → [[postgres-schema]]. Habría que exponerla o añadir un `deleted_at`, y eso
toca el modelo de borrado entero. Se paga el día que haya decenas de miles de movimientos.

## Decisión

Un RPC **`sync_fingerprint()`** que devuelve `{digest, wipe_epoch}`, y saltarse el pull completo
cuando el digest coincide con el del último snapshot aplicado. Es **`lastPullKey` movido al
servidor**: la misma idea, calculada antes de mover los datos.

En reposo, el ciclo pasa de **6 peticiones a 1**. El primer login, de **10 `select` a 5**.

### `md5` del conjunto, no `count(*) + max(updated_at)`

`count + max` es más barato y **puede quedarse ciego**. Si el dispositivo B tiene el reloj adelantado
y escribe con sello `T5`, una escritura *posterior* del dispositivo A con sello `T3` deja `count` y
`max` intactos: cambio perdido en silencio. Es justo el desfase horario que `monotonicStamp` existe
para sobrevivir → [[sync]], así que la huella no puede ser ciega a él.

`md5(string_agg(id || updated_at order by …))` sobre las cinco tablas no puede fallar: cualquier alta,
baja o modificación cambia el conjunto de pares. **Verificado contra Postgres local**: actualizar una
fila con un sello *por debajo del máximo global* cambia el digest.

### `security invoker`, y no es un detalle

Pasa por RLS, así que el digest se calcula solo sobre las filas del llamante. Como `definer` vería las
filas de todos y filtraría por diferencia de digest: un oráculo sobre datos ajenos. Mismo criterio que
`wipe_all_data()` sin parámetros → [[006-un-solo-usuario]].

### El guard que hace que esto sea correcto

La huella se lee **al principio del ciclo, antes del push**. Si el push de ese mismo ciclo cambió el
servidor, coincidir no significa "no hay nada nuevo" sino "aún no me he enterado de lo mío". Por eso
`canSkipPull` exige **las dos condiciones**: misma huella **y** nada subido en este ciclo. Un ciclo
que ha escrito pulla siempre — el LWW del servidor puede haber descartado alguna op, y dar la versión
local por buena sería creerse una escritura que no se aplicó.

Corolario del mismo razonamiento: la huella se **invalida** en los tres puntos que invalidan la caché
local — cambio de usuario, epoch de wipe ajeno y "Borrar todo". Olvidar uno deja la pantalla mostrando
datos que ya no existen.

Y un segundo corolario, que la QA en navegador cazó y los tests no: **tras un push hay que releer la
huella antes de pullear.** La del principio del ciclo describe el servidor de antes de subir, así que
apuntarla dejaba al ciclo siguiente descargándose las cinco tablas para nada. Se relee **antes** del
snapshot y jamás después: una huella tomada después taparía un cambio ocurrido entre los dos. La regla
que ordena todo esto es **equivocarse siempre hacia descargar de más, nunca hacia descargar de menos**.

## Consecuencias

- **`lastPullKey` se queda.** Sigue siendo la segunda red, para los ciclos en los que el pull sí
  ocurre (los que han escrito). No es redundante: opera después de descargar, no en vez de.
- **La huella se persiste** en `meta.lastFingerprint` y se rehidrata en `adoptUser`. En una variable de
  módulo se perdía al recargar la página, que en una PWA es el caso común. Efecto secundario bueno:
  dos pestañas del mismo navegador comparten IndexedDB, así que dejan de descargar por duplicado.
- **Un `count(*)` y un `string_agg` por poll** sobre las cinco tablas. Con este volumen es ruido; con
  decenas de miles de filas habría que medirlo, y es el mismo umbral en el que tocaría el pull
  incremental de todos modos.
- **Riesgo asumido**: si IndexedDB se vaciara sin vaciarse `meta`, la huella persistida mentiría y se
  saltaría un pull necesario. Los tres puntos de invalidación son lo que lo cubre.
- **Degrada bien**: sin digest (`null`), `canSkipPull` devuelve `false` y el comportamiento vuelve a
  ser el de antes — descargarlo todo. Nunca se salta un pull por no saber.

## Relacionadas

[[sync-model]] · [[sync]] · [[pull]] · [[004-sin-realtime]] · [[postgres-schema]] · [[003-outbox-en-indexeddb]]
