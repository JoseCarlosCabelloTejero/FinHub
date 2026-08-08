/// <reference types="vite/client" />

// Tipar las variables propias hace que `tsc -b` cace un typo en import.meta.env, que si no sería
// `any` y fallaría en tiempo de ejecución.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
