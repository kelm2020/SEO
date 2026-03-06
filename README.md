# Propuestas SEO en Supabase

## 1) Crear tabla en Supabase

Ejecuta el script SQL:

- `db/seo_propuestas_schema.sql`

Este script crea la tabla `seo_propuestas` con:

- `id` (UUID autogenerado)
- `id_pagina`
- `url`
- `keyword_gsc`
- `metadatos_actuales` (JSONB)
- `metadatos_propuestos_ia` (JSONB)
- `estado` (`Pendiente`, `Aprobado`, `Rechazado`)
- `fecha_creacion`

## 2) Insertar propuestas desde la IA

Usa la función `insertarPropuestaSeo` en:

- `src/insertSeoProposal.js`

Variables de entorno requeridas:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Ejemplo de uso:

```js
import { insertarPropuestaSeo } from './src/insertSeoProposal.js';

const propuesta = await insertarPropuestaSeo({
  id_pagina: 'page_123',
  url: 'https://midominio.com/blog/seo-tecnico',
  keyword_gsc: 'seo técnico',
  metadatos_actuales: {
    title: 'Guía SEO',
    description: 'Introducción básica'
  },
  metadatos_propuestos_ia: {
    title: 'Guía completa de SEO técnico 2026',
    description: 'Checklist práctico para mejorar indexación y rendimiento.'
  }
});

console.log(propuesta);
```
