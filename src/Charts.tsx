import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from './calculations';
import { categoryColor, theme } from './theme';

// Etiquetas del eje Y compactas ("1,8 mil €"): con 60px por defecto recharts se comía
// casi el 20% del ancho en un móvil de 320px. De ahí el width fijo más estrecho.
const compact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const axis = { stroke: theme.line, tick: { fill: theme.muted, fontSize: 12 }, tickMargin: 6 };
const xAxis = { ...axis, dataKey: 'name', minTickGap: 12, interval: 'preserveStartEnd' as const };
const yAxis = { ...axis, width: 46, tickFormatter: (v: number) => `${compact.format(v)}€` };
const legend = { wrapperStyle: { color: theme.muted, fontSize: 12 } };
const tooltip = { contentStyle: { background: theme.surface, border: `1px solid ${theme.line}`, borderRadius: 12, color: theme.text, boxShadow: '0 8px 24px #0000001a' }, formatter: (value: any) => money.format(Number(Array.isArray(value) ? value[0] : value ?? 0)) };
// La altura vive en CSS (`.chart-box`) y no en la prop `height`, para poder bajarla en móvil
// y en landscape sin duplicar aquí los breakpoints.
const Box = ({children}:{children:React.ReactNode}) => <div className="chart-box">{children}</div>;

export function TrendChart({data}:{data:{name:string;ingresos:number;gastos:number;ahorro:number}[]}) {
  return <Box><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid stroke={theme.line} vertical={false}/><XAxis {...xAxis}/><YAxis {...yAxis}/><Tooltip {...tooltip}/><Legend {...legend}/><Line dataKey="ingresos" stroke={theme.income} strokeWidth={3} dot={false} activeDot={{r:4}}/><Line dataKey="gastos" stroke={theme.expense} strokeWidth={3} dot={false} activeDot={{r:4}}/><Line dataKey="ahorro" stroke={theme.text} strokeWidth={3} dot={false} activeDot={{r:4}}/></LineChart></ResponsiveContainer></Box>;
}
export function ExpenseChart({data}:{data:{categoryId:string;name:string;value:number}[]}) {
  // Radios en % y leyenda sin `height` fija: en px el donut no encogía y los 6 nombres de
  // categoría (CATEGORY_LIMIT) se salían de la caja de 36px al envolver en pantallas estrechas.
  // Color por categoryId (identidad), no por índice: mismo color siempre para la misma categoría.
  return <Box><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={3}>{data.map((d)=><Cell key={d.categoryId} fill={categoryColor(d.categoryId)} stroke={theme.surface} strokeWidth={2}/>)}</Pie><Tooltip {...tooltip}/><Legend verticalAlign="bottom" {...legend}/></PieChart></ResponsiveContainer></Box>;
}
export function NetWorthChart({data}:{data:{name:string;value:number|null}[]}) {
  // En `theme.text` y no en verde/rojo: esto es nivel, no flujo. Y **sin `connectNulls`**: un mes sin
  // cierre tiene que verse como hueco, porque uniendo los extremos recharts inventaría una
  // rentabilidad que nadie ganó. De ahí también el `dot` (TrendChart va sin él): un mes aislado entre
  // dos huecos no dibuja segmento, así que sin punto sería invisible.
  return <Box><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid stroke={theme.line} vertical={false}/><XAxis {...xAxis}/><YAxis {...yAxis}/><Tooltip {...tooltip}/><Line dataKey="value" name="Patrimonio neto" stroke={theme.text} strokeWidth={3} dot={{r:3,fill:theme.text}} activeDot={{r:5}}/></LineChart></ResponsiveContainer></Box>;
}
export function WeeklyChart({data}:{data:{name:string;ingresos:number;gastos:number}[]}) {
  return <Box><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid stroke={theme.line} vertical={false}/><XAxis {...xAxis}/><YAxis {...yAxis}/><Tooltip {...tooltip}/><Legend {...legend}/><Bar dataKey="ingresos" fill={theme.income} radius={[5,5,0,0]}/><Bar dataKey="gastos" fill={theme.expense} radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></Box>;
}
