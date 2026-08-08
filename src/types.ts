export type MovementType = 'income' | 'expense';

// En Postgres las subcategorías son filas propias con su updated_at: cada una gana o pierde el LWW
// por separado, así que renombrar dos subcategorías distintas en dos dispositivos ya no colisiona.
// En el cliente siguen embebidas dentro de Category y el pull las reensambla.
export interface Subcategory {
  id: string;
  name: string;
  archived: boolean;
  order: number;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  type: MovementType;
  order: number;
  archived: boolean;
  updatedAt: string;
  subcategories: Subcategory[];
}

export interface Movement {
  id: string;
  type: MovementType;
  amount: number;
  date: string;
  categoryId: string;
  subcategoryId?: string;
  concept: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Preferences { periodMode: 'month' | 'year'; selectedDate: string }

// Una escritura pendiente de subir. Su `seq` es la clave autoincremental del store `outbox`, no un
// campo del valor: el orden de las claves ES el orden causal en que se hicieron las escrituras.
// `payload` va ya mapeado al esquema del servidor (snake_case) porque diffCategoryDoc produce filas,
// no documentos; db.ts no necesita conocer ese formato, lo estrecha sync.ts en la fase 4.
export interface OutboxOp {
  table: 'movements' | 'categories' | 'subcategories';
  kind: 'upsert' | 'delete';
  id: string;
  payload?: Record<string, unknown>;
  updatedAt: string;
}

// Bookkeeping de sync, local a cada dispositivo (store `meta`, clave 'sync'). Un único registro, como
// las preferencias: así queda tipado de verdad en vez de ser un saco de pares clave-valor.
export interface SyncMeta {
  userId: string | null;
  migratedAt: string | null;
  lastSyncAt: string | null;
  wipeEpoch: number;
  lastStampAt: string | null;
}
