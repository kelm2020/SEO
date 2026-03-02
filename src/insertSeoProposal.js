import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

/**
 * Inserta una propuesta SEO nueva cuando la IA genera una respuesta.
 *
 * @param {Object} payload
 * @param {string} payload.id_pagina
 * @param {string} payload.url
 * @param {string} payload.keyword_gsc
 * @param {Record<string, any>} payload.metadatos_actuales
 * @param {Record<string, any>} payload.metadatos_propuestos_ia
 * @returns {Promise<Object>} fila insertada
 */
export async function insertarPropuestaSeo(payload) {
  const { data, error } = await supabase
    .from('seo_propuestas')
    .insert({
      id_pagina: payload.id_pagina,
      url: payload.url,
      keyword_gsc: payload.keyword_gsc,
      metadatos_actuales: payload.metadatos_actuales ?? {},
      metadatos_propuestos_ia: payload.metadatos_propuestos_ia ?? {},
      estado: 'Pendiente'
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Error al insertar propuesta SEO: ${error.message}`);
  }

  return data;
}
