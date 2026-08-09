# FinHub · Finanzas personales

Aplicación web para registrar ingresos y gastos, consultar el ahorro y entender la evolución
financiera mediante gráficos. Proyecto personal, sin ánimo de ser multiusuario.

## Qué hace

- Registro de movimientos (ingreso/gasto) con importe, fecha, categoría, subcategoría, concepto y notas.
- Categorías y subcategorías propias, organizables y archivables (nunca se borran, para no perder el histórico de movimientos antiguos).
- Resumen del periodo (mes o año) con ingresos, gastos y ahorro.
- Gráficos de evolución (tendencia) y de reparto por categoría, con agrupación automática de categorías minoritarias en "Otros".
- Vista semanal con desglose de gasto.
- UI en español, con foco en accesibilidad (foco visible único, `aria-live` para avisos, confirmación doble para "Borrar todo").

## Arquitectura y estado actual

La app nació **local-first**: todo el dato vivía solo en IndexedDB del navegador, sin backend ni cuentas.
Esa premisa está **en migración consciente** hacia Supabase para poder usar la app desde varios
dispositivos. Ahora mismo el proyecto está a mitad de esa migración:

| Fase | Qué añade | Estado |
|---|---|---|
| 1 | App local-first sobre IndexedDB (modelo, cálculos, UI, gráficos) | ✅ hecho |
| 2 | Esquema Postgres en Supabase (RLS, `updated_at` para LWW) + migración de IndexedDB a v3 (stores `outbox`/`meta`) | ✅ hecho |
| 3 | Login obligatorio con email y contraseña de Supabase (un único usuario, el propietario) | ✅ hecho |
| 4 | Motor de sync real (subir/bajar movimientos y categorías, resolución de conflictos *last-write-wins*) | ✅ hecho |

En la práctica, hoy:

- **Los datos siguen viviendo en IndexedDB** (`finhub-finanzas`) y son los que la app lee y escribe.
- **Supabase actúa como puerta de acceso**: sin iniciar sesión no se puede usar la app. Solo hay un usuario permitido (el propietario), sin registro público.
- La cola de sincronización (`outbox`) y el esquema remoto ya existen, pero **todavía no hay nada que los conecte de verdad** (eso es la fase 4).

Detalles de la arquitectura, patrones a respetar y comandos completos: [`CLAUDE.md`](./CLAUDE.md).
Cómo está configurada la autenticación (incluido lo que solo se hace a mano en el dashboard de Supabase): [`docs/supabase-auth.md`](./docs/supabase-auth.md).

## Stack

React + TypeScript + Vite · IndexedDB vía [`idb`](https://github.com/jakearchibald/idb) · Supabase (auth + Postgres) · Recharts · Vitest + Testing Library · ESLint.

## Puesta en marcha

Requiere Node.js 20+ y un proyecto de Supabase propio (aunque el dato aún no viaje allí, el login ya es obligatorio).

```bash
npm install
cp .env.example .env.local   # rellenar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

Cómo dar de alta el único usuario permitido y configurar el proyecto de Supabase: [`docs/supabase-auth.md`](./docs/supabase-auth.md).

Para una versión de producción:

```bash
npm run build        # incluye el type-check (tsc -b)
npx vite preview      # sirve el build; "npm run preview" no existe como script
```

## Comprobaciones

```bash
npm test             # vitest run
npm run lint
npm run build
```

Comprobación completa antes de dar algo por terminado: `npm test && npm run lint && npm run build`.

## Privacidad

- Sin backend propio más allá de Supabase (auth + esquema preparado para sync futuro); sin telemetría.
- Los movimientos no forman parte del repositorio.
- Solo se permite el usuario propietario: no hay registro público ni recuperación de contraseña por correo (se gestiona a mano desde el dashboard de Supabase).
- La opción **Borrar todo** requiere dos confirmaciones y restaura las categorías originales.
