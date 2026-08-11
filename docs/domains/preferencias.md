---
tags: [type/domain, domain/periodos, area/cliente]
up: "[[00-index]]"
---

# Dominio: preferencias

Lo único del modelo que **no viaja al servidor**.

**Fuente de verdad**: `src/types.ts` · `savePreferences`/`loadPreferences` en [[db]]

```ts
interface Preferences { periodMode: 'month' | 'year'; selectedDate: string }
```

Store `preferences` de IndexedDB, **clave `'main'`** (out-of-line: un único registro, como `meta`).

## Se guardan solas

```ts
useEffect(() => { if (!loading) savePreferences(prefs) }, [prefs, loading]);
```

El guard `if (!loading)` **evita sobrescribir lo que se acaba de cargar en el arranque**: sin él, el
primer render con los valores por defecto (`month` + hoy) pisaría lo guardado antes de que
`loadPreferences()` resolviera.

No hay `await` ni `reload()` detrás: no son datos derivados, así que el ciclo de "escribir y recargar"
de [[ui-app]] no aplica aquí.

## Por qué NO se sincronizan

Son **estado de navegación**, no datos del usuario: en qué mes estabas mirando y si veías por mes o por
año. Sincronizarlas tendría dos costes y ningún beneficio:

- Cada vez que cambias de mes en el portátil, el móvil daría un salto de vista al sincronizar.
- Añadiría una cuarta tabla, su RLS, su LWW y su lugar en el outbox para un dato que se regenera solo.

Consecuencia asumida: al entrar en un dispositivo nuevo empiezas en el **mes actual**, no donde lo
dejaste en el otro.

## Qué sí hay en el servidor

Solo `sync_meta`, con el `wipe_epoch`, y **no es una preferencia**: es bookkeeping de sincronización.
→ [[borrado-total]] · [[postgres-schema]]

El bookkeeping local equivalente vive en el store `meta` (`SyncMeta`) → [[indexeddb-stores]]. Ojo con
la diferencia: `clearAllData()` **sí** vacía `preferences`, porque "Borrar todo" restablece también la
vista.

Related: [[periodos]] · [[db]] · [[ui-app]]
