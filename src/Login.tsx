import { useState } from 'react';
import { FlaskConical, WalletCards } from 'lucide-react';
import { enterDemo } from './demo';
import { signIn } from './supabase';
import type { AuthFailure } from './supabase';

// "Correo o contraseña incorrectos" a propósito, sin distinguir cuál de los dos: decir "ese correo no
// existe" confirmaría a un desconocido qué cuentas hay. Los otros casos sí se distinguen porque
// cambian lo que el usuario tiene que hacer (esperar, reconectarse).
const messages: Record<AuthFailure, string> = {
  credentials: 'Correo o contraseña incorrectos.',
  offline: 'Sin conexión. Inténtalo cuando vuelvas a tener red.',
  'rate-limit': 'Demasiados intentos. Espera unos minutos.',
  unknown: 'No se ha podido iniciar sesión. Inténtalo de nuevo.',
};

export default function Login() {
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [sending,setSending]=useState(false);
  // En el camino feliz no hay callback ni setSending(false): signIn guarda la sesión, dispara
  // SIGNED_IN y el gate de App.tsx cambia de pantalla desmontando esto. Un onSuccess sería un segundo
  // camino hacia el mismo estado.
  const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!email.trim()||!password){setError('Escribe tu correo y tu contraseña.');return}setError('');setSending(true);const failure=await signIn(email.trim(),password);if(failure){setSending(false);setError(messages[failure])}};
  return <div className="login"><form onSubmit={submit}>
    <div className="brand"><span><WalletCards/></span><div><b>FinHub</b><small>Finanzas personales</small></div></div>
    <span className="eyebrow">Acceso</span><h1>Entra en tu espacio</h1>
    <label>Correo electrónico<input type="email" autoComplete="email" autoFocus value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com"/></label>
    <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="primary" disabled={sending}>{sending?'Entrando…':'Entrar'}</button>
    {/* type="button" obligatorio: sin él enviaría el formulario de login antes de entrar en la demo.
        La nota está en el camino de entrada y no dentro de la demo porque es ahí donde alguien decide
        si merece la pena probarla: lo que quiere saber es dónde acaba lo que escriba. */}
    <button type="button" className="secondary" disabled={sending} onClick={enterDemo}><FlaskConical/>Probar la demo</button>
    <p className="login-note">Datos de ejemplo que se guardan solo en este navegador. No se sube nada a la nube.</p>
  </form></div>;
}
