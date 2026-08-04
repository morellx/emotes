// ID de usuario interna de 7TV
const SEVENTV_USER_ID = '01J454CT00000FEMV6VS56MJFQ';

// Helper para responder en Twitch de forma segura y evitar caídas
async function responderChat(client, channel, mensaje) {
  if (!client || typeof client.say !== 'function') {
    console.error('❌ Error: El objeto "client" no está disponible o no se ha inicializado correctamente.');
    return;
  }

  try {
    await client.say(channel, mensaje);
  } catch (err) {
    if (err.message && err.message.includes('anonymous')) {
      console.error('❌ [TWITCH AUTH ERROR] El bot está en modo anónimo. Verifica el token OAuth en tu .env');
    } else {
      console.error('❌ [CHAT ERROR]', err.message);
    }
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

// 2. Obtiene la lista actual de emotes estructurada correctamente según 7TV v3 GQL
async function getEmotesInSet(emoteSetId) {
  const query = `
    query GetEmoteSet($id: ObjectID!) {
      emoteSet(id: $id) {
        emotes {
          id
          name
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

  const emotesList = data.data?.emoteSet?.emotes || [];
  return Array.isArray(emotesList) ? emotesList : [];
}

// 3. Ejecuta la mutación GraphQL para modificar el set (ADD o REMOVE)
async function modify7TVEmoteSet(emoteSetId, emoteId, action, token, customName = null) {
  const cleanToken = token.trim().replace(/^Bearer\s+/i, '');
  const authHeader = `Bearer ${cleanToken}`;

  const query = `
    mutation UpdateEmoteSet($setId: ObjectID!, $action: ListItemAction!, $emoteId: ObjectID!, $name: String) {
      emoteSet(id: $setId) {
        emotes(id: $emoteId, action: $action, name: $name) {
          id
          name
        }
      }
    }
  `;

  const variables = {
    setId: emoteSetId,
    action: action,
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
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0].message);
  }

  return data.data?.emoteSet;
}

// 4. Manejador del comando -add
async function manejarComandoAddEmote(client, channel, args) {
  const emoteId = args[0];
  const customName = args[1] || null;

  if (!emoteId) {
    return await responderChat(client, channel, '⚠️ Para usar el comando -add: "-add <ID_EMOTE> [nombre del emote]" (el nombre es opcional)');
  }

  try {
    const token = process.env.SEVENTV_TOKEN;

    if (!token) {
      return await responderChat(client, channel, '❌ Error: Falta configurar SEVENTV_TOKEN en el archivo .env.');
    }

    const activeSetId = await getActiveEmoteSetId(SEVENTV_USER_ID);
    await modify7TVEmoteSet(activeSetId, emoteId, 'ADD', token, customName);

    if (customName) {
      await responderChat(client, channel, `/me " ${customName} ", ¡Emote añadido! 😎`);
    } else {
      await responderChat(client, channel, `/me ¡Emote añadido! 😎`);
    }
  } catch (error) {
     console.error('Error al añadir emote:', error);
  }
}

// 5. Manejador del comando -del
async function manejarComandoDelEmote(client, channel, args) {
  try {
    const emoteName = args[0];

    if (!emoteName) {
      return await responderChat(client, channel, '⚠️ Para usar el comando -del: "-del (nombre del emote)"');
    }

    const token = process.env.SEVENTV_TOKEN;

    if (!token) {
      return await responderChat(client, channel, '❌ Error: Falta configurar SEVENTV_TOKEN en las variables de entorno.');
    }

    const activeSetId = await getActiveEmoteSetId(SEVENTV_USER_ID);
    const currentEmotes = await getEmotesInSet(activeSetId);

    const targetEmote = currentEmotes.find(
      e => e && e.name && e.name.toLowerCase() === emoteName.toLowerCase()
    );

    if (!targetEmote) {
      return await responderChat(client, channel, `❌ Error: No se encontró el emote "${emoteName}" en el set activo.`);
    }

    await modify7TVEmoteSet(activeSetId, targetEmote.id, 'REMOVE', token);
    await responderChat(client, channel, `/me ¡Emote "${targetEmote.name}", eliminado! 🗑️`);

  } catch (error) {
    console.error('Error en comando -del:', error);
    await responderChat(client, channel, `❌ Error al intentar eliminar: ${error.message}`);
  }
}

// 6. Manejador del comando -rename (Reemplaza el nombre existente borrando el viejo y añadiendo el nuevo con el mismo ID)
async function manejarComandoRenameEmote(client, channel, args) {
  const currentName = args[0];
  const newName = args[1];

  if (!currentName || !newName) {
    return await responderChat(client, channel, '⚠️ Para usar el comando: "-rename <nombre_actual> <nuevo_nombre>"');
  }

  try {
    const token = process.env.SEVENTV_TOKEN;

    if (!token) {
      return await responderChat(client, channel, '❌ Error: Falta configurar SEVENTV_TOKEN en el archivo .env.');
    }

    const activeSetId = await getActiveEmoteSetId(SEVENTV_USER_ID);
    const currentEmotes = await getEmotesInSet(activeSetId);

    // Buscar el emote actual para obtener su ID único y su nombre exacto
    const targetEmote = currentEmotes.find(
      e => e && e.name && e.name.toLowerCase() === currentName.toLowerCase()
    );

    if (!targetEmote) {
      return await responderChat(client, channel, `❌ Error: No se encontró ningún emote con el nombre "${currentName}" en el set.`);
    }

    // Paso 1: Remover la instancia anterior del emote del set
    await modify7TVEmoteSet(activeSetId, targetEmote.id, 'REMOVE', token);

    // Paso 2: Volver a añadir el mismo ID pero utilizando exclusivamente el nuevo nombre
    await modify7TVEmoteSet(activeSetId, targetEmote.id, 'ADD', token, newName);
    
    await responderChat(client, channel, `/me ¡Emote "${currentName}" cambiado exitosamente a "${newName}"! ✏️`);

  } catch (error) {
    console.error('Error al renombrar emote:', error);
    await responderChat(client, channel, `❌ Error al intentar renombrar: ${error.message}`);
  }
}

module.exports = {
  manejarComandoAddEmote,
  manejarComandoDelEmote,
  manejarComandoRenameEmote
};