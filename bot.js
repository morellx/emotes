require('dotenv').config();

const tmi = require('tmi.js');
const { 
  manejarComandoAddEmote, 
  manejarComandoDelEmote, 
  manejarComandoRenameEmote 
} = require('./emotes');

// Formatear token asegurando el prefijo oauth:
const rawToken = process.env.TWITCH_OAUTH || '';
const oauthToken = rawToken.startsWith('oauth:') ? rawToken : `oauth:${rawToken}`;

// Configuración e inicialización de tmi.js
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

  const cleanMessage = message.trim();
  const args = cleanMessage.split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === '-add') {
    await manejarComandoAddEmote(client, channel, args);
  } else if (command === '-del') {
    await manejarComandoDelEmote(client, channel, args);
  } else if (command === '-rename') {
    await manejarComandoRenameEmote(client, channel, args);
  }
});