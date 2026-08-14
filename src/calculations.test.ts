import { describe, expect, it } from 'vitest';
import { available, closingId, closingsByMonth, filterPeriod, investmentReturns, latestClosings, monthCompleteness, monthDelta, monthsWithoutClosing, netWorth, netWorthSeries, parseAmount, previousMonth, shiftMonth, summary, topCategories, unclassified, unclassifiedByAccount, weeklyBreakdown, weekOfMonth, weeksInMonth } from './calculations';
import { EPOCH_UPDATED_AT } from './data';
import { CATEGORY_LIMIT } from './theme';
import type { Account, Category, Closing, Movement } from './types';
const movement=(type:'income'|'expense',amount:number,date='2026-04-10',categoryId='x',subcategoryId?:string):Movement=>({id:crypto.randomUUID(),type,amount,date,categoryId,subcategoryId,concept:'Test',createdAt:'',updatedAt:''});
const inAccount=(accountId:string,m:Movement):Movement=>({...m,accountId});
describe('cálculos financieros',()=>{it('calcula ingresos, gastos, ahorro y tasa',()=>{expect(summary([movement('income',2000),movement('expense',500)])).toEqual({income:2000,expenses:500,savings:1500,rate:75})});it('evita dividir entre cero',()=>expect(summary([movement('expense',20)]).rate).toBe(0));it('filtra por mes',()=>expect(filterPeriod([movement('income',1),movement('income',1,'2026-05-01')],'2026-04-01','month')).toHaveLength(1));it('filtra por año',()=>expect(filterPeriod([movement('income',1),movement('income',1,'2025-05-01')],'2026-04-01','year')).toHaveLength(1))});
describe('topCategories',()=>{
  const list=(n:number)=>Array.from({length:n},(_,i)=>({categoryId:`c${i}`,name:`C${i}`,value:n-i}));
  it('deja la lista intacta si cabe en el límite',()=>expect(topCategories(list(4),6)).toHaveLength(4));
  it('deja la lista intacta justo en el límite',()=>expect(topCategories(list(6),6)).toHaveLength(6));
  it('agrupa la cola en "Otros"',()=>{const r=topCategories(list(8),6);expect(r).toHaveLength(6);expect(r[5]).toEqual({categoryId:'otros',name:'Otros',value:3+2+1})});
  it('conserva el total',()=>{const d=list(9);const total=d.reduce((n,x)=>n+x.value,0);expect(topCategories(d,6).reduce((n,x)=>n+x.value,0)).toBe(total)});
  // Sin argumento manda la rampa: es lo que evita que ampliarla deje los dos números descuadrados.
  it('sin límite explícito usa el tamaño de la rampa',()=>expect(topCategories(list(20))).toHaveLength(CATEGORY_LIMIT));
});

describe('semanas del mes',()=>{
  it('mapea el día 1 y el 7 a la semana 1',()=>{expect(weekOfMonth('2026-04-01')).toBe(1);expect(weekOfMonth('2026-04-07')).toBe(1)});
  it('mapea el día 8 a la semana 2 y el 28 a la 4',()=>{expect(weekOfMonth('2026-04-08')).toBe(2);expect(weekOfMonth('2026-04-28')).toBe(4)});
  it('agrupa los días 29 al 31 en la semana 5',()=>{expect(weekOfMonth('2026-03-29')).toBe(5);expect(weekOfMonth('2026-03-31')).toBe(5)});
  it('recorta a 4 semanas en febrero de 28 días',()=>expect(weeksInMonth('2026-02-01')).toBe(4));
  it('devuelve 5 semanas en febrero bisiesto',()=>expect(weeksInMonth('2028-02-01')).toBe(5));
  it('devuelve 5 semanas en un mes normal',()=>expect(weeksInMonth('2026-04-15')).toBe(5));
});

describe('weeklyBreakdown',()=>{
  const cat=(id:string,name:string,order:number,subs:[string,string][]):Category=>({id,name,type:'expense',order,archived:false,updatedAt:EPOCH_UPDATED_AT,subcategories:subs.map(([sid,sname],i)=>({id:sid,name:sname,order:i,archived:false,updatedAt:EPOCH_UPDATED_AT}))});
  const categories:Category[]=[{id:'inc',name:'Ingresos',type:'income',order:0,archived:false,updatedAt:EPOCH_UPDATED_AT,subcategories:[]},cat('fijos','Fijos',0,[['piso','Piso'],['luz','Luz']]),cat('ocio','Ocio',1,[['comida','Comida']])];
  const run=(items:Movement[])=>weeklyBreakdown(items,categories,'2026-04-01');
  const group=(items:Movement[],name:string)=>run(items).groups.find(g=>g.name===name)!;
  const spread=[movement('expense',10,'2026-04-03','fijos','piso'),movement('expense',20,'2026-04-10','fijos','piso'),movement('expense',30,'2026-04-25','fijos','piso')];

  it('reparte los gastos en la semana que les toca',()=>expect(group(spread,'Fijos').rows.find(r=>r.name==='Piso')!.weeks).toEqual([10,20,0,30,0]));
  it('cuadra el total de cada fila con la suma de sus semanas',()=>{const piso=group(spread,'Fijos').rows.find(r=>r.name==='Piso')!;expect(piso.total).toBe(piso.weeks.reduce((n,x)=>n+x,0))});
  it('cuadra el total del mes con la suma de los totales de semana',()=>{const g=run([...spread,movement('expense',5,'2026-04-02','ocio','comida')]);expect(g.total).toBe(65);expect(g.weekTotals.reduce((n,x)=>n+x,0)).toBe(g.total)});
  it('suma las subcategorías en el total de su categoría',()=>{const g=group([...spread,movement('expense',7,'2026-04-03','fijos','luz')],'Fijos');expect(g.total).toBe(67);expect(g.rows.reduce((n,r)=>n+r.total,0)).toBe(g.total)});
  it('calcula el porcentaje sobre los ingresos del mes',()=>{const g=run([movement('income',1763.70,'2026-04-01','inc'),movement('expense',480,'2026-04-01','fijos','piso')]);expect(g.groups.find(x=>x.name==='Fijos')!.percent!.toFixed(2)).toBe('27.22')});
  it('deja el porcentaje a null si no hay ingresos',()=>expect(run(spread).percent).toBeNull());
  it('ignora los ingresos en el desglose de gasto',()=>{const g=run([movement('income',900,'2026-04-01','fijos','piso')]);expect(g.total).toBe(0);expect(g.income).toBe(900)});
  it('agrupa en "Sin subcategoría" los movimientos sin subcategoryId',()=>{const g=group([movement('expense',12,'2026-04-03','fijos')],'Fijos');expect(g.rows.at(-1)).toMatchObject({name:'Sin subcategoría',total:12});expect(g.total).toBe(12)});
  it('agrupa en "Sin subcategoría" las subcategorías huérfanas',()=>{const g=group([movement('expense',12,'2026-04-03','fijos','ya-no-existe')],'Fijos');expect(g.rows.at(-1)).toMatchObject({name:'Sin subcategoría',total:12})});
  it('agrupa en "Sin categoría" los movimientos con categoryId huérfano',()=>{const g=run([movement('expense',40,'2026-04-03','borrada')]);expect(g.groups.at(-1)).toMatchObject({name:'Sin categoría',total:40});expect(g.total).toBe(40)});
  it('no inventa la fila "Sin subcategoría" si no hace falta',()=>expect(group(spread,'Fijos').rows.map(r=>r.name)).toEqual(['Piso','Luz']));
  it('respeta el orden de categorías y subcategorías',()=>expect(run([]).groups.map(g=>g.name)).toEqual(['Fijos','Ocio']));
  it('usa solo las semanas reales del mes',()=>expect(weeklyBreakdown([],categories,'2026-02-01').weeks).toEqual([1,2,3,4]));
});

describe('meses de los cierres',()=>{
  it('retrocede un mes',()=>expect(previousMonth('2026-03')).toBe('2026-02'));
  it('cruza el año hacia atrás',()=>expect(previousMonth('2026-01')).toBe('2025-12'));
  it('cruza el año hacia delante',()=>expect(shiftMonth('2026-12',1)).toBe('2027-01'));
  it('compone el id determinista del cierre',()=>expect(closingId('broker','2026-03')).toBe('broker:2026-03'));
});

describe('importes tecleados en el ritual',()=>{
  // Number('') es 0, y ese cero acabaría en la serie histórica como un saldo real cada vez que te
  // saltas una cuenta. Vacío significa "no revisado", que es información distinta de "tengo 0 €".
  it('lee el campo vacío como "no revisado", no como cero',()=>{expect(parseAmount('')).toBeNull();expect(parseAmount('   ')).toBeNull()});
  it('lee un cero tecleado a mano como cero de verdad',()=>expect(parseAmount('0')).toBe(0));
  it('lee decimales',()=>expect(parseAmount('1.5')).toBe(1.5));
  it('lee la basura como "no revisado"',()=>expect(parseAmount('abc')).toBeNull());
});

const account=(id:string,nature:'asset'|'liability'='asset',flags:Partial<Account>={}):Account=>({id,name:id,nature,isInvestment:false,isLiquid:false,archived:false,order:0,updatedAt:EPOCH_UPDATED_AT,...flags});
const closing=(accountId:string,month:string,balance:number|null,contributed?:number):Closing=>({id:closingId(accountId,month),accountId,month,balance,...(contributed===undefined?{}:{contributed}),updatedAt:EPOCH_UPDATED_AT});
// El ejemplo de la sección 6 del diseño del dominio, que es la prueba de que el modelo cuadra. Vive
// fuera de los describe porque el nivel y la evolución se miden sobre los mismos tres meses.
const corriente=account('corriente','asset',{isLiquid:true});
const broker=account('broker','asset',{isInvestment:true});
const hipoteca=account('hipoteca','liability');
const ejemplo=[corriente,broker,hipoteca];
const febrero=[closing('corriente','2026-02',10000),closing('broker','2026-02',5000),closing('hipoteca','2026-02',100000)];
const marzo=[closing('corriente','2026-03',9500),closing('broker','2026-03',6200,1000),closing('hipoteca','2026-03',99700,0)];
const abril=[closing('corriente','2026-04',9000),closing('broker','2026-04',6000),closing('hipoteca','2026-04',99400)];

describe('patrimonio',()=>{
  it('resta el pasivo aunque el saldo se teclee en positivo',()=>expect(netWorth([account('deuda','liability')],[closing('deuda','2026-03',300)])).toBe(-300));
  it('calcula el patrimonio neto de febrero del ejemplo',()=>expect(netWorth(ejemplo,febrero)).toBe(-85000));
  it('calcula el patrimonio neto de marzo del ejemplo',()=>expect(netWorth(ejemplo,marzo)).toBe(-84000));
  it('ignora las cuentas sin cierre en vez de arrastrar el mes anterior',()=>expect(netWorth(ejemplo,[closing('corriente','2026-03',9500)])).toBe(9500));
  it('ignora un cierre vaciado',()=>expect(netWorth(ejemplo,[closing('corriente','2026-03',9500),closing('broker','2026-03',null)])).toBe(9500));
  it('ignora los cierres de cuentas que no le pasas',()=>expect(netWorth([corriente],marzo)).toBe(9500));

  it('suma solo las cuentas líquidas en el disponible',()=>{const tarjeta=account('tarjeta','liability',{isLiquid:true});expect(available([corriente,broker,hipoteca,tarjeta],[...marzo,closing('tarjeta','2026-03',200)])).toBe(9300)});
  it('resta la tarjeta, que es líquida y pasivo',()=>{const tarjeta=account('tarjeta','liability',{isLiquid:true});expect(available([corriente,tarjeta],[closing('corriente','2026-03',1000),closing('tarjeta','2026-03',200)])).toBe(800)});

  it('se queda con el cierre más reciente de cada cuenta',()=>expect(latestClosings([...febrero,...marzo]).map(c=>c.month)).toEqual(['2026-03','2026-03','2026-03']));
  it('ignora los cierres vaciados y cae al último con saldo',()=>expect(latestClosings([closing('corriente','2026-02',10000),closing('corriente','2026-03',null)])).toEqual([closing('corriente','2026-02',10000)]));
  it('acota a los meses anteriores para la pista del ritual',()=>expect(latestClosings([...febrero,...marzo],'2026-03').map(c=>c.balance)).toEqual([10000,5000,100000]));
  it('salta los meses sin revisar al buscar la pista',()=>expect(latestClosings([closing('corriente','2026-01',1000),closing('corriente','2026-02',null)],'2026-03')).toEqual([closing('corriente','2026-01',1000)]));

  it('cuenta cuántas cuentas se han revisado ese mes',()=>expect(monthCompleteness(ejemplo,marzo,'2026-03')).toEqual({reviewed:3,total:3}));
  it('no cuenta como revisada una cuenta vaciada',()=>expect(monthCompleteness(ejemplo,[closing('corriente','2026-03',9500),closing('broker','2026-03',null)],'2026-03')).toEqual({reviewed:1,total:3}));
  it('no cuenta los cierres de otros meses',()=>expect(monthCompleteness(ejemplo,febrero,'2026-03')).toEqual({reviewed:0,total:3}));

  it('agrupa los cierres por mes sin perder ninguno',()=>{const meses=closingsByMonth([...febrero,...marzo]);expect([...meses.keys()].sort()).toEqual(['2026-02','2026-03']);expect(meses.get('2026-02')).toHaveLength(3)});
});

describe('evolución del patrimonio',()=>{
  // El ejemplo de la sección 6 del diseño al completo: es la prueba de que el modelo cuadra.
  it('reparte el Δ del ejemplo en 800 de ahorro y 200 de rentabilidad',()=>expect(monthDelta(ejemplo,[...febrero,...marzo],'2026-03')).toEqual({delta:1000,realSavings:800,returns:200,complete:true}));
  it('cumple la identidad Δ = ahorro + rentabilidad',()=>{const mes=monthDelta(ejemplo,[...febrero,...marzo],'2026-03')!;expect(mes.realSavings+mes.returns).toBe(mes.delta)});
  // Mover 1.000 € de la corriente al broker no te hace más rico: baja una y sube el aportado de la otra.
  it('no cuenta el traspaso al broker como ahorro extra',()=>expect(monthDelta([corriente,broker],[closing('corriente','2026-02',10000),closing('broker','2026-02',5000),closing('corriente','2026-03',9000),closing('broker','2026-03',6000,1000)],'2026-03')).toEqual({delta:0,realSavings:0,returns:0,complete:true}));
  it('detalla la rentabilidad por cuenta de inversión',()=>expect(investmentReturns(ejemplo,[...febrero,...marzo],'2026-03')).toEqual([{accountId:'broker',name:'broker',contributed:1000,returns:200}]));
  // Una retirada es aportado negativo: sale del ahorro, no de lo que puso el mercado.
  it('lee una retirada del broker como aportado negativo',()=>expect(monthDelta([broker],[closing('broker','2026-02',5000),closing('broker','2026-03',4200,-1000)],'2026-03')).toEqual({delta:-800,realSavings:-1000,returns:200,complete:true}));

  it('compara contra el mes anterior, no contra el último disponible',()=>expect(monthDelta(ejemplo,[...febrero,...abril],'2026-04')).toBeNull());
  it('devuelve null en el primer mes, para pintar "—" y no un 0',()=>expect(monthDelta(ejemplo,marzo,'2026-03')).toBeNull());
  it('excluye la cuenta que solo tiene saldo en uno de los dos meses',()=>expect(monthDelta(ejemplo,[...febrero,closing('corriente','2026-03',9500),closing('broker','2026-03',6200,1000)],'2026-03')).toEqual({delta:700,realSavings:500,returns:200,complete:false}));
  it('no marca incompleto por una cuenta sin saldo en ninguno de los dos meses',()=>expect(monthDelta([...ejemplo,account('vieja','asset',{archived:true})],[...febrero,...marzo,closing('vieja','2025-01',400)],'2026-03')).toMatchObject({delta:1000,complete:true}));

  it('construye la serie del primer al último mes con cierre',()=>expect(netWorthSeries(ejemplo,[...febrero,...marzo]).map(p=>p.value)).toEqual([-85000,-84000]));
  // Si solo se emitieran los meses que existen, recharts uniría febrero con abril e inventaría una
  // rentabilidad que nadie ganó. El hueco es el dato.
  it('corta la línea en el mes sin cierre en vez de interpolarlo',()=>{const serie=netWorthSeries(ejemplo,[...febrero,...abril]);expect(serie.map(p=>p.month)).toEqual(['2026-02','2026-03','2026-04']);expect(serie.map(p=>p.value)).toEqual([-85000,null,-84400])});
  it('trata un mes entero vaciado como hueco, no como un patrimonio de 0',()=>expect(netWorthSeries(ejemplo,[...febrero,...ejemplo.map(a=>closing(a.id,'2026-03',null)),...abril]).map(p=>p.value)).toEqual([-85000,null,-84400]));
  it('mantiene en la serie las cuentas archivadas',()=>expect(netWorthSeries([...ejemplo,account('vieja','asset',{archived:true})],[...febrero,closing('vieja','2026-02',1000)]).map(p=>p.value)).toEqual([-84000]));
  it('devuelve una serie vacía si no hay ningún cierre con saldo',()=>expect(netWorthSeries(ejemplo,[closing('corriente','2026-03',null)])).toEqual([]));
  it('etiqueta cada punto con el mes abreviado para que quepa en el eje',()=>expect(netWorthSeries(ejemplo,marzo)[0].name).toBe('mar 26'));
});

describe('sin clasificar',()=>{
  // Los movimientos de marzo del ejemplo de la sección 6: 2.000 de ingresos y 1.500 de gastos, de los
  // que 400 son la cuota de la hipoteca. El ahorro contable son 500.
  const movimientos=[movement('income',2000,'2026-03-05'),movement('expense',1100,'2026-03-12'),movement('expense',400,'2026-03-28')];
  const marzoConPrincipal=[closing('corriente','2026-03',9500),closing('broker','2026-03',6200,1000),closing('hipoteca','2026-03',99700,300)];

  // El descuadre del ejemplo NO es un error: son exactamente los 300 € de principal amortizado de la
  // hipoteca. Contablemente pagaste 400 € de gasto; en la realidad 100 fueron intereses y 300, ahorro
  // en forma de menos deuda. Con un préstamo esto aparecerá todos los meses.
  it('saca los 300 € del principal de la hipoteca cuando nadie lo teclea',()=>expect(unclassified(ejemplo,[...febrero,...marzo],movimientos,'2026-03')).toEqual({amount:300,realSavings:800,accountingSavings:500,liabilityContributed:0}));
  it('cuadra en cero cuando se teclea el principal amortizado',()=>expect(unclassified(ejemplo,[...febrero,...marzoConPrincipal],movimientos,'2026-03')).toMatchObject({amount:0,liabilityContributed:300}));
  // El principal corrige el lado contable, no el real: si sumara al ahorro real contaría dos veces la
  // misma bajada de deuda, que la variación del saldo ya recoge.
  it('no toca el ahorro real al teclear el principal',()=>expect(unclassified(ejemplo,[...febrero,...marzoConPrincipal],movimientos,'2026-03')!.realSavings).toBe(800));
  it('sin movimientos, todo el ahorro real está sin clasificar',()=>expect(unclassified(ejemplo,[...febrero,...marzo],[],'2026-03')!.amount).toBe(800));
  it('ignora los movimientos de otros meses',()=>expect(unclassified(ejemplo,[...febrero,...marzo],[...movimientos,movement('expense',900,'2026-04-02')],'2026-03')!.amount).toBe(300));
  it('devuelve null sin mes anterior con el que comparar, para pintar "—" y no un 0',()=>expect(unclassified(ejemplo,marzo,movimientos,'2026-03')).toBeNull());
  // Una cuenta que no entra en el ahorro real tampoco puede corregirlo: su principal metería una
  // corrección fantasma que descuadraría la cifra en la dirección contraria.
  it('no corrige con el principal de un pasivo que no está en los dos meses',()=>expect(unclassified(ejemplo,[closing('corriente','2026-02',10000),closing('corriente','2026-03',9500),closing('hipoteca','2026-03',99700,300)],[],'2026-03')).toMatchObject({amount:-500,liabilityContributed:0}));
});

describe('sin clasificar por cuenta',()=>{
  const movimientos=[movement('income',2000,'2026-03-05'),movement('expense',1100,'2026-03-12'),movement('expense',400,'2026-03-28')];
  const cierres=[...febrero,...marzo];
  const reparto=(items:Movement[])=>unclassifiedByAccount(ejemplo,cierres,items,'2026-03')!;
  const suma=(items:Movement[])=>reparto(items).reduce((n,r)=>n+r.amount,0);

  // El invariante de la fase: el global sigue siendo exacto, y el reparto tiene que sumarlo. Sin esto,
  // un desglose que no cuadra con la cifra de arriba es peor que no tener desglose.
  it('las filas suman exactamente el descuadre global',()=>expect(suma(movimientos)).toBe(unclassified(ejemplo,cierres,movimientos,'2026-03')!.amount));
  it('sigue sumándolo con los movimientos ya vinculados',()=>{const items=[inAccount('corriente',movimientos[0]),inAccount('corriente',movimientos[1]),inAccount('hipoteca',movimientos[2])];expect(suma(items)).toBe(unclassified(ejemplo,cierres,items,'2026-03')!.amount)});

  // Sin vincular nada, todo el flujo contable cae en la fila sentinel: ese dinero está en el total y
  // tiene que verse en algún sitio, aunque todavía no se sepa de qué cuenta salió.
  it('mete en "Sin cuenta" los movimientos sin vincular',()=>expect(reparto(movimientos).find(r=>r.accountId===null)).toEqual({accountId:null,name:'Sin cuenta',realSavings:0,accountingSavings:500,amount:-500}));
  it('no inventa la fila "Sin cuenta" cuando todo está vinculado',()=>expect(reparto(movimientos.map(m=>inAccount('corriente',m))).some(r=>r.accountId===null)).toBe(false));
  it('trata como suelto un movimiento cuya cuenta ya no existe',()=>expect(reparto([inAccount('borrada',movimientos[0])]).find(r=>r.accountId===null)?.accountingSavings).toBe(2000));

  it('atribuye a la corriente su variación y sus movimientos',()=>expect(reparto([inAccount('corriente',movimientos[0]),inAccount('corriente',movimientos[1])]).find(r=>r.accountId==='corriente')).toEqual({accountId:'corriente',name:'corriente',realSavings:-500,accountingSavings:900,amount:-1400}));
  // El principal amortizado corrige también aquí: la hipoteca aporta +300 de ahorro real y su fila lo
  // descuenta, igual que hace el global.
  it('descuenta el principal amortizado en la fila del pasivo',()=>{const cierresConPrincipal=[...febrero,closing('corriente','2026-03',9500),closing('broker','2026-03',6200,1000),closing('hipoteca','2026-03',99700,300)];expect(unclassifiedByAccount(ejemplo,cierresConPrincipal,[],'2026-03')!.find(r=>r.accountId==='hipoteca')!.realSavings).toBe(0)});

  // Un traspaso no está modelado: sale de una cuenta y entra en otra, y si se registra en las dos puntas
  // ensucia el reparto con dos filas que se cancelan. El total, que es lo que se publica, no se entera.
  it('un traspaso vinculado en las dos puntas se cancela en el total',()=>{
    const traspaso=[inAccount('corriente',movement('expense',1000,'2026-03-15')),inAccount('broker',movement('income',1000,'2026-03-15'))];
    const filas=reparto(traspaso);
    expect(filas.find(r=>r.accountId==='corriente')!.accountingSavings).toBe(-1000);
    expect(filas.find(r=>r.accountId==='broker')!.accountingSavings).toBe(1000);
    expect(suma(traspaso)).toBe(unclassified(ejemplo,cierres,traspaso,'2026-03')!.amount);
  });

  it('omite la cuenta que no entra en el reparto ni tiene movimientos',()=>expect(unclassifiedByAccount([...ejemplo,account('vieja')],cierres,[],'2026-03')!.map(r=>r.accountId)).toEqual(['corriente','broker','hipoteca']));
  it('devuelve null sin mes anterior con el que comparar',()=>expect(unclassifiedByAccount(ejemplo,marzo,movimientos,'2026-03')).toBeNull());
});

describe('meses sin cerrar',()=>{
  it('avisa de enero cuando el último cierre es de diciembre',()=>expect(monthsWithoutClosing([closing('corriente','2025-12',1000)],'2026-01')).toEqual(['2026-01']));
  it('no avisa de nada si el mes ya está cerrado',()=>expect(monthsWithoutClosing([closing('corriente','2026-03',1000)],'2026-03')).toEqual([]));
  // Ascendente para que el [0] sea el más antiguo pendiente: es el mes al que lleva el aviso.
  it('devuelve la racha entera, del más antiguo al más reciente',()=>expect(monthsWithoutClosing([closing('corriente','2026-05',1000)],'2026-08')).toEqual(['2026-06','2026-07','2026-08']));
  it('no cuenta como cerrado un mes vaciado',()=>expect(monthsWithoutClosing([closing('corriente','2026-05',1000),closing('corriente','2026-07',null)],'2026-07')).toEqual(['2026-06','2026-07']));
  it('calla si todavía no hay ningún cierre',()=>expect(monthsWithoutClosing([],'2026-08')).toEqual([]));
});
