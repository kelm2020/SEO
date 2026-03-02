require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
  console.warn(
    'Faltan variables de entorno OAuth2. Define GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI.'
  );
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SEARCH_CONSOLE_SCOPE = ['https://www.googleapis.com/auth/webmasters.readonly'];

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

app.listen(PORT, () => {
  console.log(`Servidor Express iniciado en http://localhost:${PORT}`);
});

module.exports = { app, fetchSEOKeywords, oauth2Client };
