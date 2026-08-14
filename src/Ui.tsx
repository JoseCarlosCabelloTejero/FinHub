import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { money } from './calculations';

// Las dos piezas de presentación que comparten más de una pantalla. Viven fuera de App.tsx porque
// Patrimonio.tsx también las usa e importarlas desde ./App sería un ciclo; duplicarlas partiría en dos
// el contrato de markup que espera la CSS (.stat lee `tone` como color de la tarjeta, y `.empty > span`
// se convierte en el recuadro del icono).
export function Stat({label,value,text,icon,tone}:{label:string;value?:number;text?:string;icon:React.ReactNode;tone:string}){return <article className={`stat ${tone}`}><div className="stat-icon">{icon}</div><span>{label}</span><strong>{text??money.format(value||0)}</strong></article>}
export function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="empty"><span>{icon}</span><h2>{title}</h2><p>{text}</p></div>}

/** Lo que hay que preguntar antes de una acción irreversible. Lo compone quien la dispara. */
export type Confirm = {title:string;body:string;confirmLabel:string;tone?:'danger';onConfirm:()=>void};

/** El diálogo de confirmación de la app, en lugar del confirm() nativo. */
// Vive aquí y no en App.tsx porque quien pregunta puede ser cualquier pantalla, y el diálogo se
// monta una sola vez arriba: dentro de SyncNote quedaría anidado en la hoja de sesión en móvil, con
// dos backdrops del mismo z-index, dos listeners de Escape y dos bloqueos de body compitiendo.
// Reusa .modal-backdrop/.modal, así que hereda gratis la hoja que sube desde abajo por debajo de
// 760px y el pie sticky de .form-actions. Dos detalles propios frente a los modales de formulario:
// el foco vuelve al disparador al cancelar (como en SessionSheet: el botón sigue en pantalla y con
// teclado quedarse en el body obliga a recorrer la página entera), y va al diálogo y no al botón de
// confirmar, para no dejar la acción destructiva debajo del Intro.
// Dos efectos y no uno, por lo mismo que en los demás: `onCancel` cambia de identidad en cada render
// del padre, y fusionarlos reenfocaría el diálogo cada vez.
export function ConfirmDialog({title,body,confirmLabel,tone,onConfirm,onCancel}:Confirm&{onCancel:()=>void}){
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{const opener=document.activeElement as HTMLElement|null;dialog.current?.focus();const prev=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=prev;opener?.focus()}},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onCancel()};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[onCancel]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onCancel()}}><div className="modal confirm" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div className="modal-head"><div><h2 id="confirm-title">{title}</h2></div><button aria-label="Cerrar" onClick={onCancel}><X/></button></div><p>{body}</p><div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="button" className={tone==='danger'?'danger':'primary'} onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}
