require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
  console.warn(
    'Faltan variables de entorno OAuth2. Define GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI.'
  );
}

if (!process.env.GEMINI_API_KEY) {
  console.warn('Falta GEMINI_API_KEY. /api/analyze no podrá generar propuestas con Gemini.');
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const SEARCH_CONSOLE_SCOPE = ['https://www.googleapis.com/auth/webmasters.readonly'];
const pendingApprovals = [];

function parseGeminiJson(rawText) {
  const cleanText = rawText.replace(/```json|```/g, '').trim();
  return JSON.parse(cleanText);
}

app.get('/auth/google', (_req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SEARCH_CONSOLE_SCOPE,
    prompt: 'consent'
  });

  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'No se recibió el parámetro code.' });
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    return res.json({
      message: 'Autenticación correcta con Google Search Console.',
      tokens
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Error al obtener tokens OAuth2.',
      details: error.message
    });
  }
});

/**
 * Obtiene keywords de Search Console y filtra oportunidades SEO.
 * - Últimos 30 días
 * - Posición entre 5 y 15
 * - CTR menor a 3%
 *
 * @param {string} siteUrl URL de propiedad verificada en Search Console (ej: https://midominio.com/)
 * @returns {Promise<Record<string, Array<{keyword:string, clicks:number, impressions:number, ctr:number, position:number}>>>}
 */
async function fetchSEOKeywords(siteUrl) {
  const searchconsole = google.searchconsole({ version: 'v1', auth: oauth2Client });

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);

  const formatDate = (date) => date.toISOString().slice(0, 10);

  const response = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      dimensions: ['page', 'query'],
      rowLimit: 25000
    }
  });

  const rows = response.data.rows || [];

  const opportunitiesByUrl = rows.reduce((acc, row) => {
    const [page, keyword] = row.keys || [];
    const ctrPercent = (row.ctr || 0) * 100;
    const position = row.position || 0;

    const isOpportunity = position >= 5 && position <= 15 && ctrPercent < 3;
    if (!isOpportunity || !page || !keyword) {
      return acc;
    }

    if (!acc[page]) {
      acc[page] = [];
    }

    acc[page].push({
      keyword,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: Number(ctrPercent.toFixed(2)),
      position: Number(position.toFixed(2))
    });

    return acc;
  }, {});

  return opportunitiesByUrl;
}

/**
 * Envía el contenido actual de una página y una keyword de oportunidad a Gemini 1.5 Pro
 * y devuelve Meta Title + Meta Description en JSON.
 *
 * @param {string} context Contenido de página / resumen actual para optimizar
 * @param {string} keyword Keyword de oportunidad
 * @returns {Promise<{metaTitle:string, metaDescription:string}>}
 */
async function optimizeContentWithGemini(context, keyword) {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY no configurada.');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
  const prompt = [
    'Eres un experto SEO enfocado en maximizar CTR orgánico.',
    'Analiza el contexto actual de la página y la keyword objetivo.',
    'Genera un Meta Title y Meta Description de alto CTR, claros y persuasivos.',
    'Responde estrictamente en JSON válido, sin markdown ni texto adicional.',
    'Formato exacto requerido:',
    '{"metaTitle":"...","metaDescription":"..."}',
    `Keyword objetivo: ${keyword}`,
    `Contexto de la página: ${context}`
  ].join('\n');

  const response = await model.generateContent(prompt);
  const text = response.response.text();
  const parsed = parseGeminiJson(text);

  if (!parsed.metaTitle || !parsed.metaDescription) {
    throw new Error('Gemini no devolvió el formato JSON esperado.');
  }

  return {
    metaTitle: String(parsed.metaTitle).trim(),
    metaDescription: String(parsed.metaDescription).trim()
  };
}

/**
 * Prepara la petición PATCH a Webflow API v2 para SEO de una página,
 * sin ejecutarla; se encola en pendingApprovals.
 *
 * @param {string} pageId ID de la página en Webflow
 * @param {{metaTitle:string, metaDescription:string}} seoData Nuevo SEO sugerido
 * @returns {{approvalId:number, request:{method:string, url:string, headers:Record<string,string>, body:Record<string,string>}}}
 */
function prepareWebflowUpdate(pageId, seoData) {
  const requestPayload = {
    method: 'PATCH',
    url: `https://api.webflow.com/v2/pages/${pageId}`,
    headers: {
      Authorization: 'Bearer <WEBFLOW_API_TOKEN>',
      'Content-Type': 'application/json'
    },
    body: {
      metaTitle: seoData.metaTitle,
      metaDescription: seoData.metaDescription
    }
  };

  const approvalRecord = {
    approvalId: pendingApprovals.length + 1,
    pageId,
    seoData,
    request: requestPayload,
    createdAt: new Date().toISOString()
  };

  pendingApprovals.push(approvalRecord);

  return {
    approvalId: approvalRecord.approvalId,
    request: requestPayload
  };
}

app.get('/seo/opportunities', async (req, res) => {
  const { siteUrl } = req.query;

  if (!siteUrl) {
    return res.status(400).json({ error: 'Debes enviar el query param siteUrl.' });
  }

  try {
    const data = await fetchSEOKeywords(siteUrl);
    return res.json({ siteUrl, data });
  } catch (error) {
    return res.status(500).json({
      error: 'No se pudieron obtener las keywords desde Search Console.',
      details: error.message
    });
  }
});

/**
 * Fase 2: analiza keywords filtradas de Fase 1 y prepara propuestas para revisión humana.
 * Body esperado:
 * {
 *   "siteUrl": "https://midominio.com/",
 *   "pageContexts": {
 *     "https://midominio.com/pagina-a": {
 *       "content": "texto actual",
 *       "currentMetaTitle": "title actual",
 *       "currentMetaDescription": "description actual",
 *       "pageId": "webflowPageId"
 *     }
 *   }
 * }
 */
app.post('/api/analyze', async (req, res) => {
  const { siteUrl, pageContexts = {} } = req.body || {};

  if (!siteUrl) {
    return res.status(400).json({ error: 'Debes enviar siteUrl en el body.' });
  }

  try {
    const opportunitiesByPage = await fetchSEOKeywords(siteUrl);
    const reviewItems = [];

    for (const [pageUrl, opportunities] of Object.entries(opportunitiesByPage)) {
      const pageContext = pageContexts[pageUrl] || {};
      const context = pageContext.content || `URL: ${pageUrl}`;
      const currentMetaTitle = pageContext.currentMetaTitle || '';
      const currentMetaDescription = pageContext.currentMetaDescription || '';
      const pageId = pageContext.pageId || pageUrl;

      for (const opportunity of opportunities) {
        const optimizedSeo = await optimizeContentWithGemini(context, opportunity.keyword);
        const approval = prepareWebflowUpdate(pageId, optimizedSeo);

        reviewItems.push({
          pageUrl,
          pageId,
          keyword: opportunity.keyword,
          metrics: {
            clicks: opportunity.clicks,
            impressions: opportunity.impressions,
            ctr: opportunity.ctr,
            position: opportunity.position
          },
          before: {
            metaTitle: currentMetaTitle,
            metaDescription: currentMetaDescription
          },
          after: optimizedSeo,
          pendingApproval: approval
        });
      }
    }

    return res.json({
      siteUrl,
      totalOpportunities: reviewItems.length,
      pendingApprovalsCount: pendingApprovals.length,
      items: reviewItems
    });
  } catch (error) {
    return res.status(500).json({
      error: 'No se pudo completar el análisis SEO con Gemini.',
      details: error.message
    });
  }
});

app.get('/api/pending-approvals', (_req, res) => {
  return res.json({ total: pendingApprovals.length, pendingApprovals });
});

app.listen(PORT, () => {
  console.log(`Servidor Express iniciado en http://localhost:${PORT}`);
});

module.exports = {
  app,
  fetchSEOKeywords,
  oauth2Client,
  optimizeContentWithGemini,
  prepareWebflowUpdate,
  pendingApprovals
};
