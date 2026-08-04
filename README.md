# Cielo · Finanzas personales

Aplicación web local para registrar ingresos y gastos, consultar el ahorro y entender la evolución financiera mediante gráficos. Los datos se guardan exclusivamente en IndexedDB dentro del navegador.

## Uso

Requiere Node.js 20 o superior.

```bash
npm install
npm run dev
```

Vite mostrará la dirección local de la aplicación. Para crear una versión optimizada:

```bash
npm run build
npm run preview
```

## Privacidad

- No existe servidor, cuenta de usuario ni sincronización externa.
- Los movimientos no forman parte del repositorio.
- Borrar los datos del navegador elimina también la información de la aplicación.
- La opción **Borrar todo** requiere dos confirmaciones y restaura las categorías originales.

## Comprobaciones

```bash
npm test
npm run lint
npm run build
```
