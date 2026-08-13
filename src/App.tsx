import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDownLeft, ArrowUpRight, BarChart3, CalendarRange, ChevronDown, ChevronUp, CirclePlus, Landmark, LayoutDashboard, List, Pencil, Plus, Search, Settings2, Table2, Trash2, WalletCards, X } from 'lucide-react';
import { addMonths, addYears, format, parseISO, subMonths, subYears } from 'date-fns';
import { es } from 'date-fns/locale';
import { categoryData, filterPeriod, money, percent, summary, topCategories, trendData, weeklyBreakdown } from './calculations';
import type { WeeklyRow } from './calculations';
import { CATEGORY_LIMIT } from './theme';
import { bootstrapData, getAllData, loadPreferences, savePreferences } from './db';
// Las escrituras pasan por sync.ts y no por db.ts: además de guardar en IndexedDB encolan la
// operación para subirla. Las lecturas y las preferencias (que no se sincronizan) siguen en db.ts.
import { clearAllDataSynced, getSyncState, initSync, removeMovementSynced, saveCategorySynced, saveMovementSynced, subscribeSyncState } from './sync';
import { onAuthChange, resolveUserId, signOut } from './supabase';
import { SyncChip, SyncNote } from './SyncStatus';
import { needsAttention, syncCopy } from './syncCopy';
import Login from './Login';
import Patrimonio from './Patrimonio';
import { Empty, Stat } from './Ui';
import type { Account, Category, Closing, Movement, MovementType, Preferences } from './types';
const TrendChart = lazy(() => import('./Charts').then(m=>({default:m.TrendChart})));
const ExpenseChart = lazy(() => import('./Charts').then(m=>({default:m.ExpenseChart})));
const WeeklyChart = lazy(() => import('./Charts').then(m=>({default:m.WeeklyChart})));

// [id, icono, etiqueta del nav, título de la cabecera]. Fuente única: la usan el nav lateral,
// el nav móvil y el <h1>, que antes repetían la misma lista tres veces.
const pages = [['summary',LayoutDashboard,'Resumen','Resumen financiero'],['weekly',Table2,'Semanal','Desglose semanal'],['movements',List,'Movimientos','Movimientos'],['patrimonio',Landmark,'Patrimonio','Patrimonio'],['categories',Settings2,'Categorías','Categorías']] as const;
type Page = typeof pages[number][0];
const today = format(new Date(),'yyyy-MM-dd');
const blank = (): Omit<Movement,'id'|'createdAt'|'updatedAt'> => ({type:'expense',amount:0,date:today,categoryId:'',concept:'',notes:''});

// Gate de sesión. Vive en su propio componente porque los hooks de Finances no pueden ser
// condicionales: sin sesión ni siquiera se monta, así que tampoco se siembran las categorías por
// defecto (bootstrapData) antes de saber qué hay en el servidor.
export default function App() {
  const [userId,setUserId]=useState<string|null|undefined>(undefined); // undefined = comprobando
  // El `prev===undefined` es la carrera real: si el usuario entra mientras resolveUserId sigue en
  // vuelo, SIGNED_IN ya habría fijado el id y la resolución inicial (null) lo pisaría devolviéndolo
  // al login. La suscripción manda; resolveUserId solo rellena el hueco inicial.
  useEffect(()=>{resolveUserId().then(id=>setUserId(prev=>prev===undefined?id:prev));return onAuthChange(setUserId)},[]);
  if(userId===undefined)return <div className="loading">Comprobando tu sesión…</div>;
  if(userId===null)return <Login/>;
  // key: cambiar de usuario remonta el árbol entero, así ningún estado sobrevive al cambio.
  return <Finances key={userId}/>;
}

function Finances() {
  const [page,setPage]=useState<Page>('summary'); const [movements,setMovements]=useState<Movement[]>([]); const [categories,setCategories]=useState<Category[]>([]); const [accounts,setAccounts]=useState<Account[]>([]); const [closings,setClosings]=useState<Closing[]>([]); const [prefs,setPrefs]=useState<Preferences>({periodMode:'month',selectedDate:today}); const [loading,setLoading]=useState(true); const [notice,setNotice]=useState(''); const [modal,setModal]=useState(false); const [editing,setEditing]=useState<Movement|null>(null);
  const reload=async()=>{const data=await getAllData();setMovements(data.movements);setCategories(data.categories.sort((a,b)=>a.order-b.order));setAccounts(data.accounts.sort((a,b)=>a.order-b.order));setClosings(data.closings);};
  // El sync necesita poder recargar la pantalla cuando el pull trae algo, pero `reload` es una
  // función nueva en cada render: capturarla directamente congelaría la primera. El ref siempre
  // apunta a la vigente. `dead` cubre el doble montaje de StrictMode, que en desarrollo ejecutaría
  // initSync dos veces y dejaría los listeners del primero sueltos.
  const reloadRef=useRef(reload); useEffect(()=>{reloadRef.current=reload});
  useEffect(()=>{let stop:(()=>void)|undefined;let dead=false;(async()=>{await bootstrapData();await reload();const saved=await loadPreferences();if(saved)setPrefs(saved);setLoading(false);if(!dead)stop=initSync(()=>reloadRef.current())})();return()=>{dead=true;stop?.()}},[]);
  useEffect(()=>{if(!loading)savePreferences(prefs)},[prefs,loading]);
  const inPeriod=useMemo(()=>filterPeriod(movements,prefs.selectedDate,prefs.periodMode),[movements,prefs]); const totals=useMemo(()=>summary(inPeriod),[inPeriod]);
  // useCallback para poder usarlo como dependencia de los efectos de aviso sin rearmarlos en cada render.
  const flash=useCallback((text:string)=>{setNotice(text);window.setTimeout(()=>setNotice(''),2500)},[]);
  // Un único suscriptor al estado del sync; de aquí baja por props al chip y a la nota del aside.
  const sync=useSyncExternalStore(subscribeSyncState,getSyncState);
  // Los avisos salen de la propia suscripción y no de un efecto sobre `sync`: aquí se ve el estado
  // anterior y el nuevo sin compararlos entre renders. Solo se anuncia lo que no se deduce de la
  // pantalla —quedarse sin red, un sync fallido, la sesión caducada— y nunca el ciclo syncing→idle
  // del sondeo de cada minuto. Reutiliza la región aria-live de abajo en vez de crear una segunda.
  useEffect(()=>{let last=getSyncState();return subscribeSyncState(next=>{
    if(next.status!==last.status&&needsAttention(next))flash(syncCopy(next).label);
    if(next.lastError&&next.lastError!==last.lastError)flash(next.lastError);
    last=next;
  })},[flash]);
  const openForm=(movement?:Movement)=>{setEditing(movement||null);setModal(true)};
  const onSaved=async(m:Movement)=>{await saveMovementSynced(m);await reload();setModal(false);flash(editing?'Movimiento actualizado':'Movimiento añadido')};
  const deleteOne=async(m:Movement)=>{if(confirm(`¿Eliminar “${m.concept}”? Esta acción no se puede deshacer.`)){await removeMovementSynced(m.id);await reload();flash('Movimiento eliminado')}};
  if(loading)return <div className="loading">Preparando tu espacio financiero…</div>;
  return <div className="app-shell">
    <aside><div className="brand"><span><WalletCards/></span><div><b>FinHub</b><small>Finanzas personales</small></div></div><nav>{pages.map(([id,Icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon/>{label}</button>)}</nav><SyncNote state={sync} onSignOut={()=>{void signOut()}}/></aside>
    {/* El chip vive en la cabecera y no solo en el aside porque el aside desaparece por debajo de
        760px, que es justo el caso en el que saber si el móvil ha sincronizado importa más. */}
    <main><header><div><span className="eyebrow">Tu dinero, con claridad</span><h1>{pages.find(p=>p[0]===page)![3]}</h1></div><div className="header-side"><SyncChip state={sync}/>{page!=='categories'&&page!=='patrimonio'&&<button className="primary" onClick={()=>openForm()}><Plus/>Nuevo movimiento</button>}</div></header>
    {page==='summary'&&<Summary prefs={prefs} setPrefs={setPrefs} totals={totals} items={inPeriod} categories={categories}/>}
    {page==='weekly'&&<Weekly prefs={prefs} setPrefs={setPrefs} movements={movements} categories={categories}/>}
    {page==='movements'&&<Movements items={movements} categories={categories} accounts={accounts} onEdit={openForm} onDelete={deleteOne}/>}
    {page==='patrimonio'&&<Patrimonio accounts={accounts} closings={closings} movements={movements} reload={reload} onNotice={flash}/>}
    {page==='categories'&&<Categories categories={categories} reload={reload} onNotice={flash}/>}
    </main><div className="mobile-nav">{pages.map(([id,Icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon/><small>{label}</small></button>)}</div>
    {modal&&<MovementModal initial={editing} categories={categories} accounts={accounts} onClose={()=>setModal(false)} onSave={onSaved}/>}<div className="sr-live" aria-live="polite">{notice}</div>{notice&&<div className="toast">{notice}</div>}
  </div>;
}

const monthTitle=(date:string)=>format(parseISO(date),'MMMM yyyy',{locale:es});
/** Barra de periodo compartida. Con `modes={false}` (vista semanal) desaparece el selector Mes/Año y
 *  las flechas se mueven siempre de mes en mes, sin tocar el `periodMode` global que usa el Resumen. */
function PeriodBar({prefs,setPrefs,modes=true}:{prefs:Preferences;setPrefs:(p:Preferences)=>void;modes?:boolean}){
  const byYear=modes&&prefs.periodMode==='year';
  const shift=(d:number)=>{const date=parseISO(prefs.selectedDate);setPrefs({...prefs,selectedDate:format(byYear?(d>0?addYears(date,1):subYears(date,1)):(d>0?addMonths(date,1):subMonths(date,1)),'yyyy-MM-dd')})};
  return <section className="period-bar">{modes?<div className="segmented"><button className={prefs.periodMode==='month'?'active':''} onClick={()=>setPrefs({...prefs,periodMode:'month'})}>Mes</button><button className={prefs.periodMode==='year'?'active':''} onClick={()=>setPrefs({...prefs,periodMode:'year'})}>Año</button></div>:<span/>}<div className="period-nav"><button aria-label="Periodo anterior" onClick={()=>shift(-1)}>‹</button><strong>{byYear?format(parseISO(prefs.selectedDate),'yyyy'):monthTitle(prefs.selectedDate)}</strong><button aria-label="Periodo siguiente" onClick={()=>shift(1)}>›</button></div></section>;
}

function Summary({prefs,setPrefs,totals,items,categories}:{prefs:Preferences;setPrefs:(p:Preferences)=>void;totals:ReturnType<typeof summary>;items:Movement[];categories:Category[]}){
  const trend=trendData(items,prefs.selectedDate,prefs.periodMode); const cat=topCategories(categoryData(items,categories),CATEGORY_LIMIT);
  return <><PeriodBar prefs={prefs} setPrefs={setPrefs}/>
  <section className="stats"><Stat label="Ingresos" value={totals.income} icon={<ArrowUpRight/>} tone="green"/><Stat label="Gastos" value={totals.expenses} icon={<ArrowDownLeft/>} tone="red"/><Stat label="Ahorro" value={totals.savings} icon={<WalletCards/>} tone={totals.savings>=0?'neutral':'red'}/><Stat label="Tasa de ahorro" text={`${totals.rate.toFixed(1)} %`} icon={<BarChart3/>} tone="neutral"/></section>
  {items.length===0?<Empty icon={<BarChart3/>} title="Todavía no hay datos en este periodo" text="Añade tu primer ingreso o gasto para empezar a ver la evolución de tus finanzas."/>:<Suspense fallback={<div className="chart-loading">Dibujando gráficos…</div>}><section className="charts"><article className="chart wide"><h2>Evolución del periodo</h2><p>Ingresos, gastos y ahorro</p><TrendChart data={trend}/></article><article className="chart"><h2>Gastos por categoría</h2><p>Dónde se va tu dinero</p><ExpenseChart data={cat}/></article><article className="chart"><h2>Comparación temporal</h2><p>{prefs.periodMode==='month'?'Vista semanal':'Vista mensual'}</p><WeeklyChart data={trend}/></article></section></Suspense>}</>;
}

function Weekly({prefs,setPrefs,movements,categories}:{prefs:Preferences;setPrefs:(p:Preferences)=>void;movements:Movement[];categories:Category[]}){
  const [showEmpty,setShowEmpty]=useState(false);
  // Siempre por mes: la vista semanal ignora prefs.periodMode a propósito, así navegar aquí no
  // cambia el modo que verá el Resumen. Lo que sí se comparte es selectedDate.
  const inMonth=useMemo(()=>filterPeriod(movements,prefs.selectedDate,'month'),[movements,prefs.selectedDate]);
  const grid=useMemo(()=>weeklyBreakdown(inMonth,categories,prefs.selectedDate),[inMonth,categories,prefs.selectedDate]);
  const groups=showEmpty?grid.groups:grid.groups.filter(g=>g.total>0).map(g=>({...g,rows:g.rows.filter(r=>r.total>0)}));
  // Celda vacía como guion, no como "0,00 €": en una rejilla de 8 columnas los ceros tapan los importes reales.
  const cash=(v:number)=>v?money.format(v):<span className="zero">—</span>;
  const cells=(r:WeeklyRow)=><>{r.weeks.map((v,i)=><td key={i} className="amount">{cash(v)}</td>)}<td className="amount total">{cash(r.total)}</td><td className="amount">{r.percent===null||!r.total?<span className="zero">—</span>:percent.format(r.percent/100)}</td></>;
  return <><PeriodBar prefs={prefs} setPrefs={setPrefs} modes={false}/>
  <div className="weekly-toolbar"><p>{grid.income?<>Gasto por categoría y semana. Los porcentajes son sobre los ingresos del mes: <b className="income">{money.format(grid.income)}</b>.</>:'Gasto por categoría y semana. Sin ingresos registrados este mes, la columna % queda vacía.'}</p><label className="switch"><input type="checkbox" checked={showEmpty} onChange={e=>setShowEmpty(e.target.checked)}/>Mostrar categorías sin gasto</label></div>
  {grid.total===0?<Empty icon={<CalendarRange/>} title="Sin gastos este mes" text="Cuando registres gastos verás aquí en qué semana se fue cada euro, categoría por categoría."/>:<div className="table-wrap weekly-table"><table>
    <caption className="sr-only">Gasto por categoría y semana de {monthTitle(prefs.selectedDate)}</caption>
    <thead><tr><th scope="col">Categoría</th>{grid.weeks.map(w=><th key={w} scope="col" className="amount">Semana {w}</th>)}<th scope="col" className="amount">Total mes</th><th scope="col" className="amount">%</th></tr></thead>
    <tbody>{groups.map(g=><Fragment key={g.id}><tr className={`group-row ${g.archived?'archived':''}`}><th scope="row">{g.name}</th>{cells(g)}</tr>{g.rows.map(r=><tr key={r.id} className={r.archived?'archived':''}><th scope="row">{r.name}</th>{cells(r)}</tr>)}</Fragment>)}</tbody>
    <tfoot><tr><th scope="row">Total semana</th>{grid.weekTotals.map((v,i)=><td key={i} className="amount">{cash(v)}</td>)}<td className="amount total">{cash(grid.total)}</td><td className="amount">{grid.percent===null?<span className="zero">—</span>:percent.format(grid.percent/100)}</td></tr></tfoot>
  </table></div>}</>;
}

function Movements({items,categories,accounts,onEdit,onDelete}:{items:Movement[];categories:Category[];accounts:Account[];onEdit:(m:Movement)=>void;onDelete:(m:Movement)=>void}){
  const [query,setQuery]=useState('');const [type,setType]=useState<'all'|MovementType>('all'); const filtered=items.filter(m=>(type==='all'||m.type===type)&&(`${m.concept} ${m.notes||''}`.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>b.date.localeCompare(a.date)); const category=(m:Movement)=>{const c=categories.find(c=>c.id===m.categoryId);return c?.subcategories.find(s=>s.id===m.subcategoryId)?.name||c?.name||'Sin categoría'};
  // Una etiqueta más en la misma celda y no una columna nueva: la tabla ya tiene seis y por debajo de
  // 760px se reconstruye como tarjetas con áreas cableadas a esas seis. Sin cuenta no se pinta nada:
  // la mayoría de los movimientos no la tendrán nunca y una etiqueta "Sin cuenta" sería solo ruido.
  const account=(m:Movement)=>accounts.find(a=>a.id===m.accountId)?.name;
  return <section><div className="filters"><label className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por concepto o nota"/></label><select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="all">Todos los tipos</option><option value="income">Ingresos</option><option value="expense">Gastos</option></select></div>{filtered.length===0?<Empty icon={<List/>} title="No hay movimientos" text="Prueba con otros filtros o añade un movimiento nuevo."/>:<div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Tipo</th><th>Concepto</th><th className="amount">Importe</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{filtered.map(m=><tr key={m.id}><td>{format(parseISO(m.date),'dd MMM yyyy',{locale:es})}</td><td><span className="tag">{category(m)}</span>{account(m)&&<span className="tag account">{account(m)}</span>}</td><td>{m.type==='income'?'Ingreso':'Gasto'}</td><td><b>{m.concept}</b>{m.notes&&<small>{m.notes}</small>}</td><td className={`amount ${m.type}`}>{m.type==='expense'?'-':'+'}{money.format(m.amount)}</td><td className="actions"><button aria-label={`Editar ${m.concept}`} onClick={()=>onEdit(m)}><Pencil/></button><button aria-label={`Eliminar ${m.concept}`} onClick={()=>onDelete(m)}><Trash2/></button></td></tr>)}</tbody></table></div>}</section>;
}

function MovementModal({initial,categories,accounts,onClose,onSave}:{initial:Movement|null;categories:Category[];accounts:Account[];onClose:()=>void;onSave:(m:Movement)=>void}){
  const [form,setForm]=useState(()=>initial?{...initial}:{...blank(),categoryId:categories.find(c=>c.type==='expense'&&!c.archived)?.id||''}); const [error,setError]=useState(''); const active=categories.filter(c=>c.type===form.type&&(!c.archived||c.id===form.categoryId)).sort((a,b)=>a.order-b.order); const cat=active.find(c=>c.id===form.categoryId); const update=(p:Partial<typeof form>)=>setForm(current=>({...current,...p}));
  // Mismo patrón que las categorías: las activas más la que ya tuviera el movimiento en edición, o
  // editar un movimiento viejo le cambiaría la cuenta sin querer al no encontrar su opción.
  const openAccounts=accounts.filter(a=>!a.archived||a.id===form.accountId).sort((a,b)=>a.order-b.order);
  const submit=(e:React.FormEvent)=>{e.preventDefault();if(!form.concept.trim()){setError('Escribe un concepto.');return}if(!Number.isFinite(Number(form.amount))||Number(form.amount)<=0){setError('El importe debe ser mayor que cero.');return}if(!form.date||!form.categoryId){setError('Completa la fecha y la categoría.');return}const now=new Date().toISOString();onSave({...form,amount:Number(form.amount),concept:form.concept.trim(),id:initial?.id||crypto.randomUUID(),createdAt:initial?.createdAt||now,updatedAt:now})};
  const chooseType=(type:MovementType)=>update({type,categoryId:categories.find(c=>c.type===type&&!c.archived)?.id||'',subcategoryId:''});
  // El foco va al diálogo, no al primer input: con `autoFocus` en el campo, el móvil abre el teclado
  // nada más montar y empuja el formulario fuera de vista. Aquí el teclado quedaba bloqueando el
  // scroll del fondo, así que además se congela el body mientras el modal está abierto.
  // Dos efectos y no uno: `onClose` cambia de identidad en cada render de App, así que si el foco
  // viviera en el mismo efecto que el listener volvería al diálogo mientras se escribe. Rearmar
  // solo el listener de Escape es inocuo.
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{dialog.current?.focus();const prev=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=prev}},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><span className="eyebrow">Registro</span><h2 id="modal-title">{initial?'Editar movimiento':'Nuevo movimiento'}</h2></div><button aria-label="Cerrar" onClick={onClose}><X/></button></div><form onSubmit={submit}><div className="type-picker"><button type="button" className={form.type==='expense'?'active expense':''} onClick={()=>chooseType('expense')}>Gasto</button><button type="button" className={form.type==='income'?'active income':''} onClick={()=>chooseType('income')}>Ingreso</button></div><label>Concepto<input value={form.concept} onChange={e=>update({concept:e.target.value})} placeholder="Ej. Compra semanal"/></label><div className="form-grid"><label>Importe (€)<input type="number" min="0.01" step="0.01" value={form.amount||''} onChange={e=>update({amount:Number(e.target.value)})} placeholder="0,00"/></label><label>Fecha<input type="date" value={form.date} onChange={e=>update({date:e.target.value})}/></label><label>Categoría<select value={form.categoryId} onChange={e=>update({categoryId:e.target.value,subcategoryId:''})}>{active.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Subcategoría<select value={form.subcategoryId||''} onChange={e=>update({subcategoryId:e.target.value})}><option value="">Sin subcategoría</option>{cat?.subcategories.filter(s=>!s.archived||s.id===form.subcategoryId).sort((a,b)=>a.order-b.order).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>{/* Solo si hay cuentas: sin patrimonio configurado, un select con una única opción sería ruido. Vincular no cambia ningún agregado —el ahorro, las categorías y las tendencias no miran la cuenta—; sirve para localizar el sin clasificar. */}{openAccounts.length>0&&<label>Cuenta <span>(opcional)</span><select value={form.accountId||''} onChange={e=>update({accountId:e.target.value})}><option value="">Sin cuenta</option>{openAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}<label>Notas <span>(opcional)</span><textarea value={form.notes||''} onChange={e=>update({notes:e.target.value})} placeholder="Añade algún detalle"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">{initial?'Guardar cambios':'Añadir'}</button></div></form></div></div>;
}

function CategoryModal({type,onClose,onSave}:{type:MovementType;onClose:()=>void;onSave:(name:string)=>void}){
  const [name,setName]=useState(''); const [error,setError]=useState('');
  const submit=(e:React.FormEvent)=>{e.preventDefault();if(!name.trim()){setError('Escribe un nombre.');return}onSave(name.trim())};
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{dialog.current?.focus();const prev=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=prev}},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="category-modal-title"><div className="modal-head"><div><span className="eyebrow">Categoría</span><h2 id="category-modal-title">Nueva categoría de {type==='income'?'ingreso':'gasto'}</h2></div><button aria-label="Cerrar" onClick={onClose}><X/></button></div><form onSubmit={submit}><label>Nombre<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Ocio"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Añadir</button></div></form></div></div>;
}

function Categories({categories,reload,onNotice}:{categories:Category[];reload:()=>Promise<void>;onNotice:(s:string)=>void}){
 const [open,setOpen]=useState<string[]>(categories.map(c=>c.id)); const [categoryModal,setCategoryModal]=useState<MovementType|null>(null); const toggle=(id:string)=>setOpen(o=>o.includes(id)?o.filter(x=>x!==id):[...o,id]); const editName=async(c:Category,subId?:string)=>{const old=subId?c.subcategories.find(s=>s.id===subId)?.name:c.name;const name=prompt('Nuevo nombre',old);if(!name?.trim())return;const next=subId?{...c,subcategories:c.subcategories.map(s=>s.id===subId?{...s,name:name.trim()}:s)}:{...c,name:name.trim()};await saveCategorySynced(next);await reload();onNotice('Categoría actualizada')}; const archive=async(c:Category,subId?:string)=>{const next=subId?{...c,subcategories:c.subcategories.map(s=>s.id===subId?{...s,archived:!s.archived}:s)}:{...c,archived:!c.archived};await saveCategorySynced(next);await reload()}; const move=async(c:Category,d:number)=>{await saveCategorySynced({...c,order:Math.max(0,c.order+d)});await reload()}; const addSub=async(c:Category)=>{const name=prompt('Nombre de la subcategoría');if(!name?.trim())return;await saveCategorySynced({...c,subcategories:[...c.subcategories,{id:crypto.randomUUID(),name:name.trim(),archived:false,order:c.subcategories.length,updatedAt:new Date().toISOString()}]});await reload()};
 const wipe=async()=>{if(!confirm('Se borrarán todos tus movimientos y cambios de categorías. ¿Continuar?'))return;if(!confirm('Esta acción es irreversible. ¿Borrar definitivamente todos los datos?'))return;
  // El borrado es el único que exige conexión: se hace primero en el servidor para que los demás
  // dispositivos tiren su cola en vez de repoblar lo que se acaba de vaciar.
  try{await clearAllDataSynced()}catch{onNotice('Necesitas conexión para borrar todo');return}
  await reload();onNotice('Todos los datos se han borrado')};
 return <><div className="category-toolbar"><p>Personaliza la estructura sin perder el historial asociado.</p><div><button className="secondary" onClick={()=>setCategoryModal('income')}><Plus/>Categoría de ingreso</button><button className="primary" onClick={()=>setCategoryModal('expense')}><Plus/>Categoría de gasto</button></div></div><section className="category-columns">{(['income','expense'] as const).map(type=><div key={type}><h2>{type==='income'?'Ingresos':'Gastos'}</h2>{categories.filter(c=>c.type===type).sort((a,b)=>a.order-b.order).map(c=><article className={`category-card ${c.archived?'archived':''}`} key={c.id}><div className="category-head"><button className="expand" onClick={()=>toggle(c.id)}>{open.includes(c.id)?<ChevronUp/>:<ChevronDown/>}</button><strong>{c.name}</strong>{c.archived&&<span className="tag">Archivada</span>}<div className="category-actions"><button onClick={()=>move(c,-1)} aria-label="Subir"><ChevronUp/></button><button onClick={()=>move(c,1)} aria-label="Bajar"><ChevronDown/></button><button onClick={()=>editName(c)} aria-label="Renombrar"><Pencil/></button><button onClick={()=>archive(c)}>{c.archived?'Activar':'Archivar'}</button></div></div>{open.includes(c.id)&&<div className="sub-list">{c.subcategories.sort((a,b)=>a.order-b.order).map(s=><div className={s.archived?'archived':''} key={s.id}><span>{s.name}</span>{s.archived&&<small>Archivada</small>}<button onClick={()=>editName(c,s.id)} aria-label={`Renombrar ${s.name}`}><Pencil/></button><button onClick={()=>archive(c,s.id)}>{s.archived?'Activar':'Archivar'}</button></div>)}<button className="add-sub" onClick={()=>addSub(c)}><CirclePlus/>Añadir subcategoría</button></div>}</article>)}</div>)}</section><section className="danger-zone"><div><h2>Borrar todos los datos</h2><p>Restablece movimientos, preferencias y categorías originales.</p></div><button onClick={wipe}><Trash2/>Borrar todo</button></section>{categoryModal&&<CategoryModal type={categoryModal} onClose={()=>setCategoryModal(null)} onSave={async(name)=>{await saveCategorySynced({id:crypto.randomUUID(),name,type:categoryModal,order:categories.filter(c=>c.type===categoryModal).length,archived:false,updatedAt:new Date().toISOString(),subcategories:[]});setCategoryModal(null);await reload();onNotice('Categoría creada')}}/>}</>;
}
