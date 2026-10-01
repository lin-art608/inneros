const APP_URL = 'https://inneros.pages.dev/';

function isAppUrl(value) {
  try { return new URL(value).origin === new URL(APP_URL).origin; }
  catch { return false; }
}

function isExternalUrl(value) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
}

module.exports = { APP_URL, isAppUrl, isExternalUrl };
