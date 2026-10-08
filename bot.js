// ID de usuario interna de 7TV
const SEVENTV_USER_ID = '01J454CT00000FEMV6VS56MJFQ';

// Lista blanca con las IDs numéricas de Twitch permitidas (en formato de texto)
const WHITELIST_USER_IDS = [
  '533448153', // propio
  '183535160',
  '784451774',
  '527341680',
  '595123169',
  '627778369',
  '817914894', // regulus 
  '510835610', // dislaiik
  '792162996'  //  // Reemplaza con la ID de Twitch del usuario 2
];

// Función para verificar permisos mediante la ID de Twitch, el rol de moderador, o si es el streamer
function tienePermiso(userstate, channel) {
  const userId = userstate['user-id'];
  const username = userstate.username?.toLowerCase();
  const broadcaster = channel.replace('#', '').toLowerCase();

  // Es el dueño del canal o moderador
  const esModOStreamer = userstate.badges?.broadcaster || userstate.mod || username === broadcaster;
  
  // O su ID está registrada en la lista blanca
  const estaEnWhitelist = userId && WHITELIST_USER_IDS.includes(userId);

  return esModOStreamer || estaEnWhitelist;
}

// Helper: Envía mensajes a través de la API Helix de Twitch
async function responderChat(client, channel, mensaje) {
  if (!client || typeof client.say !== 'function') {
    console.error('❌ Error: El cliente de TMI.js no está disponible.');
    return;
  }

  try {
    await client.say(channel, mensaje);
  } catch (err) {
    console.error('❌ [CHAT ERROR]', err.message);
  }
}

// 1. Obtiene el Set de Emotes directamente vinculado
async function getActiveEmoteSetId(userId) {
  const response = await fetch(`https://7tv.io/v3/users/${userId}`);

  if (!response.ok) {
    throw new Error('No se pudo conectar con los servidores de 7TV.');
  }

  const data = await response.json();

  let activeSetId = data.emote_set?.id;

  if (!activeSetId && data.connections) {
    const twitchConn = data.connections.find(c => c.platform === 'TWITCH');
    if (twitchConn && twitchConn.emote_set) {
      activeSetId = twitchConn.emote_set.id;
    }
  }

  if (!activeSetId && data.emote_sets) {
    const activeInList = data.emote_sets.find(s => s.active || s.flags === 1);
    activeSetId = activeInList?.id || data.emote_sets[0]?.id;
  }

  if (!activeSetId) {
    throw new Error('La cuenta no tiene ningún set de emotes vinculado en 7TV.');
  }

  return activeSetId;
}

// 2. Obtiene la lista actual de emotes y la capacidad máxima
async function getEmotesInSet(emoteSetId) {
  const query = `
    query GetEmoteSet($id: ObjectID!) {
      emoteSet(id: $id) {
        capacity
        emotes {
          id
          name
          timestamp
        }
      }
    }
  `;

  const response = await fetch('https://7tv.io/v3/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: emoteSetId } })
  });

  const data = await response.json();

  if (data.errors) {
    throw new Error(`Error GraphQL: ${data.errors[0].message}`);
  }

  const emoteSetData = data.data?.emoteSet || {};
  const emotesList = emoteSetData.emotes || [];
  const capacity = emoteSetData.capacity || 0;

  return {
    emotes: Array.isArray(emotesList) ? emotesList : [],
    capacity: capacity
  };
}

// 3. Ejecuta la mutación GraphQL para modificar el set (ADD o REMOVE)
async function modify7TVEmoteSet(emoteSetId, emoteId, action, token, customName = null) {
  const cleanToken = token.trim().replace(/^Bearer\s+/i, '');
  const authHeader = `Bearer ${cleanToken}`;

  const query = `
    mutation AddEmoteToSet($setId: ObjectID!, $emoteId: ObjectID!, $name: String) {
      emoteSet(id: $setId) {
        edit(emotes: { add: [{ id: $emoteId, name: $name }] }) {
          id
          emotes {
            id
            name
          }
        }
      }
    }
  `;

  const removeQuery = `
    mutation RemoveEmoteFromSet($setId: ObjectID!, $emoteId: ObjectID!) {
      emoteSet(id: $setId) {
        edit(emotes: { remove: [$emoteId] }) {
          id
          emotes {
            id
            name
          }
        }
      }
    }
  `;

  const selectedQuery = action === 'ADD' ? query : removeQuery;

  const variables = {
    setId: emoteSetId,
    emoteId: emoteId
  };

  if (customName && action === 'ADD') {
    variables.name = customName;
  }

  const response = await fetch('https://7tv.io/v3/gql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify({ query: selectedQuery, variables })
  });

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0].message);
  }

  return data.data?.emoteSet;
}

// 4. Manejador del comando -add
async function manejarComandoAddEmote(client, channel, userstate, args) {
  if (!tienePermiso(userstate, channel)) {
    return await responderChat(client, channel, '❌ No tienes permisos para usar este comando.');
  }

  const emoteId = args[0];
  const customName = args[1] || null;

  if (!emoteId) {
    return await responderChat(client, channel, 'Para usar el comando -add: "-add <ID_EMOTE> [nombre del emote]"');
  }

  try {
    const token = process.env.SEVENTV_TOKEN;

    if (!token) {
      return await responderChat(client, channel, 'Falta configurar SEVENTV_TOKEN en el archivo .env.');
    }

    const activeSetId = await getActiveEmoteSetId(SEVENTV_USER_ID);
    const { emotes } = await getEmotesInSet(activeSetId);

    const existingById = emotes.find(e => e.id === emoteId);
    if (existingById) {
      return await responderChat(client, channel, `El emote ya se encuentra en el set con el nombre "${existingById.name}".`);
    }

    if (customName) {
      const nameConflict = emotes.find(e => e.name.toLowerCase() === customName.toLowerCase());
      if (nameConflict) {
        return await responderChat(client, channel, `Ya existe un emote con el nombre "${customName}" en este set.`);
      }
    }

    await modify7TVEmoteSet(activeSetId, emoteId, 'ADD', token, customName);

    const setAfterAdd = await getEmotesInSet(activeSetId);
    const addedEmote = setAfterAdd.emotes.find(e => e.id === emoteId);
    const finalName = addedEmote ? addedEmote.name : (customName || 'Emote');

    await responderChat(client, channel, `¡"${finalName}" agregado!`);

  } catch (error) {
     console.error('Error al añadir emote:', error);
     
     if (error.message.includes('conflicting name')) {
       return await responderChat(client, channel, 'El nombre de este emote entra en conflicto con otro existente en el set.');
     }

     await responderChat(client, channel, `Error al añadir el emote: ${error.message}`);
  }
}

// 5. Manejador del comando -del
async function manejarComandoDelEmote(client, channel, userstate, args) {
  if (!tienePermiso(userstate, channel)) {
    return await responderChat(client, channel, '❌ No tienes permisos para usar este comando.');
  }

  try {
    const emoteName = args[0];

    if (!emoteName) {
      return await responderChat(client, channel, 'Para usar el comando -del: "-del (nombre del emote)"');
    }

    const token = process.env.SEVENTV_TOKEN;

    if (!token) {
      return await responderChat(client, channel, 'Falta configurar SEVENTV_TOKEN en las variables de entorno.');
    }

    const activeSetId = await getActiveEmoteSetId(SEVENTV_USER_ID);
    const { emotes } = await getEmotesInSet(activeSetId);

    const targetEmote = emotes.find(
      e => e && e.name && e.name.toLowerCase() === emoteName.toLowerCase()
    );

    if (!targetEmote) {
      return await responderChat(client, channel, `No se encontró el emote "${emoteName}" en el set activo.`);
    }

    await modify7TVEmoteSet(activeSetId, targetEmote.id, 'REMOVE', token);
    await getEmotesInSet(activeSetId);

    await responderChat(client, channel, `¡Emote "${targetEmote.name}" eliminado!`);

  } catch (error) {
    console.error('Error en comando -del:', error);
    await responderChat(client, channel, `Error al intentar eliminar: ${error.message}`);
  }
}

// 6. Manejador del comando -rename
async function manejarComandoRenameEmote(client, channel, userstate, args) {
  if (!tienePermiso(userstate, channel)) {
    return await responderChat(client, channel, '❌ No tienes permisos para usar este comando.');
  }

  const currentName = args[0];
  const newName = args[1];

  if (!currentName || !newName) {
    return await responderChat(client, channel, 'Para usar el comando: "-rename <nombre_actual> <nuevo_nombre>"');
  }

  try {
    const token = process.env.SEVENTV_TOKEN;

    if (!token) {
      return await responderChat(client, channel, 'Error: Falta configurar SEVENTV_TOKEN en el archivo .env.');
    }

    const activeSetId = await getActiveEmoteSetId(SEVENTV_USER_ID);
    const { emotes } = await getEmotesInSet(activeSetId);

    const targetEmote = emotes.find(
      e => e && e.name && e.name.toLowerCase() === currentName.toLowerCase()
    );

    if (!targetEmote) {
      return await responderChat(client, channel, `No se encontró ningún emote con el nombre "${currentName}" en el set.`);
    }

    await modify7TVEmoteSet(activeSetId, targetEmote.id, 'REMOVE', token);
    await modify7TVEmoteSet(activeSetId, targetEmote.id, 'ADD', token, newName);
    
    await responderChat(client, channel, `¡Emote "${currentName}" cambiado a "${newName}"!`);

  } catch (error) {
     console.error('Error al renombrar emote:', error);
     await responderChat(client, channel, `Error al intentar renombrar: ${error.message}`);
  }
}

// 7. Manejador del comando -set
async function manejarComandoSetInfo(client, channel, userstate, args) {
  try {
    const activeSetId = await getActiveEmoteSetId(SEVENTV_USER_ID);
    const { emotes, capacity } = await getEmotesInSet(activeSetId);

    if (emotes.length === 0) {
      return await responderChat(client, channel, `📊 El set de emotes está vacío [0/${capacity}].`);
    }

    await responderChat(client, channel, `set actual de emotes: [${emotes.length}/${capacity}]`);

  } catch (error) {
    console.error('Error en comando -set:', error);
    await responderChat(client, channel, `❌ No se pudo obtener la información del set: ${error.message}`);
  }
}

module.exports = {
  manejarComandoAddEmote,
  manejarComandoDelEmote,
  manejarComandoRenameEmote,
  manejarComandoSetInfo
};