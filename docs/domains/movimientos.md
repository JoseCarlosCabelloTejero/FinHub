---
tags: [type/domain, domain/movimientos]
up: "[[00-index]]"
---

# Dominio: movimientos

La entidad central: un **ingreso** o un **gasto**. Todo lo demás (categorías, periodos, gráficos) existe
para clasificarlos y resumirlos.

**Fuente de verdad**: `src/types.ts` · tabla `movements` en [[postgres-schema]]

## Modelo

```ts
interface Movement {
  id: string;              // uuid v4 generado en cliente (crypto.randomUUID)
  type: 'income' | 'expense';
  amount: number;          // > 0 siempre; el signo lo da `type`
  date: string;            // 'YYYY-MM-DD', tal cual lo produce <input type="date">
  categoryId: string;
  subcategoryId?: string;  // opcional: "Sin subcategoría"
  concept: string;
  notes?: string;
  createdAt: string;       // ISO
  updatedAt: string;       // ISO — el sello del LWW
}
```

## Reglas del dominio

- **El importe nunca es negativo.** El signo lo determina `type`; la UI lo pinta con `-`/`+` y el
  esquema lo fuerza con `check (amount >= 0)`.
- **Un movimiento pertenece a una categoría del mismo tipo.** El modal filtra las categorías por
  `form.type`, y cambiar el tipo resetea `categoryId` y `subcategoryId`.
- **`subcategoryId` es opcional.** El `<select>` usa `value=""` para "Sin subcategoría", y ese `''`
  **se mapea a `null`** antes de subirlo: la FK rechazaría la cadena vacía. → [[sync]]
- **Las referencias son strings sin integridad referencial en el cliente.** Esto es intencionado y es lo
  que permite archivar categorías sin tocar el histórico. En Postgres **sí** hay FK, y de ahí la
  necesidad de `repairDanglingRefs`. → [[categorias]]
- **Borrar pide confirmación** (una sola; el "Borrar todo" pide dos) y deja una **lápida** en el
  servidor para que un dispositivo offline no lo resucite. → [[sync-model]]

## Validación (en `MovementModal`)

En este orden, con el primer fallo mostrado en `role="alert"`:

1. Concepto no vacío → "Escribe un concepto."
2. Importe finito y `> 0` → "El importe debe ser mayor que cero."
3. Fecha y categoría presentes → "Completa la fecha y la categoría."

El `concept` se guarda con `.trim()`. En edición se conserva el `createdAt` original.

## Dónde aparecen

- **Resumen** — `summary()` sobre los del periodo: ingresos, gastos, ahorro, tasa de ahorro.
- **Semanal** — cruce gasto × semana; los que no resuelven categoría o subcategoría se agrupan en
  "Sin categoría"/"Sin subcategoría" para que los totales cuadren. → [[calculations]]
- **Movimientos** — tabla con búsqueda por concepto y notas, filtro por tipo, orden por fecha
  descendente.
- **Gráficos** — tendencia del periodo y reparto por categoría. → [[charts]]

Related: [[categorias]] · [[periodos]] · [[escritura-local]] · [[postgres-schema]]
