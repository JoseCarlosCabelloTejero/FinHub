---
tags: [type/flow, domain/auth, area/cliente]
up: "[[00-index]]"
---

# Flujo: arranque, sesión y cambio de usuario

Sin sesión **no se puede usar la app**. Este flujo cubre el arranque, el caso offline y el cambio de
cuenta en el mismo navegador.

**Fuente de verdad**: `App` en `src/App.tsx` · `src/supabase.ts` · `adoptUser` en `src/sync.ts`

## Arranque

```mermaid
sequenceDiagram
    actor U as Usuario
    participant App as App (gate)
    participant SB as supabase.ts
    participant Auth as Supabase Auth
    participant DB as IndexedDB
    participant Fin as Finances

    App->>App: userId = undefined → "Comprobando tu sesión…"
    App->>SB: resolveUserId()
    SB->>Auth: getSession()
    alt hay sesión
        Auth-->>SB: session
        SB->>DB: saveSyncMeta({ userId })
        SB-->>App: userId
    else error de red (token caducado + offline)
        SB->>DB: getSyncMeta() → userId recordado
        SB-->>App: userId (modo offline)
    else sin sesión
        SB-->>App: null
    end
    App->>App: setUserId(prev => prev === undefined ? id : prev)

    alt userId === null
        App-->>U: <Login/>
        U->>SB: signIn(email, password)
        SB->>Auth: signInWithPassword
        Auth-->>SB: user
        SB->>DB: saveSyncMeta({ userId })
        Note over SB,App: SIGNED_IN → onAuthChange → setUserId
    end

    App->>Fin: <Finances key={userId}/>
    Fin->>DB: bootstrapData() + reload() + loadPreferences()
    Fin->>Fin: initSync(reload)
```

## Las cuatro sutilezas

### 1. `prev === undefined` resuelve una carrera real

Si el usuario entra **mientras `resolveUserId` sigue en vuelo**, `SIGNED_IN` ya habría fijado el id y la
resolución inicial (`null`) lo pisaría devolviéndolo al login. **La suscripción manda**; `resolveUserId`
solo rellena el hueco inicial.

### 2. `INITIAL_SESSION` se ignora

Llega con `session: null` en el caso offline y **después** de que `resolveUserId` haya resuelto: atenderlo
echaría al usuario al login teniendo datos locales perfectamente usables. La suscripción solo atiende
transiciones.

### 3. El fallback offline vive en `meta.userId`

El access token dura **1 hora**. Sin conexión y con el token caducado, `getSession()` devuelve
`session: null` aunque la sesión siga guardada. Sin el fallback, abrir la app offline una hora después
del último refresco te dejaría fuera de tus propios datos.

Por eso `signOut()` limpia `meta.userId` **antes** de cerrar sesión: es la llave de ese modo.

### 4. El gate está en su propio componente

Los hooks de `Finances` no pueden ser condicionales, y además así **sin sesión no se siembran las
categorías por defecto** (`bootstrapData`) antes de saber qué hay en el servidor. → [[first-sync]]

## Cambio de usuario en el mismo navegador

Dos mecanismos, uno en la UI y otro en los datos:

```mermaid
sequenceDiagram
    participant App as App (gate)
    participant Fin as Finances
    participant S as sync.ts
    participant DB as IndexedDB

    Note over App: SIGNED_IN con otro userId
    App->>Fin: key={userId} cambia → REMONTA el árbol entero
    Note over Fin: ningún estado del usuario anterior sobrevive
    Fin->>S: initSync → runSync
    S->>DB: getSyncMeta()
    Note over S: meta.dataUserId ≠ userId actual
    S->>DB: clearOutbox()
    S->>DB: saveSyncMeta({ dataUserId, migratedAt: null, wipeEpoch: 0, lastSyncAt: null })
    Note over S: lastPullKey = null → la vinculación se rehace
```

**`dataUserId` no es `userId`.** `resolveUserId()` sobrescribe `userId` con el usuario actual en cada
arranque; `dataUserId` dice **de quién son los datos cacheados**. Sin ese campo aparte, un cambio de
usuario sería indetectable y mezclaría los dos históricos.

Nótese el matiz de `adoptUser`: si `dataUserId` era `null` (primer arranque) **no** se resetea
`migratedAt` — no hay nada que invalidar.

## Cerrar sesión

- `scope: 'local'`: no llama al servidor, así que funciona sin conexión. Con un único usuario no hay
  otras sesiones que revocar.
- **No vacía el outbox**: al volver a entrar con la misma cuenta se sube igual. Lo que sí lo tira es
  entrar con **otra** cuenta, y eso el usuario no puede deducirlo — de ahí el `confirm` que avisa de los
  cambios sin sincronizar antes de salir.

Related: [[supabase-auth]] · [[ui-app]] · [[first-sync]] · [[006-un-solo-usuario]]
