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
  // De qué cuenta salió o entró el dinero. Opcional de verdad, y no por pereza: es lo único que no
  // huérfana los movimientos que ya existen, que nacieron sin cuenta y seguirán sin ella. Ningún
  // agregado de flujo la mira (summary, weeklyBreakdown, categoryData, trendData); sirve para
  // localizar el descuadre, no para calcularlo.
  accountId?: string;
  concept: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Preferences { periodMode: 'month' | 'year'; selectedDate: string }

// El signo con el que la cuenta entra en el patrimonio. Nunca lo teclea la persona junto al importe:
// el saldo de un cierre es siempre positivo y un pasivo resta al agregarse (mismo invariante que
// Movement, donde el signo lo da el tipo).
export type AccountNature = 'asset' | 'liability';

// Un contenedor de dinero. Se archiva, nunca se borra: los cierres históricos lo referencian (mismo
// patrón y misma razón que las categorías).
export interface Account {
  id: string;
  name: string;
  nature: AccountNature;
  // Si su valor puede moverse sin que entre dinero (broker sí, ahorro no). Solo a estas cuentas se
  // les pregunta el aportado en el cierre.
  isInvestment: boolean;
  // Si cuenta para el "disponible mañana". Aplica a activos y pasivos: la corriente suma, la tarjeta
  // resta, el broker y la hipoteca se ignoran.
  isLiquid: boolean;
  archived: boolean;
  order: number;
  updatedAt: string;
}

// El valor de UNA cuenta en UN mes ("cierre"; "snapshot" ya significa el estado completo del
// servidor). El id es determinista —`${accountId}:${month}`— para que dos dispositivos que cierren la
// misma cuenta el mismo mes converjan a la misma fila y el LWW resuelva solo.
export interface Closing {
  id: string;
  accountId: string;
  month: string; // 'YYYY-MM'; los cierres no pasan por el filtrado de periodo
  // null no es ausencia, es un estado real: "mes no revisado". Un cierre se edita o se vacía, nunca
  // se borra, y por eso este dominio no necesita lápidas.
  balance: number | null;
  // Dinero propio que entró ese mes. En una cuenta de inversión separa ahorro de rentabilidad; en un
  // pasivo significa "principal amortizado". Puede ser negativo (una retirada).
  contributed?: number;
  note?: string;
  updatedAt: string;
}

// Una escritura pendiente de subir. Su `seq` es la clave autoincremental del store `outbox`, no un
// campo del valor: el orden de las claves ES el orden causal en que se hicieron las escrituras.
// `payload` va ya mapeado al esquema del servidor (snake_case) porque diffCategoryDoc produce filas,
// no documentos; db.ts no necesita conocer ese formato, lo estrecha sync.ts en la fase 4.
export interface OutboxOp {
  table: 'movements' | 'categories' | 'subcategories' | 'accounts' | 'account_closings';
  kind: 'upsert' | 'delete';
  id: string;
  payload?: Record<string, unknown>;
  updatedAt: string;
}

// Bookkeeping de sync, local a cada dispositivo (store `meta`, clave 'sync'). Un único registro, como
// las preferencias: así queda tipado de verdad en vez de ser un saco de pares clave-valor.
export interface SyncMeta {
  userId: string | null;
  // De quién son los datos que hay cacheados en IndexedDB. NO es lo mismo que `userId`, que
  // resolveUserId() sobrescribe con el usuario actual en cada arranque: sin este campo aparte,
  // un cambio de usuario en el mismo navegador sería indetectable y mezclaría los dos históricos.
  dataUserId: string | null;
  migratedAt: string | null;
  lastSyncAt: string | null;
  wipeEpoch: number;
  lastStampAt: string | null;
  // Huella del último snapshot aplicado, tal y como la devolvió sync_fingerprint() en el servidor.
  // Se persiste y no solo se guarda en memoria porque en una PWA recargar la página es el caso
  // común, y con la huella en una variable de módulo cada recarga volvía a descargarlo todo.
  lastFingerprint: string | null;
}

// 'demo' es un estado terminal: en modo demo el motor no arranca, así que se fija una vez y no cambia
// nunca. Es el único que no describe una relación con el servidor, sino la ausencia de servidor.
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'auth-required' | 'demo';

// Lo que la UI necesita saber del sync. `lastError` guarda el motivo de la última op descartada por
// ser irrecuperable, que es el único fallo que el usuario no puede deducir de `status` (el resto se
// reintentan solos).
export interface SyncState {
  status: SyncStatus;
  pendingOps: number;
  lastSyncAt: string | null;
  lastError: string | null;
}
