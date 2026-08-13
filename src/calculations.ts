import { addMonths, endOfMonth, endOfYear, format, getDaysInMonth, isWithinInterval, parseISO, startOfMonth, startOfYear } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Account, Category, Closing, Movement } from './types';
import { OTROS_ID } from './theme';

export const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const percent = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2 });
export function periodBounds(date: string, mode: 'month'|'year') { const parsed = parseISO(date); return mode === 'month' ? { start: startOfMonth(parsed), end: endOfMonth(parsed) } : { start: startOfYear(parsed), end: endOfYear(parsed) }; }
export function filterPeriod(items: Movement[], date: string, mode: 'month'|'year') { const bounds = periodBounds(date, mode); return items.filter((item) => isWithinInterval(parseISO(item.date), bounds)); }
export function summary(items: Movement[]) { const income = items.reduce((n,m) => n + (m.type === 'income' ? m.amount : 0), 0); const expenses = items.reduce((n,m) => n + (m.type === 'expense' ? m.amount : 0), 0); const savings = income - expenses; return { income, expenses, savings, rate: income ? (savings / income) * 100 : 0 }; }
/** Semana 1..5 dentro del mes, por día natural: 1-7 → 1, 8-14 → 2 … 29-31 → 5.
 *  No son semanas de calendario. La comparten `trendData()` y `weeklyBreakdown()`: si divergieran,
 *  el gráfico y la tabla contarían el mismo gasto en semanas distintas. */
export function weekOfMonth(date: string) { return Math.min(Math.ceil(parseISO(date).getDate()/7), 5); }
/** Columnas de semana que tiene realmente el mes: 4 en febrero de 28 días, 5 en el resto. */
export function weeksInMonth(date: string) { return Math.min(Math.ceil(getDaysInMonth(parseISO(date))/7), 5); }
export function trendData(items: Movement[], date: string, mode: 'month'|'year') {
  const keys = mode === 'month' ? Array.from({length: 5},(_,i)=>String(i+1)) : Array.from({length:12},(_,i)=>String(i));
  return keys.map((key, index) => { const matches = items.filter(m => mode === 'month' ? weekOfMonth(m.date) === Number(key) : parseISO(m.date).getMonth() === Number(key)); const s = summary(matches); return { name: mode === 'month' ? `S${key}` : format(new Date(2024,index,1),'MMM',{locale:es}), ingresos:s.income, gastos:s.expenses, ahorro:s.savings }; });
}
export interface WeeklyRow { id: string; name: string; archived: boolean; weeks: number[]; total: number; percent: number|null }
export interface WeeklyGroup extends WeeklyRow { rows: WeeklyRow[] }
/** Cruce gasto × semana para un mes: filas de subcategoría agrupadas por categoría, con totales por
 *  semana, total del mes y % sobre los ingresos del mes (null si no hay ingresos: nunca dividir entre cero).
 *  `items` debe venir ya filtrado al mes de `date`. */
export function weeklyBreakdown(items: Movement[], categories: Category[], date: string) {
  const weeks = Array.from({length: weeksInMonth(date)},(_,i)=>i+1);
  const expenses = items.filter(m=>m.type==='expense');
  const income = items.reduce((n,m)=>n+(m.type==='income'?m.amount:0),0);
  const percentOf = (total:number) => income ? (total/income)*100 : null;
  const row = (id:string,name:string,archived:boolean,matches:Movement[]):WeeklyRow => { const cells = weeks.map(w=>matches.reduce((n,m)=>n+(weekOfMonth(m.date)===w?m.amount:0),0)); const total = cells.reduce((n,x)=>n+x,0); return {id,name,archived,weeks:cells,total,percent:percentOf(total)}; };
  const groups: WeeklyGroup[] = categories.filter(c=>c.type==='expense').sort((a,b)=>a.order-b.order).map(c=>{
    const own = expenses.filter(m=>m.categoryId===c.id);
    const subs = [...c.subcategories].sort((a,b)=>a.order-b.order).map(s=>row(s.id,s.name,c.archived||s.archived,own.filter(m=>m.subcategoryId===s.id)));
    // Los movimientos sin subcategoría (o con una que ya no existe) tienen que verse: si no, el total
    // de la categoría no cuadraría con la suma de sus filas.
    const loose = own.filter(m=>!c.subcategories.some(s=>s.id===m.subcategoryId));
    return { ...row(c.id,c.name,c.archived,own), rows: loose.length ? [...subs, row(`${c.id}--none`,'Sin subcategoría',c.archived,loose)] : subs };
  });
  // Sin integridad referencial, un `categoryId` puede no resolver (categoría renombrada o borrada a mano).
  // Ese dinero se agrupa aparte en vez de desaparecer: el pie de la tabla debe cuadrar con el KPI de gastos.
  const known = new Set(categories.filter(c=>c.type==='expense').map(c=>c.id));
  const orphans = expenses.filter(m=>!known.has(m.categoryId));
  if (orphans.length) groups.push({ ...row('--orphan','Sin categoría',false,orphans), rows: [] });
  const weekTotals = weeks.map((_,i)=>groups.reduce((n,g)=>n+g.weeks[i],0));
  const total = weekTotals.reduce((n,x)=>n+x,0);
  return { weeks, groups, weekTotals, total, income, percent: percentOf(total) };
}
export function categoryData(items: Movement[], categories: Category[]) { return categories.filter(c=>c.type==='expense').map(c=>({categoryId:c.id,name:c.name,value:items.filter(m=>m.type==='expense'&&m.categoryId===c.id).reduce((n,m)=>n+m.amount,0)})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value); }
/** Recorta la lista (ya ordenada de mayor a menor) a `limit` entradas agrupando la cola en "Otros".
 *  La rampa del donut solo distingue bien 6 tonos; más allá el color deja de informar. `Otros` no es
 *  una categoría real, así que lleva el `categoryId` sentinel `OTROS_ID` en vez del de una categoría. */
export function topCategories(data: {categoryId: string; name: string; value: number}[], limit = 6) {
  if (data.length <= limit) return data;
  const head = data.slice(0, limit - 1);
  const rest = data.slice(limit - 1).reduce((n, x) => n + x.value, 0);
  return [...head, { categoryId: OTROS_ID, name: 'Otros', value: rest }];
}

// ---------------------------------------------------------------------------------------------------
// Patrimonio. Un cierre vive en un MES ('YYYY-MM'), no en una fecha: nada de aquí pasa por
// `filterPeriod` ni por `periodBounds`, que trabajan con días. De ahí estos helpers de mes propios.
// ---------------------------------------------------------------------------------------------------
export const currentMonth = () => format(new Date(), 'yyyy-MM');
/** Mueve un mes `delta` posiciones. Vía date-fns para que el salto de año salga gratis (2026-01 → 2025-12). */
export const shiftMonth = (month: string, delta: number) => format(addMonths(parseISO(`${month}-01`), delta), 'yyyy-MM');
export const previousMonth = (month: string) => shiftMonth(month, -1);
export const monthLabel = (month: string) => format(parseISO(`${month}-01`), 'MMMM yyyy', { locale: es });
/** El id del cierre es determinista a propósito: dos dispositivos que cierren la misma cuenta el mismo
 *  mes convergen a la misma fila y el LWW por fila resuelve el conflicto. Nunca se compone a mano. */
export const closingId = (accountId: string, month: string) => `${accountId}:${month}`;
/** El signo con el que una cuenta entra en el patrimonio. Lo pone la naturaleza, nunca quien teclea:
 *  el saldo siempre es positivo. Así un pasivo tecleado en negativo es imposible por diseño. */
const sign = (account: Account) => (account.nature === 'liability' ? -1 : 1);
/** Un cierre por cuenta: el del mes más alto **con saldo**, porque `balance: null` es "no revisado" y no
 *  puede ganarle a un mes anterior que sí se revisó. Con `before` se acota a meses estrictamente
 *  anteriores, que es lo que necesita la pista en gris del ritual. Entre cierres se muestra el último. */
export function latestClosings(closings: Closing[], before?: string): Closing[] {
  const best = new Map<string, Closing>();
  for (const closing of closings) {
    if (closing.balance === null || (before && closing.month >= before)) continue;
    const current = best.get(closing.accountId);
    if (!current || closing.month > current.month) best.set(closing.accountId, closing);
  }
  return [...best.values()];
}
const sumBalances = (accounts: Account[], closings: Closing[]) => accounts.reduce((total, account) => {
  const balance = closings.find((closing) => closing.accountId === account.id)?.balance;
  return total + (balance == null ? 0 : balance * sign(account));
}, 0);
/** Σ activos − Σ pasivos. Solo entran las cuentas que le pases (el nivel actual las quiere sin archivar)
 *  y solo las que tengan cierre en `closings`: una cuenta sin revisar suma 0, no arrastra el mes pasado. */
export const netWorth = (accounts: Account[], closings: Closing[]) => sumBalances(accounts, closings);
/** El "disponible mañana". `isLiquid` hace dos trabajos con un solo interruptor: suma la corriente y
 *  resta la tarjeta (es líquida y pasivo), ignorando el broker y la hipoteca. */
export const available = (accounts: Account[], closings: Closing[]) => sumBalances(accounts.filter((account) => account.isLiquid), closings);
/** Cuántas cuentas tienen saldo ese mes. Un mes incompleto se pinta como incompleto, no se completa con
 *  lo del mes anterior. */
export function monthCompleteness(accounts: Account[], closings: Closing[], month: string) {
  const reviewed = accounts.filter((account) => closings.some((closing) => closing.accountId === account.id && closing.month === month && closing.balance !== null)).length;
  return { reviewed, total: accounts.length };
}
/** Lee un campo de importe del ritual. Vacío (o basura) es `null` = "no revisado", **nunca 0**:
 *  `Number('') === 0` metería un cero real en la serie histórica cada vez que te saltas una cuenta. */
export function parseAmount(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() === '' || !Number.isFinite(value) ? null : value;
}
/** Los cierres agrupados por mes en un solo recorrido. La escribe F2 y no F1b porque su cliente real es
 *  `netWorthSeries`, que si no haría un `filter` por cada mes de la serie. */
export function closingsByMonth(closings: Closing[]): Map<string, Closing[]> {
  const months = new Map<string, Closing[]>();
  for (const closing of closings) { const list = months.get(closing.month); if (list) list.push(closing); else months.set(closing.month, [closing]); }
  return months;
}
export interface NetWorthPoint { month: string; name: string; value: number|null }
/** La serie del gráfico de evolución, del primer al último mes **con** cierre. Los meses sin cierre
 *  entran como `value: null` para que la línea se corte: emitiendo solo los meses que existen, recharts
 *  uniría los extremos e inventaría una rentabilidad que nadie ganó. Un mes entero vaciado es "sin
 *  cierre", no un patrimonio de 0.
 *  Pásale **todas** las cuentas, también las archivadas: si no, los meses viejos perderían las cuentas
 *  que entonces existían y la serie caería en escalón el día que archivas una.
 *  Un mes revisado a medias entra con lo que sí se revisó (`netWorth` cuenta como 0 la cuenta sin
 *  cierre): la señal de "faltan cuentas" la da `monthDelta`, que puede calcularla sin inventarse
 *  cuándo nació o se archivó cada cuenta. */
export function netWorthSeries(accounts: Account[], closings: Closing[]): NetWorthPoint[] {
  const byMonth = closingsByMonth(closings);
  const reviewed = (month: string) => byMonth.get(month)?.some((closing) => closing.balance !== null) ?? false;
  const months = [...byMonth.keys()].filter(reviewed).sort();
  if (!months.length) return [];
  const series: NetWorthPoint[] = [];
  // Etiqueta corta ('ago 26'): `monthLabel` ('agosto 2026') no cabe en el eje X de un móvil.
  for (let month = months[0]; month <= months[months.length-1]; month = shiftMonth(month, 1))
    series.push({ month, name: format(parseISO(`${month}-01`), 'MMM yy', { locale: es }), value: reviewed(month) ? netWorth(accounts, byMonth.get(month)!) : null });
  return series;
}
interface MonthPair { account: Account; start: number|null; end: number|null; contributed: number }
/** Cada cuenta con su saldo en `month` y en el mes ANTERIOR (`null` si ese mes no se revisó). Lo
 *  comparten `monthDelta` e `investmentReturns` para que el reparto no pueda descuadrar. */
function monthPairs(accounts: Account[], closings: Closing[], month: string): MonthPair[] {
  const previous = previousMonth(month);
  const at = (accountId: string, target: string) => closings.find((closing) => closing.accountId === accountId && closing.month === target && closing.balance !== null);
  return accounts.map((account) => { const end = at(account.id, month); return { account, start: at(account.id, previous)?.balance ?? null, end: end?.balance ?? null, contributed: end?.contributed ?? 0 }; });
}
type ClosedPair = MonthPair & { start: number; end: number };
/** Las cuentas comparables: las que tienen saldo en los dos meses. El resto no entra en ninguna cifra. */
const comparable = (pairs: MonthPair[]) => pairs.filter((pair): pair is ClosedPair => pair.start !== null && pair.end !== null);
/** Lo que una cuenta pone en el ahorro real: la variación entera si no es de inversión, y solo el
 *  aportado si lo es. Los 1.000 € que van de la corriente al broker se cancelan solos —bajan una y
 *  suben el aportado de la otra—, que es justo lo que se busca: mover dinero no te hace más rico. */
const savingsTerm = ({account, start, end, contributed}: ClosedPair) => (account.isInvestment ? contributed : end - start) * sign(account);
/** Lo que una cuenta corrige del ahorro **contable**: en un pasivo, el principal amortizado, que se
 *  registró entero como gasto aunque una parte fuera ahorro. Nunca suma al real (la variación de la
 *  deuda ya lo cuenta), y fuera las de inversión, donde el ahorro real ya **es** el aportado.
 *  Estos dos términos los comparten `monthDelta`, `unclassified` y `unclassifiedByAccount`: si cada uno
 *  los recalculara por su cuenta, el reparto dejaría de sumar el total. */
const correctionTerm = ({account, contributed}: ClosedPair) => (account.nature === 'liability' && !account.isInvestment ? contributed : 0);
export interface AccountReturn { accountId: string; name: string; contributed: number; returns: number }
/** Lo que puso el mercado en cada cuenta de inversión: fin − inicio − aportado. En **euros y jamás en
 *  porcentaje** —el porcentaje ingenuo miente cuando las aportaciones se concentran en el tiempo, y es
 *  justo el número que uno compararía con un índice—. El aportado puede ser negativo (una retirada). */
export function investmentReturns(accounts: Account[], closings: Closing[], month: string): AccountReturn[] {
  return comparable(monthPairs(accounts.filter((account) => account.isInvestment), closings, month))
    .map(({account, start, end, contributed}) => ({ accountId: account.id, name: account.name, contributed, returns: (end - start - contributed) * sign(account) }));
}
export interface MonthDelta { delta: number; realSavings: number; returns: number; complete: boolean }
/** El reparto de un mes contra el **anterior**, nunca contra "el último disponible": comparar agosto con
 *  mayo llamaría rentabilidad a tres meses de ahorro. (La pista en gris del ritual sí usa el último
 *  conocido, `latestClosings(closings, month)` — son dos semánticas distintas a propósito.)
 *  `complete: false` cuando alguna cuenta tiene saldo en **exactamente uno** de los dos meses: se queda
 *  fuera y hay que decirlo. La que no tiene saldo en ninguno de los dos (archivada hace años, o creada
 *  después) no participa ni ensucia el resultado.
 *  Devuelve `null` cuando no hay nada que comparar —primer mes, o mes anterior sin cerrar—: la UI pinta
 *  "—" y no un 0, igual que el `percent: null` de `weeklyBreakdown`. */
export function monthDelta(accounts: Account[], closings: Closing[], month: string): MonthDelta|null {
  const pairs = monthPairs(accounts, closings, month);
  const both = comparable(pairs);
  if (!both.length) return null;
  // La identidad Δ = ahorro + rentabilidad se cumple **por construcción**: es el mismo sumatorio
  // Σ (fin − inicio) · signo partido en dos, así que el reparto no puede descuadrar.
  return {
    delta: both.reduce((total, {account, start, end}) => total + (end - start) * sign(account), 0),
    realSavings: both.reduce((total, pair) => total + savingsTerm(pair), 0),
    returns: investmentReturns(accounts, closings, month).reduce((total, row) => total + row.returns, 0),
    complete: !pairs.some((pair) => (pair.start === null) !== (pair.end === null)),
  };
}
/** El principal amortizado del mes. Sale de las mismas parejas que `monthDelta` y no de filtrar los
 *  cierres del mes: una cuenta que no entra en el ahorro real tampoco puede corregirlo, y colarla
 *  metería una corrección fantasma. */
const liabilityContributed = (pairs: MonthPair[]) => comparable(pairs).reduce((total, pair) => total + correctionTerm(pair), 0);
export interface Unclassified { amount: number; realSavings: number; accountingSavings: number; liabilityContributed: number }
/** El descuadre entre lo que dicen los saldos y lo que dicen los movimientos:
 *
 *      sin clasificar = ahorro real − ahorro contable − principal amortizado de los pasivos
 *
 *  Es la primera medida de si los movimientos están completos: hasta ahora, olvidarse de 300 € de
 *  gastos hacía que `summary()` dijera que ahorraste 300 € de más y nada lo contradecía. **Se muestra,
 *  no se corrige**: generar un movimiento de ajuste falsearía las categorías y contaminaría
 *  `categoryData()`, `weeklyBreakdown()` y `trendData()`.
 *  El ahorro real se toma tal cual de `monthDelta` en vez de recalcularse, porque dos cálculos
 *  paralelos de la misma variación acabarían divergiendo y romperían la identidad Δ = ahorro + rentabilidad.
 *  Por qué el aportado de un pasivo va restando y no sumando al ahorro real: la variación de la deuda
 *  ya cuenta ese principal, así que sumarlo sería contarlo dos veces; lo que corrige es el lado
 *  **contable**, donde la cuota entera se registró como gasto cuando una parte era ahorro.
 *  `null` cuando `monthDelta` no tiene con qué comparar: la UI pinta "—", nunca un 0. */
export function unclassified(accounts: Account[], closings: Closing[], movements: Movement[], month: string): Unclassified|null {
  const delta = monthDelta(accounts, closings, month);
  if (!delta) return null;
  // La única unión permitida entre el mundo mes ('YYYY-MM') y el mundo fecha: los movimientos viven en
  // días y hay que llevarlos al mes del cierre. Es el único sitio del bloque que llama a `filterPeriod`.
  const accountingSavings = summary(filterPeriod(movements, `${month}-01`, 'month')).savings;
  const contributed = liabilityContributed(monthPairs(accounts, closings, month));
  return { amount: delta.realSavings - accountingSavings - contributed, realSavings: delta.realSavings, accountingSavings, liabilityContributed: contributed };
}
export interface AccountUnclassified { accountId: string|null; name: string; realSavings: number; accountingSavings: number; amount: number }
/** El descuadre repartido por cuenta, para **localizar** lo que falta: si sobran 300 €, saber en qué
 *  cuenta reduce mucho la búsqueda del movimiento. Nunca dice *qué* movimiento falta, solo cuánto y dónde.
 *  El invariante que lo sostiene, y que tiene test: **las filas suman exactamente `unclassified().amount`**.
 *  De ahí que entre una fila por cada cuenta comparable *o* con movimientos vinculados, y que la fila
 *  sentinel "Sin cuenta" sea `−ahorro contable de los movimientos sueltos`: ese dinero está en el total
 *  global y tiene que aparecer en algún sitio. Un `accountId` que ya no resuelve cae ahí también, igual
 *  que hace `repairDanglingRefs` al subir.
 *  El reparto es **parcial y así se presenta**: mientras solo una parte de los movimientos lleve cuenta
 *  la cifra por cuenta es una ayuda de diagnóstico, y un traspaso entre cuentas propias —que el modelo
 *  no representa— sale como descuadre negativo en la de origen y positivo en la de destino. Se cancelan
 *  en el total, que es lo que se publica. */
export function unclassifiedByAccount(accounts: Account[], closings: Closing[], movements: Movement[], month: string): AccountUnclassified[]|null {
  if (!monthDelta(accounts, closings, month)) return null;
  const items = filterPeriod(movements, `${month}-01`, 'month');
  const known = new Set(accounts.map((account) => account.id));
  const byAccount = new Map(comparable(monthPairs(accounts, closings, month)).map((pair) => [pair.account.id, pair]));
  const rows: AccountUnclassified[] = [];
  for (const account of accounts) {
    const pair = byAccount.get(account.id);
    const own = items.filter((movement) => movement.accountId === account.id);
    // Una cuenta que no entra en el ahorro real y encima no tiene movimientos no aporta nada al
    // reparto: una fila de ceros solo sería ruido.
    if (!pair && !own.length) continue;
    const realSavings = pair ? savingsTerm(pair) - correctionTerm(pair) : 0;
    const accountingSavings = summary(own).savings;
    rows.push({ accountId: account.id, name: account.name, realSavings, accountingSavings, amount: realSavings - accountingSavings });
  }
  const loose = items.filter((movement) => !movement.accountId || !known.has(movement.accountId));
  if (loose.length) { const accountingSavings = summary(loose).savings; rows.push({ accountId: null, name: 'Sin cuenta', realSavings: 0, accountingSavings, amount: -accountingSavings }); }
  return rows;
}
/** Los meses sin **ningún** cierre revisado, caminando hacia atrás desde `from` y parando en el último
 *  mes que sí se cerró. En orden ascendente, para que el `[0]` sea el más antiguo pendiente y el aviso
 *  pueda llevar ahí directamente. Devuelve `[]` si no hay ni un cierre con saldo: sin histórico no hay
 *  racha de la que avisar (la pantalla vacía ya se explica sola), y de paso es lo que acota el bucle.
 *  La UI le pasa el mes **anterior** al actual: avisar del mes en curso daría la lata desde el día 1.
 *  Los huecos anteriores al último mes cerrado no salen aquí; esos los enseña la serie del gráfico. */
export function monthsWithoutClosing(closings: Closing[], from: string): string[] {
  const reviewed = closings.filter((closing) => closing.balance !== null).map((closing) => closing.month).sort();
  const last = reviewed.at(-1);
  if (!last) return [];
  const missing: string[] = [];
  for (let month = from; month > last; month = previousMonth(month)) missing.push(month);
  return missing.reverse();
}
