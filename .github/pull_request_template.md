<!-- Título de la PR: mismo formato que los commits — `<tipo>: <qué hace>` en minúscula. -->

## Qué cambia

<!-- Dos o tres frases. Lo que vería alguien usando la app, no la lista de ficheros: eso ya está en el diff. -->

## Por qué

<!-- La parte que el diff NO cuenta, y la razón de que exista esta plantilla.
     Qué problema resuelve, y sobre todo qué alternativa se descartó y a cambio de qué.
     Si has medido algo (contraste, tamaños, tiempos), pon la cifra: dentro de seis meses
     es lo único que evita volver a discutir la misma decisión.
     Si el cambio toca un invariante conocido (sync, esquema, semántica de color,
     versión de IndexedDB), dilo aquí explícitamente. -->

## Cómo verificarlo

<!-- Los pasos concretos para reproducirlo en el navegador, no "probar que funciona".
     Si hay un caso que solo se ve en móvil (<760 px), offline o en la demo, nómbralo. -->

1.

## Comprobaciones

- [ ] `npm test && npm run lint && npm run build` en verde
- [ ] QA manual del caso afectado → `docs/qa-playbook.md`
- [ ] **Vault actualizado en esta misma PR** si el cambio altera arquitectura, un patrón, el esquema
      o el flujo de sync. Es contrapartida obligatoria: una nota desactualizada se lee como verdad
