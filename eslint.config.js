import js from '@eslint/js';import globals from 'globals';import reactHooks from 'eslint-plugin-react-hooks';import reactRefresh from 'eslint-plugin-react-refresh';import tseslint from 'typescript-eslint';
// `supabase/.temp` lo genera `npx supabase start` (funciones edge empaquetadas y minificadas): está
// gitignoreado, pero sin ignorarlo aquí `npm run lint` sale rojo con cientos de errores ajenos en
// cuanto se levanta Supabase en local.
export default tseslint.config({ignores:['dist','supabase/.temp']},{extends:[js.configs.recommended,...tseslint.configs.recommended],files:['**/*.{ts,tsx}'],languageOptions:{ecmaVersion:2020,globals:globals.browser},plugins:{'react-hooks':reactHooks,'react-refresh':reactRefresh},rules:{...reactHooks.configs.recommended.rules,'react-refresh/only-export-components':['warn',{allowConstantExport:true}],'@typescript-eslint/no-explicit-any':'off'}});
