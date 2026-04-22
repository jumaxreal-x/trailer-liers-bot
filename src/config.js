export const config = {
  BOT_NAME: 'TRAILER LIERS',
  OWNER_NUMBER: '256752233886',
  PREFIXES: ['😀', '.', '!'],
  TIME_ZONE: 'Africa/Kampala',
  SESSION_ID: process.env.SESSION_ID || '',
};

export function ownerJid() {
  return `${config.OWNER_NUMBER}@s.whatsapp.net`;
}

export function nowInZone() {
  return new Date().toLocaleString('en-US', { timeZone: config.TIME_ZONE });
}
