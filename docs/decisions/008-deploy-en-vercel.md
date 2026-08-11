---
tags: [type/decision, area/cliente]
up: "[[00-index]]"
---

# ADR 008 — Deploy en Vercel, con CI como semáforo y no como puerta

**Estado**: aceptada

## Contexto

La app se quedó cinco fases en `localhost`. La migración a Supabase ([[001-local-first-a-supabase]]) se
hizo **precisamente** para poder consultarla desde el móvil, pero mientras el cliente no estuviera
publicado ese objetivo seguía sin cumplirse: la fuente de verdad estaba en la nube y la app no.

El build es un **estático puro** (`vite build` → `dist/`), sin servidor ni funciones: Supabase pone la API.
Eso abre la puerta a cualquier host de estáticos y hace que el criterio de decisión no sea la capacidad,
sino la fricción.

Había además una pregunta que no es obvia: **¿quién despliega?** Vercel ya despliega solo al conectar el
repo, así que una GitHub Action que llame a `vercel deploy` duplicaría el trabajo.

## Decisión

**Vercel con su integración nativa de Git**, y **GitHub Actions solo como semáforo de calidad**.

- Push a `main` → deploy de producción. PR → preview URL propia.
- `.github/workflows/ci.yml` corre `npm ci` + `npm test` + `npm run lint` + `npm run build` en cada PR y
  en `main`. **No despliega nada** y no tiene acceso a Vercel.
- La configuración de build vive en `vercel.json`, no en ajustes del dashboard, para que el proyecto sea
  reproducible si hay que recrearlo.

El motivo de no desplegar desde la Action: hacerlo exigiría `VERCEL_TOKEN`, `ORG_ID` y `PROJECT_ID` como
secretos, cablear las previews a mano y renovar un token que caduca. Para una app de una persona, eso es
mantenimiento puro a cambio de un beneficio pequeño.

## Consecuencias

- **Contrapartida asumida: un test rojo no bloquea el deploy.** Vercel no espera a los checks de GitHub, así
  que si se mergea con CI en rojo, se despliega igual. Se acepta porque:
  1. Un **error de tipos sí bloquea**, porque `tsc -b` vive dentro de `npm run build` y el build de Vercel
     lo ejecuta. Lo que se escapa es solo un test de lógica en rojo.
  2. El flujo de ramas del repo ya obliga a pasar por PR, donde el semáforo se ve antes de mergear.
  3. El rollback es un clic (Deployments → *Promote to Production*), así que el coste de equivocarse es bajo.
  Si algún día molesta, la solución no es mover el deploy a Actions: es activar *branch protection* en
  `main` exigiendo el check de CI.
- **Cero secretos en GitHub.** El workflow construye con **valores dummy** de `VITE_SUPABASE_*`: solo
  necesita type-checkear, no hablar con Supabase. Los tests ya mockean `./supabase` a propósito.
- **Las dos variables se inlinean en el bundle** y son públicas por diseño (anon key + RLS). La *service
  role key* no entra nunca en este repo ni en Vercel.
- Aparece un `vite.config.ts` con un plugin que **aborta el build** si faltan esas variables. Sin él, el
  build pasa y producción sale en pantalla en blanco: el modo de fallo ya documentado en [[supabase-auth]].
- **No se añade rewrite catch-all** a `/index.html`: no hay router, así que un 404 real es correcto y un
  rewrite solo taparía rutas mal escritas. Si algún día entra un router, hay que añadirlo.
- Sigue habiendo **configuración manual no versionable** en dos dashboards. Está en [[deploy-vercel]], que
  es la única copia.

## Alternativas descartadas

- **Deploy desde GitHub Actions con la CLI de Vercel** — daría la puerta de calidad real (sin tests
  verdes no se despliega), pero a cambio de tres secretos, un token que caduca y las previews a mano.
- **PWA con service worker** (`vite-plugin-pwa`) — encajaría con el diseño local-first, pero añade una capa
  de caché que hay que invalidar bien o se sirve JS viejo. Se queda en manifest + iconos: se instala en la
  pantalla de inicio, y los *datos* ya funcionan sin red por IndexedDB. → [[deploy-vercel]]

## Relacionadas

[[deploy-vercel]] · [[001-local-first-a-supabase]] · [[supabase-auth]] · [[comandos-y-entorno]]
