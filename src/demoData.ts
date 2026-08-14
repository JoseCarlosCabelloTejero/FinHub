import { closingId, shiftMonth } from './calculations';
import { EPOCH_UPDATED_AT } from './data';
import { clearAllData, saveAccount, saveClosing, saveMovement } from './db';
import { clearDemoFlag } from './demo';
import type { Account, Closing, Movement, MovementType } from './types';

// Datos de ejemplo del modo demo. Sembrar tiene sentido porque con la base vacía las cinco pantallas
// abren con ceros y los recuadros de "todavía no hay datos": quien entra a mirar no ve nada de lo que
// la app hace. Vive aparte de data.ts porque aquello son las categorías por defecto de TODO el mundo y
// esto es un decorado que solo existe en la demo.
//
// Dos reglas que sostienen el fichero:
//
// 1. Todo se genera **relativo a `now`**. Fechas fijas caerían fuera del periodo que abre el Resumen y
//    la demo se vería igual de vacía que sin semillas.
// 2. Los saldos de los cierres NO se escriben a mano: se despejan de los movimientos (ver `demoSeed`).
//    Inventarlos dejaría Patrimonio abriendo con un "sin clasificar" de cientos de euros, que es justo
//    la avería que esa pantalla existe para detectar.

const MONTHS = 4;

// Los ids son deterministas (`demo-…`) y no uuid: así `demoSeed` es una función pura y testeable, y de
// paso se reconoce de un vistazo que una fila es del decorado.
export const DEMO_ACCOUNTS: Account[] = [
  { id: 'demo-corriente', name: 'Cuenta corriente', nature: 'asset', isInvestment: false, isLiquid: true, archived: false, order: 0, updatedAt: EPOCH_UPDATED_AT },
  { id: 'demo-broker', name: 'Broker', nature: 'asset', isInvestment: true, isLiquid: false, archived: false, order: 1, updatedAt: EPOCH_UPDATED_AT },
  { id: 'demo-tarjeta', name: 'Tarjeta de crédito', nature: 'liability', isInvestment: false, isLiquid: true, archived: false, order: 2, updatedAt: EPOCH_UPDATED_AT },
];

// `day` nunca pasa de 28: un 30 se saldría de febrero y la semilla dependería del mes en que la abras.
// `account` opcional a propósito: sin cuenta es un estado normal del modelo, y así el reparto del
// descuadre por cuenta de Patrimonio estrena también su fila "Sin cuenta".
type Spec = { category: string; sub: string; day: number; amount: number; concept: string; type?: MovementType; account?: string };

const CORRIENTE = 'demo-corriente';

const EVERY_MONTH: Spec[] = [
  { category: 'income', sub: 'income-nomina', day: 1, amount: 2400, concept: 'Nómina', type: 'income', account: CORRIENTE },
  { category: 'expense-fijos', sub: 'expense-fijos-piso', day: 2, amount: 750, concept: 'Alquiler', account: CORRIENTE },
  { category: 'expense-fijos', sub: 'expense-fijos-luz', day: 8, amount: 58, concept: 'Factura de la luz', account: CORRIENTE },
  { category: 'expense-fijos', sub: 'expense-fijos-internet-movil', day: 10, amount: 45, concept: 'Fibra y móvil', account: CORRIENTE },
  { category: 'expense-fijos', sub: 'expense-fijos-suscripciones', day: 12, amount: 22, concept: 'Suscripciones' },
  { category: 'expense-alimentacion', sub: 'expense-alimentacion-supermercado', day: 3, amount: 86, concept: 'Compra semanal', account: CORRIENTE },
  { category: 'expense-alimentacion', sub: 'expense-alimentacion-supermercado', day: 10, amount: 92, concept: 'Compra semanal', account: CORRIENTE },
  { category: 'expense-alimentacion', sub: 'expense-alimentacion-supermercado', day: 17, amount: 78, concept: 'Compra semanal', account: CORRIENTE },
  { category: 'expense-alimentacion', sub: 'expense-alimentacion-supermercado', day: 24, amount: 95, concept: 'Compra semanal', account: CORRIENTE },
  { category: 'expense-alimentacion', sub: 'expense-alimentacion-comida-trabajo', day: 5, amount: 40, concept: 'Menú del día', account: CORRIENTE },
  { category: 'expense-alimentacion', sub: 'expense-alimentacion-comida-trabajo', day: 19, amount: 36, concept: 'Menú del día', account: CORRIENTE },
  { category: 'expense-alimentacion', sub: 'expense-alimentacion-cafe', day: 14, amount: 12, concept: 'Cafés de la semana' },
  { category: 'expense-coche', sub: 'expense-coche-gasolina', day: 6, amount: 60, concept: 'Gasolina', account: CORRIENTE },
  { category: 'expense-coche', sub: 'expense-coche-gasolina', day: 21, amount: 55, concept: 'Gasolina', account: CORRIENTE },
  { category: 'expense-deporte-y-bienestar', sub: 'expense-deporte-y-bienestar-gimnasio', day: 2, amount: 40, concept: 'Cuota del gimnasio', account: CORRIENTE },
  { category: 'expense-ocio', sub: 'expense-ocio-comida', day: 15, amount: 38, concept: 'Cena fuera', account: CORRIENTE },
  { category: 'expense-ocio', sub: 'expense-ocio-bebida', day: 22, amount: 24, concept: 'Cañas con amigos', account: CORRIENTE },
  { category: 'expense-ocio', sub: 'expense-ocio-actividades', day: 28, amount: 30, concept: 'Cine', account: CORRIENTE },
];

// Lo que hace que los cuatro meses no sean el mismo mes copiado: sin esto la comparación temporal y la
// evolución del patrimonio saldrían como cuatro barras idénticas. La clave es el nº de mes, 0 el más antiguo.
const EXTRAS: Spec[][] = [
  [{ category: 'expense-vida-personal', sub: 'expense-vida-personal-ropa-y-calzado', day: 16, amount: 120, concept: 'Zapatillas', account: CORRIENTE }],
  [{ category: 'expense-coche', sub: 'expense-coche-mecanico', day: 9, amount: 210, concept: 'Revisión del coche', account: CORRIENTE }],
  [
    { category: 'income', sub: 'income-otros-ingresos', day: 18, amount: 180, concept: 'Venta de segunda mano', type: 'income', account: CORRIENTE },
    { category: 'expense-salud', sub: 'expense-salud-dentista', day: 11, amount: 95, concept: 'Limpieza dental', account: CORRIENTE },
  ],
  [{ category: 'expense-social-familiar', sub: 'expense-social-familiar-regalos', day: 20, amount: 65, concept: 'Regalo de cumpleaños', account: CORRIENTE }],
];

// Traspaso mensual de la corriente al broker. Es la pieza que hace visible por qué el ahorro real no es
// la variación del broker: mover dinero no te hace más rico, y de ahí que solo cuente el aportado.
const BROKER_CONTRIBUTION = 250;
// Lo que pone el mercado cada mes, para que la tabla de rentabilidad no salga toda a cero. El primero
// es 0 porque ese mes no tiene anterior con el que compararse.
const BROKER_RETURNS = [0, 60, -85, 140];
const OPENING = { corriente: 3200, broker: 5400, tarjeta: 420 };

/** El decorado de la demo, generado a partir de `now`. Pura: no toca la base ni el reloj. */
export function demoSeed(now: Date): { accounts: Account[]; closings: Closing[]; movements: Movement[] } {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = Array.from({ length: MONTHS }, (_, i) => shiftMonth(current, i - (MONTHS - 1)));
  const movements: Movement[] = [];
  const savings: number[] = [];
  months.forEach((month, index) => {
    const specs = [...EVERY_MONTH, ...(EXTRAS[index] ?? [])];
    specs.forEach((spec, position) => movements.push({
      // El sello de época, igual que las categorías por defecto: además de marcar "esto es una semilla",
      // es la última red de seguridad, porque el LWW del servidor descartaría estas filas si por
      // cualquier vía acabaran subiendo. Editar un movimiento en la demo lo re-sella con la hora real.
      id: `demo-${month}-${position}`, type: spec.type ?? 'expense', amount: spec.amount,
      date: `${month}-${String(spec.day).padStart(2, '0')}`,
      categoryId: spec.category, subcategoryId: spec.sub, concept: spec.concept,
      ...(spec.account ? { accountId: spec.account } : {}),
      createdAt: EPOCH_UPDATED_AT, updatedAt: EPOCH_UPDATED_AT,
    }));
    savings.push(specs.reduce((total, spec) => total + ((spec.type ?? 'expense') === 'income' ? spec.amount : -spec.amount), 0));
  });
  // Los saldos se DESPEJAN de la identidad que comprueba Patrimonio —ahorro real = ahorro contable— en
  // vez de escribirse a mano:
  //
  //     (corriente_fin − corriente_inicio) + aportado_broker − Δdeuda = ahorro de los movimientos
  //
  // Con la deuda plana y el aportado fijo, lo único que queda por despejar es la corriente. Así el
  // "sin clasificar" del mes sale 0 y la pantalla cuenta una historia coherente en vez de acusar a un
  // decorado de tener movimientos sin registrar.
  const closings: Closing[] = [];
  let corriente = OPENING.corriente, broker = OPENING.broker;
  months.forEach((month, index) => {
    if (index > 0) { broker += BROKER_CONTRIBUTION + BROKER_RETURNS[index]; corriente += savings[index] - BROKER_CONTRIBUTION; }
    const at = (accountId: string, balance: number, contributed?: number) => closings.push({ id: closingId(accountId, month), accountId, month, balance, ...(contributed === undefined ? {} : { contributed }), updatedAt: EPOCH_UPDATED_AT });
    at('demo-corriente', corriente);
    at('demo-broker', broker, BROKER_CONTRIBUTION);
    // La tarjeta no lleva aportado: en un pasivo eso significa "principal amortizado" y cualquier valor
    // aquí corregiría el ahorro contable, descuadrando lo que se acaba de despejar.
    at('demo-tarjeta', OPENING.tarjeta);
  });
  return { accounts: DEMO_ACCOUNTS, closings, movements };
}

/** Deja la base de la demo recién sembrada. Se llama en cada entrada, no en cada recarga. */
// Escribe por db.ts y NO por sync.ts, que es la excepción a la regla del repo y por eso se explica:
// sembrar es cebar la caché, como bootstrapData(), no una escritura de la persona. Pasar por las
// funciones `*Synced` sellaría 80 filas con la hora actual y (fuera de la demo) las encolaría.
export async function resetDemo() {
  await clearAllData(); // vacía los siete stores y resiembra las categorías por defecto
  const { accounts, closings, movements } = demoSeed(new Date());
  await Promise.all([...accounts.map(saveAccount), ...closings.map(saveClosing), ...movements.map(saveMovement)]);
}

/** Sale de la demo sin dejar sus datos tirados en el navegador de quien solo venía a mirar. */
export async function leaveDemo() { await clearAllData(); clearDemoFlag(); location.reload(); }
