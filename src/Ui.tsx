import { money } from './calculations';

// Las dos piezas de presentación que comparten más de una pantalla. Viven fuera de App.tsx porque
// Patrimonio.tsx también las usa e importarlas desde ./App sería un ciclo; duplicarlas partiría en dos
// el contrato de markup que espera la CSS (.stat lee `tone` como color de la tarjeta, y `.empty > span`
// se convierte en el recuadro del icono).
export function Stat({label,value,text,icon,tone}:{label:string;value?:number;text?:string;icon:React.ReactNode;tone:string}){return <article className={`stat ${tone}`}><div className="stat-icon">{icon}</div><span>{label}</span><strong>{text??money.format(value||0)}</strong></article>}
export function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="empty"><span>{icon}</span><h2>{title}</h2><p>{text}</p></div>}
