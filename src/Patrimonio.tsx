import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Landmark, Pencil, Scale, TrendingDown, Wallet, X } from 'lucide-react';
import { available, closingId, currentMonth, latestClosings, money, monthCompleteness, monthLabel, netWorth, parseAmount, shiftMonth } from './calculations';
import { saveAccountSynced, saveClosingSynced } from './sync';
import { Empty, Stat } from './Ui';
import type { Account, AccountNature, Closing } from './types';

type View = 'level' | 'closing' | 'accounts';
const views = [['level','Nivel'],['closing','Cierre mensual'],['accounts','Cuentas']] as const;
// Solo se pregunta el aportado donde significa algo: en una cuenta de inversión separa ahorro de
// rentabilidad, y en un pasivo es el principal amortizado. En el resto es deducible de los movimientos.
const asksContributed = (account: Account) => account.isInvestment || account.nature === 'liability';
const byOrder = (a: Account, b: Account) => a.order - b.order;

export default function Patrimonio({accounts,closings,reload,onNotice}:{accounts:Account[];closings:Closing[];reload:()=>Promise<void>;onNotice:(s:string)=>void}){
  const [view,setView]=useState<View>('level');
  const active=useMemo(()=>accounts.filter(a=>!a.archived).sort(byOrder),[accounts]);
  // Sin cuentas no hay nada que enseñar ni que cerrar, y aquí no hay semillas (a diferencia de las
  // categorías): la primera vez la pantalla está vacía de verdad, así que se manda a crear una cuenta.
  const blank=<Empty icon={<Landmark/>} title="Todavía no tienes cuentas" text="Crea tu primera cuenta en la pestaña Cuentas —la corriente, el broker, la hipoteca— y podrás cerrar el mes."/>;
  return <><section className="period-bar"><div className="segmented">{views.map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</div></section>
  {view==='level'&&(active.length?<Level accounts={active} closings={closings}/>:blank)}
  {view==='closing'&&(active.length?<Closings accounts={active} closings={closings} reload={reload} onNotice={onNotice}/>:blank)}
  {view==='accounts'&&<Accounts accounts={accounts} reload={reload} onNotice={onNotice}/>}</>;
}

/** El nivel: lo que hay ahora mismo, que es el último cierre de cada cuenta. Todo en gris —verde y rojo
 *  siguen reservados a ingreso y gasto—: aquí no hay flujo, solo saldo. */
function Level({accounts,closings}:{accounts:Account[];closings:Closing[]}){
  const latest=useMemo(()=>latestClosings(closings),[closings]);
  const assets=accounts.filter(a=>a.nature==='asset'); const liabilities=accounts.filter(a=>a.nature==='liability');
  const balance=(account:Account)=>latest.find(c=>c.accountId===account.id);
  const column=(title:string,list:Account[])=><div><h2>{title}</h2>{list.length===0?<p className="hint">Ninguna todavía.</p>:list.map(a=>{const c=balance(a);return <article className="category-card" key={a.id}><div className="category-head"><strong>{a.name}</strong>{c?<span className="tag">{monthLabel(c.month)}</span>:<span className="tag">Sin cierre</span>}<b className="amount">{c?money.format(c.balance!):'—'}</b></div></article>})}</div>;
  return <><section className="stats">
    <Stat label="Patrimonio neto" value={netWorth(accounts,latest)} icon={<Scale/>} tone="neutral"/>
    <Stat label="Disponible mañana" value={available(accounts,latest)} icon={<Wallet/>} tone="neutral"/>
    <Stat label="Activos" value={netWorth(assets,latest)} icon={<Landmark/>} tone="neutral"/>
    <Stat label="Pasivos" value={-netWorth(liabilities,latest)} icon={<TrendingDown/>} tone="neutral"/>
  </section>
  <p className="hint">El dato es mensual: entre cierres se muestra el <b>último cierre</b> de cada cuenta, no el saldo de hoy.</p>
  <section className="category-columns">{column('Activos',assets)}{column('Pasivos',liabilities)}</section></>;
}

// Lo que hay escrito en una fila del ritual. Strings y no números porque el campo vacío es un estado
// real ("no revisado") que Number() no sabe representar.
type Draft = { balance: string; contributed: string; note: string };
const EMPTY_DRAFT: Draft = { balance: '', contributed: '', note: '' };

/** El ritual mensual. Aquí se gana o se pierde el módulo: el requisito son dos minutos, así que es una
 *  sola pantalla con un campo por cuenta y el total recalculándose en vivo. */
function Closings({accounts,closings,reload,onNotice}:{accounts:Account[];closings:Closing[];reload:()=>Promise<void>;onNotice:(s:string)=>void}){
  // Selector de mes propio: no toca `prefs`, así navegar aquí no cambia el periodo del Resumen ni de la
  // vista Semanal. Y un cierre es un mes, no una fecha.
  const [month,setMonth]=useState(currentMonth());
  // Solo las filas TOCADAS entran en el borrador, porque solo ellas se guardan. Lo que no se ha tocado
  // se lee de los cierres guardados, así que editar un mes viejo no reescribe las cuentas que no miras.
  const [draft,setDraft]=useState<Record<string,Draft>>({}); const [error,setError]=useState(''); const [saving,setSaving]=useState(false);
  const saved=useMemo(()=>closings.filter(c=>c.month===month),[closings,month]);
  // La pista en gris es el último saldo conocido ANTES de este mes: si febrero está sin revisar, cerrando
  // marzo la pista es la de enero. Es una pista, no entra en ningún cálculo.
  const hints=useMemo(()=>latestClosings(closings,month),[closings,month]);
  const savedFor=(account:Account)=>saved.find(c=>c.accountId===account.id);
  // El valor que se ve: el borrador si la fila está tocada, y si no lo guardado. Nunca la pista: un
  // campo prerrellenado arrastraría en silencio el número del mes pasado a la serie histórica.
  const field=(account:Account):Draft=>{const current=draft[account.id];if(current)return current;const closing=savedFor(account);return closing?{balance:closing.balance===null?'':String(closing.balance),contributed:closing.contributed===undefined?'':String(closing.contributed),note:closing.note??''}:EMPTY_DRAFT};
  const update=(account:Account,patch:Partial<Draft>)=>{setError('');setDraft(d=>({...d,[account.id]:{...field(account),...patch}}))};
  // Cambiar de mes tira el borrador: si no, lo tecleado para marzo se guardaría en el cierre de abril.
  const go=(delta:number)=>{setMonth(m=>shiftMonth(m,delta));setDraft({});setError('')};
  const isCurrent=month===currentMonth();
  // El total y el contador se calculan con lo que hay EN PANTALLA, no con lo guardado: el objetivo es
  // cazar un dedazo antes de guardar. Sin useMemo a propósito: son 3-8 cuentas y `field` lee el
  // borrador, así que memorizarlo solo abriría la puerta a un total desfasado.
  const preview:Closing[]=accounts.map(a=>({id:closingId(a.id,month),accountId:a.id,month,balance:parseAmount(field(a).balance),updatedAt:''}));
  const progress=monthCompleteness(accounts,preview,month);
  const submit=async()=>{
    const touched=accounts.filter(a=>draft[a.id]);
    const ops:Closing[]=[];
    for(const account of touched){
      const {balance,contributed,note}=draft[account.id]; const value=parseAmount(balance); const given=asksContributed(account)?parseAmount(contributed):null;
      // Las dos validaciones tapan pérdidas silenciosas de datos: un saldo negativo lo rechazaría el
      // check de Postgres y el push descartaría la op, y un aportado sin saldo se iría con la fila
      // omitida. El signo lo pone la naturaleza de la cuenta, así que aquí nunca se teclea en negativo.
      if(value!==null&&value<0){setError(`El saldo de ${account.name} no puede ser negativo: el signo lo pone la cuenta, no el importe.`);return}
      if(value===null&&(given!==null||note.trim())){setError(`Escribe el saldo de ${account.name} o vacía su fila del todo.`);return}
      // Vaciar es guardar el cierre con el saldo a null (y sin aportado ni nota), nunca borrar la fila:
      // por eso este dominio no necesita lápidas. Sin cierre previo no hay nada que vaciar.
      if(value===null){if(savedFor(account))ops.push({id:closingId(account.id,month),accountId:account.id,month,balance:null,updatedAt:new Date().toISOString()});continue}
      ops.push({id:closingId(account.id,month),accountId:account.id,month,balance:value,...(given===null?{}:{contributed:given}),...(note.trim()?{note:note.trim()}:{}),updatedAt:new Date().toISOString()});
    }
    if(!ops.length){setError('No has cambiado ningún saldo.');return}
    setSaving(true);
    // En serie y no en paralelo: el orden de la cola del outbox es el orden causal de las escrituras.
    for(const op of ops)await saveClosingSynced(op);
    setDraft({}); await reload(); setSaving(false); onNotice(`Cierre de ${monthLabel(month)} guardado`);
  };
  return <><section className="period-bar"><span/><div className="period-nav"><button aria-label="Mes anterior" onClick={()=>go(-1)}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="Mes siguiente" onClick={()=>go(1)} disabled={isCurrent}>›</button></div></section>
  <p className="hint">Escribe el saldo real de cada cuenta, siempre en positivo. Un campo vacío significa <b>no revisado</b> y no se guarda{isCurrent?'':', y rellenar un mes pasado es igual de válido'}.</p>
  <section className="closing-list">{accounts.map(account=>{const value=field(account);const hint=hints.find(c=>c.accountId===account.id);const reviewed=parseAmount(value.balance)!==null;
    return <div className="closing-row" key={account.id} role="group" aria-label={account.name}>
      <div className="closing-name"><strong>{account.name}</strong>{reviewed?null:<span className="tag">Sin revisar</span>}</div>
      <label>Saldo (€)<input type="number" min="0" step="0.01" value={value.balance} onChange={e=>update(account,{balance:e.target.value})} placeholder={hint?money.format(hint.balance!):'0,00'}/></label>
      {asksContributed(account)?<label>{account.nature==='liability'?'Principal amortizado':'Aportado este mes'}<input type="number" step="0.01" value={value.contributed} onChange={e=>update(account,{contributed:e.target.value})} placeholder="0,00"/></label>:<span className="closing-gap"/>}
      <label>Nota (opcional)<input value={value.note} onChange={e=>update(account,{note:e.target.value})} placeholder="Por qué este mes fue raro"/></label>
      <button className="secondary" onClick={()=>update(account,EMPTY_DRAFT)}>Vaciar</button>
    </div>})}
    <div className="closing-foot"><div><span>Patrimonio neto del mes</span><strong className="amount">{money.format(netWorth(accounts,preview))}</strong></div><small>{progress.reviewed} de {progress.total} cuentas revisadas</small></div>
  </section>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="form-actions"><button className="primary" onClick={submit} disabled={saving}>{saving?'Guardando…':'Guardar cierre'}</button></div></>;
}

/** Las cuentas se archivan, nunca se borran: los cierres históricos las referencian. Mismo patrón y
 *  misma razón que las categorías. */
function Accounts({accounts,reload,onNotice}:{accounts:Account[];reload:()=>Promise<void>;onNotice:(s:string)=>void}){
  const [modal,setModal]=useState<{account:Account|null}|null>(null);
  const save=async(account:Account,notice:string)=>{await saveAccountSynced(account);await reload();onNotice(notice)};
  const move=(account:Account,delta:number)=>save({...account,order:Math.max(0,account.order+delta)},'Orden actualizado');
  const column=(title:string,nature:AccountNature)=><div><h2>{title}</h2>{accounts.some(a=>a.nature===nature)?null:<p className="hint">Ninguna todavía.</p>}{accounts.filter(a=>a.nature===nature).sort(byOrder).map(a=><article className={`category-card ${a.archived?'archived':''}`} key={a.id}><div className="category-head"><strong>{a.name}</strong>{a.isInvestment&&<span className="tag">Inversión</span>}{a.isLiquid&&<span className="tag">Líquida</span>}{a.archived&&<span className="tag">Archivada</span>}<div className="category-actions"><button onClick={()=>move(a,-1)} aria-label="Subir"><ChevronUp/></button><button onClick={()=>move(a,1)} aria-label="Bajar"><ChevronDown/></button><button onClick={()=>setModal({account:a})} aria-label={`Editar ${a.name}`}><Pencil/></button><button onClick={()=>save({...a,archived:!a.archived},a.archived?'Cuenta activada':'Cuenta archivada')}>{a.archived?'Activar':'Archivar'}</button></div></div></article>)}</div>;
  return <><div className="category-toolbar"><p>Los saldos históricos siguen colgando de la cuenta, así que una cuenta que ya no usas se archiva en vez de borrarse.</p><div><button className="primary" onClick={()=>setModal({account:null})}><Landmark/>Nueva cuenta</button></div></div>
  <section className="category-columns">{column('Activos','asset')}{column('Pasivos','liability')}</section>
  {modal&&<AccountModal initial={modal.account} onClose={()=>setModal(null)} onSave={async(account)=>{const editing=modal.account;setModal(null);await save(editing?account:{...account,order:accounts.length},editing?'Cuenta actualizada':'Cuenta creada')}}/>}</>;
}

/** Mismo patrón que CategoryModal (foco en el diálogo, body congelado, Escape en su propio efecto), pero
 *  sirve también para editar: una cuenta tiene cuatro campos y el prompt() de las categorías no llega. */
function AccountModal({initial,onClose,onSave}:{initial:Account|null;onClose:()=>void;onSave:(account:Account)=>void}){
  const [form,setForm]=useState(()=>initial?{...initial}:{name:'',nature:'asset' as AccountNature,isInvestment:false,isLiquid:true}); const [error,setError]=useState('');
  const update=(patch:Partial<typeof form>)=>setForm(current=>({...current,...patch}));
  const submit=(e:React.FormEvent)=>{e.preventDefault();if(!form.name.trim()){setError('Escribe un nombre.');return}
    onSave({archived:false,order:0,...initial,...form,name:form.name.trim(),id:initial?.id||crypto.randomUUID(),updatedAt:new Date().toISOString()})};
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{dialog.current?.focus();const prev=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=prev}},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-modal-title"><div className="modal-head"><div><span className="eyebrow">Cuenta</span><h2 id="account-modal-title">{initial?'Editar cuenta':'Nueva cuenta'}</h2></div><button aria-label="Cerrar" onClick={onClose}><X/></button></div><form onSubmit={submit}>
    <label>Nombre<input autoFocus value={form.name} onChange={e=>update({name:e.target.value})} placeholder="Ej. Cuenta corriente"/></label>
    {/* El picker va en gris (.segmented) y no en el .type-picker de los movimientos: verde y rojo son de
        ingreso y gasto, y aquí no hay flujo. `.field` es `.modal form > label` sin ser un label, que no
        tendría control que etiquetar; el grupo se anuncia con role+aria-label. */}
    <div className="field"><span>Naturaleza. El saldo se teclea siempre en positivo; el signo lo pone esto.</span><div className="segmented" role="group" aria-label="Naturaleza de la cuenta"><button type="button" aria-pressed={form.nature==='asset'} className={form.nature==='asset'?'active':''} onClick={()=>update({nature:'asset'})}>Activo (suma)</button><button type="button" aria-pressed={form.nature==='liability'} className={form.nature==='liability'?'active':''} onClick={()=>update({nature:'liability'})}>Pasivo (resta)</button></div></div>
    <div className="checks">
      <label className="switch"><input type="checkbox" checked={form.isInvestment} onChange={e=>update({isInvestment:e.target.checked})}/>Es de inversión</label>
      <small>Si su valor puede moverse sin que metas dinero. Solo a estas cuentas se les pregunta cuánto aportaste, que es lo que separa tu ahorro de lo que puso el mercado. El broker sí; una cuenta de ahorro no.</small>
      <label className="switch"><input type="checkbox" checked={form.isLiquid} onChange={e=>update({isLiquid:e.target.checked})}/>Es líquida</label>
      <small>Si cuenta para el «disponible mañana» sin vender nada. La corriente sí; la tarjeta también (resta); el broker y la hipoteca no.</small>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">{initial?'Guardar cambios':'Añadir'}</button></div></form></div></div>;
}
