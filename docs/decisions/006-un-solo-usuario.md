---
tags: [type/decision, domain/auth, area/servidor]
up: "[[00-index]]"
---

# ADR 006 — Un solo usuario, sin registro público

**Estado**: aceptada

## Contexto

Al añadir auth había que decidir el modelo de acceso. La app es **personal**: no hay ni habrá otros
usuarios. Un formulario de registro abierto sería una puerta que no hace falta abrir.

También se descartó el **magic link**, que parecía la opción de menos fricción: implicaría configurar
SMTP, plantillas de correo y redirect URLs, y depender del correo para entrar en tu propia app.

## Decisión

**Login obligatorio con email y contraseña**, con un **único usuario** dado de alta a mano, y **tres capas
independientes** cerrando el acceso:

1. **Dashboard**: *"Allow new users to sign up"* → **OFF** (y `enable_signup = false` en `config.toml`,
   tanto en `[auth]` como en `[auth.email]`, para que el entorno local se comporte igual).
2. **Cliente**: `src/supabase.ts` **no expone `signUp`** en ninguna parte.
3. **Base de datos**: la RLS filtra por `user_id = auth.uid()` en todas las tablas, con `WITH CHECK` en
   `INSERT`/`UPDATE`. Aunque alguien consiguiera una cuenta, no vería ni escribiría datos ajenos.

Sin flujo de "olvidé mi contraseña": se gestiona desde el dashboard (Users → ⋮ → Reset password).

## Consecuencias

- **Nada de esto está en el repo**: el alta del usuario y los toggles del dashboard son configuración
  manual. Por eso están documentados en [[supabase-auth]] — es la única copia.
- El mensaje de error del login **no distingue** si el correo existe: decir "ese correo no existe"
  confirmaría a un desconocido qué cuentas hay.
- La PK compuesta `(user_id, id)` existe **precisamente** porque dos usuarios compartirían los mismos
  slugs por defecto. Aunque hoy solo haya uno, el esquema es correcto para varios.
  → [[postgres-schema]]
- Si algún día hubiera un segundo usuario, el trabajo pendiente es pequeño: activar signup (o dar de alta
  a mano) y revisar la UI. **El modelo de datos ya está preparado.**
- Contrapartida asumida: **en un navegador donde nunca has entrado, sin red la app no se puede usar**.
  Con sesión previa sí, gracias al fallback a `meta.userId`. → [[login]]

## Relacionadas

[[supabase-auth]] · [[login]] · [[postgres-schema]] · [[001-local-first-a-supabase]]
