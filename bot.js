require('dotenv').config();
const tmi = require('tmi.js');
const { 
  manejarComandoAddEmote, 
  manejarComandoDelEmote, 
  manejarComandoRenameEmote,
  manejarComandoSetInfo
} = require('./emotes2');

// Formatear token asegurando el prefijo oauth:
const rawToken = process.env.TWITCH_OAUTH || '';
const oauthToken = rawToken.startsWith('oauth:') ? rawToken : `oauth:${rawToken}`;

// ==========================================
// 🛡️ LISTA BLANCA (WHITELIST) DE IDs DE TWITCH
// ==========================================
const WHITELIST_USER_IDS = [
  '533448153', // propio
  '183535160',
  '784451774',
  '527341680',
  '595123169',
  '627778369',
  '817914894', // regulus 
  '415934819'  
];

// Configuración e inicialización de tmi.js para leer el chat
const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.TWITCH_USER,
    password: oauthToken
  },
  channels: [process.env.TWITCH_CHANNEL]
});

client.connect()
  .then(() => console.log('✅ Bot conectado a Twitch con éxito'))
  .catch(err => console.error('❌ Error de conexión con Twitch:', err));

client.on('message', async (channel, userstate, message, self) => {
  if (self) return;

  // 1. Extraemos el ID único de Twitch del usuario que envía el mensaje
  const userId = userstate['user-id'];

  // 2. Si el usuario NO está en la whitelist, el bot ignora el mensaje por completo
  if (!WHITELIST_USER_IDS.includes(userId)) {
    return;
  }

  const cleanMessage = message.trim();
  const args = cleanMessage.split(/\s+/);
  const command = args.shift().toLowerCase();

  // Al ejecutar estas funciones, internamente usarán la API Helix (en emotes2.js) para responder con insignia
  if (command === '-add') {
    await manejarComandoAddEmote(client, channel, args);
  } else if (command === '-del') {
    await manejarComandoDelEmote(client, channel, args);
  } else if (command === '-rename') {
    await manejarComandoRenameEmote(client, channel, args);
  } else if (command === '-set') {
    await manejarComandoSetInfo(client, channel, args);
  }
});