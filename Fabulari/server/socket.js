const createAuth = require('./auth');
const { nextId, NO_ID } = require('./db');
const { isStoredUpload, deleteUploads } = require('./uploads');

const MAX_TEXT_LENGTH = 2000;

// Only the most recent messages in each room are kept, per the client's requirements.
const HISTORY_SIZE = 5;

// Socket.IO room name for a chat room.
const channel = (roomId) => `room:${roomId}`;

function initializeSockets(io, db) {
  const { userFromToken } = createAuth(db);
  const groups = db.collection('groups');
  const rooms = db.collection('rooms');
  const messages = db.collection('messages');

  // Who is in each chat room: roomId -> (userId -> { username, sockets }).
  // A user with several tabs open stays "present" until their last tab leaves.
  const presence = new Map();

  function presentUsers(roomId) {
    const users = presence.get(roomId) ?? new Map();
    return [...users.entries()].map(([userId, p]) => ({ userId, username: p.username }));
  }

  // Loads the room and checks the user is a member of its group. Returns the room or an error message.
  async function roomForMember(roomId, userId) {
    const room = await rooms.findOne({ id: Number(roomId) }, NO_ID);
    if (!room) return { error: 'Room not found' };
    const group = await groups.findOne({ id: room.groupId }, NO_ID);
    if (!group?.members.some((m) => m.userId === userId)) return { error: 'Group members only' };
    return { room };
  }

  // The stored messages for a room, oldest first.
  async function recentMessages(roomId) {
    const newestFirst = await messages.find({ roomId }, NO_ID).sort({ id: -1 }).limit(HISTORY_SIZE).toArray();
    return newestFirst.reverse();
  }

  // Saves a message, then deletes anything in that room older than the newest HISTORY_SIZE.
  async function storeMessage(message) {
    await messages.insertOne({ ...message });
    const oldestToDelete = await messages
      .find({ roomId: message.roomId }, { projection: { id: 1 } })
      .sort({ id: -1 })
      .skip(HISTORY_SIZE)
      .limit(1)
      .next();
    if (oldestToDelete) {
      const tooOld = { roomId: message.roomId, id: { $lte: oldestToDelete.id } };
      const oldImages = await messages.find({ ...tooOld, type: 'image' }, { projection: { content: 1 } }).toArray();
      await messages.deleteMany(tooOld);
      await deleteUploads(oldImages.map((m) => m.content));
    }
  }

  // Checks the content of a message and returns the value to store, or an error message.
  function validateContent(type, content) {
    if (type === 'text') {
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text) return { error: 'Message cannot be empty' };
      if (text.length > MAX_TEXT_LENGTH) return { error: `Messages can be at most ${MAX_TEXT_LENGTH} characters` };
      return { value: text };
    }
    if (type === 'image') {
      // Images are uploaded first (POST /api/rooms/:roomId/images); the message carries the returned path.
      if (!isStoredUpload(content)) return { error: 'Upload the image before sending it' };
      return { value: content };
    }
    return { error: 'Unsupported message type' };
  }

  function addPresence(socket, roomId) {
    const { user } = socket.data;
    if (!presence.has(roomId)) presence.set(roomId, new Map());
    const users = presence.get(roomId);
    const isNew = !users.has(user.id);
    if (isNew) users.set(user.id, { username: user.username, sockets: new Set() });
    users.get(user.id).sockets.add(socket.id);
    socket.data.rooms.add(roomId);
    return isNew;
  }

  // Returns true when this was the user's last connection in the room.
  function removePresence(socket, roomId) {
    const { user } = socket.data;
    socket.data.rooms.delete(roomId);
    const users = presence.get(roomId);
    const entry = users?.get(user.id);
    if (!entry) return false;
    entry.sockets.delete(socket.id);
    if (entry.sockets.size) return false;
    users.delete(user.id);
    if (!users.size) presence.delete(roomId);
    return true;
  }

  function leave(socket, roomId) {
    socket.leave(channel(roomId));
    if (removePresence(socket, roomId)) {
      const user = { userId: socket.data.user.id, username: socket.data.user.username };
      io.to(channel(roomId)).emit('presence:left', { roomId, user });
      io.to(channel(roomId)).emit('presence:update', { roomId, users: presentUsers(roomId) });
    }
  }

  // Only logged-in users may connect. The Angular app sends its login token in the handshake.
  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth?.token);
      if (!user) return next(new Error('Not logged in'));
      socket.data.user = user;
      socket.data.rooms = new Set();
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;

    // Every handler replies through `ack` with { ok: true, ... } or { ok: false, message }.
    const handle = (event, handler) => {
      socket.on(event, async (payload = {}, ack = () => {}) => {
        try {
          ack(await handler(payload));
        } catch (err) {
          console.error(`socket ${event}:`, err);
          ack({ ok: false, message: 'Something went wrong on the server' });
        }
      });
    };

    handle('room:join', async ({ roomId }) => {
      const { room, error } = await roomForMember(roomId, user.id);
      if (error) return { ok: false, message: error };

      socket.join(channel(room.id));
      if (addPresence(socket, room.id)) {
        const joined = { userId: user.id, username: user.username };
        socket.to(channel(room.id)).emit('presence:joined', { roomId: room.id, user: joined });
      }
      const present = presentUsers(room.id);
      io.to(channel(room.id)).emit('presence:update', { roomId: room.id, users: present });

      return { ok: true, history: await recentMessages(room.id), present };
    });

    handle('room:leave', async ({ roomId }) => {
      leave(socket, Number(roomId));
      return { ok: true };
    });

    handle('message:send', async ({ roomId, type, content }) => {
      roomId = Number(roomId);
      if (!socket.data.rooms.has(roomId)) return { ok: false, message: 'Join the room before sending messages' };

      // Membership is checked again in case the user was removed while in the room.
      const { error } = await roomForMember(roomId, user.id);
      if (error) return { ok: false, message: error };

      const { value, error: contentError } = validateContent(type, content);
      if (contentError) return { ok: false, message: contentError };

      const message = {
        id: await nextId(db, 'messages'),
        roomId,
        senderId: user.id,
        senderName: user.username,
        type,
        content: value,
        timestamp: new Date().toISOString(), // server time; each browser shows it in local time
      };
      await storeMessage(message);
      io.to(channel(roomId)).emit('message:new', message);
      return { ok: true, message };
    });

    socket.on('disconnect', () => {
      for (const roomId of [...socket.data.rooms]) leave(socket, roomId);
    });
  });
}

module.exports = initializeSockets;
