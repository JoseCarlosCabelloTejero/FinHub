import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from './calculations';

const colors = ['#55c2ff','#4f8cff','#47d7ac','#ffc857','#ff7a90','#9575ff','#70e1f5','#b7e565','#f09cff','#79a8ff'];
const tooltip = { contentStyle: { background: '#111c2d', border: '1px solid #263a55', borderRadius: 12 }, formatter: (value: any) => money.format(Number(Array.isArray(value) ? value[0] : value ?? 0)) };

export function TrendChart({data}:{data:{name:string;ingresos:number;gastos:number;ahorro:number}[]}) {
  return <ResponsiveContainer width="100%" height={280}><LineChart data={data}><CartesianGrid stroke="#20324a" vertical={false}/><XAxis dataKey="name" stroke="#7f92aa"/><YAxis stroke="#7f92aa" tickFormatter={(v)=>`${v}€`}/><Tooltip {...tooltip}/><Legend/><Line dataKey="ingresos" stroke="#47d7ac" strokeWidth={3} dot={false}/><Line dataKey="gastos" stroke="#ff7a90" strokeWidth={3} dot={false}/><Line dataKey="ahorro" stroke="#55c2ff" strokeWidth={3} dot={false}/></LineChart></ResponsiveContainer>;
}
export function ExpenseChart({data}:{data:{name:string;value:number}[]}) {
  return <ResponsiveContainer width="100%" height={280}><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={3}>{data.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}</Pie><Tooltip {...tooltip}/><Legend verticalAlign="bottom" height={36}/></PieChart></ResponsiveContainer>;
}
export function WeeklyChart({data}:{data:{name:string;ingresos:number;gastos:number}[]}) {
  return <ResponsiveContainer width="100%" height={280}><BarChart data={data}><CartesianGrid stroke="#20324a" vertical={false}/><XAxis dataKey="name" stroke="#7f92aa"/><YAxis stroke="#7f92aa" tickFormatter={(v)=>`${v}€`}/><Tooltip {...tooltip}/><Legend/><Bar dataKey="ingresos" fill="#47d7ac" radius={[5,5,0,0]}/><Bar dataKey="gastos" fill="#ff7a90" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer>;
}
