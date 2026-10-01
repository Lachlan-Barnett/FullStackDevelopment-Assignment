const createAuth = require('./auth');
const { nextId, NO_ID } = require('./db');
const { isStoredUpload, deleteUploads } = require('./uploads');

const MAX_TEXT_LENGTH = 2000;

// Only the most recent messages in each room are kept, per the client's requirements.
const HISTORY_SIZE = 5;

// The super admin runs the system but, per the client, never takes part in chat.
const SUPER_ADMIN_NO_CHAT = 'The super admin cannot take part in chat';

// Socket.IO room name for a chat room.
const channel = (roomId) => `room:${roomId}`;

// Every socket also joins a channel for its user, so the server can reach all of that user's tabs at once.
const userChannel = (userId) => `user:${userId}`;

// The super admin's tabs, for new requests that need their decision.
const SUPER_ADMIN_CHANNEL = 'superadmin';

// Sets up the chat sockets and returns the "live" helpers the REST routes use to push real-time updates.
function initializeSockets(io, db) {
  const { userFromToken } = createAuth(db);
  const groups = db.collection('groups');
  const rooms = db.collection('rooms');
  const messages = db.collection('messages');
  const users = db.collection('users');

  // Who is in each chat room: roomId -> (userId -> { username, sockets }).
  // A user with several tabs open stays "present" until their last tab leaves.
  const presence = new Map();

  // The people currently in a room, for the "In this room" list.
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

  // The stored messages for a room, oldest first, each with the sender's current profile photo.
  // Photos aren't stored on messages, so a changed photo shows on older messages too.
  async function recentMessages(roomId) {
    const newestFirst = await messages
      .find({ roomId }, NO_ID)
      .sort({ id: -1 })
      .limit(HISTORY_SIZE)
      .toArray();
    const senderIds = [...new Set(newestFirst.map((m) => m.senderId))];
    const senders = await users
      .find({ id: { $in: senderIds } }, { projection: { _id: 0, id: 1, profilePhoto: 1 } })
      .toArray();
    const photos = new Map(senders.map((u) => [u.id, u.profilePhoto ?? null]));
    return newestFirst
      .reverse()
      .map((m) => ({ ...m, senderPhoto: photos.get(m.senderId) ?? null }));
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
      const oldImages = await messages
        .find({ ...tooOld, type: 'image' }, { projection: { content: 1 } })
        .toArray();
      await messages.deleteMany(tooOld);
      await deleteUploads(oldImages.map((m) => m.content));
    }
  }

  // Checks the content of a message and returns the value to store, or an error message.
  function validateContent(type, content) {
    if (type === 'text') {
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text) return { error: 'Message cannot be empty' };
      if (text.length > MAX_TEXT_LENGTH)
        return { error: `Messages can be at most ${MAX_TEXT_LENGTH} characters` };
      return { value: text };
    }
    if (type === 'image') {
      // Images are uploaded first (POST /api/rooms/:roomId/images); the message carries the returned path.
      if (!isStoredUpload(content)) return { error: 'Upload the image before sending it' };
      return { value: content };
    }
    return { error: 'Unsupported message type' };
  }

  // Records that this socket is in the room. Returns true if the user wasn't already there in another tab.
  function addPresence(socket, room) {
    const { user } = socket.data;
    if (!presence.has(room.id)) presence.set(room.id, new Map());
    const users = presence.get(room.id);
    const isNew = !users.has(user.id);
    if (isNew) users.set(user.id, { username: user.username, sockets: new Set() });
    users.get(user.id).sockets.add(socket.id);
    socket.data.rooms.set(room.id, room.groupId);
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

  // Takes a socket out of a room and, if it was the user's last tab there, tells everyone else.
  function leave(socket, roomId) {
    socket.leave(channel(roomId));
    if (removePresence(socket, roomId)) {
      const user = { userId: socket.data.user.id, username: socket.data.user.username };
      io.to(channel(roomId)).emit('presence:left', { roomId, user });
      io.to(channel(roomId)).emit('presence:update', { roomId, users: presentUsers(roomId) });
      io.to(channel(roomId)).emit('typing', { roomId, user, typing: false });
    }
  }

  // Every open socket (tab) of a user.
  function socketsOf(userId) {
    const ids = io.sockets.adapter.rooms.get(userChannel(userId)) ?? new Set();
    return [...ids].map((id) => io.sockets.sockets.get(id)).filter(Boolean);
  }

  // ----- Live updates, called by the REST routes in index.js -----

  // Shows a short pop-up message on every open tab of the given users.
  function notify(userIds, message) {
    for (const id of new Set(userIds)) io.to(userChannel(id)).emit('notification', { message });
  }

  // Tells the given users' pages that something changed, so they reload it straight away.
  // `scope` is what changed: "groups", "rooms", "requests" or "group-admin" (with a groupId).
  function refresh(userIds, scope, details = {}) {
    for (const id of new Set(userIds))
      io.to(userChannel(id)).emit('refresh', { scope, ...details });
  }

  // A new request is waiting for the super admin: show a pop-up and reload their dashboard.
  function notifySuperAdmin(message) {
    if (message) io.to(SUPER_ADMIN_CHANNEL).emit('notification', { message });
    io.to(SUPER_ADMIN_CHANNEL).emit('refresh', { scope: 'super-admin' });
  }

  // Takes a user out of the chat rooms of a group they no longer belong to (banned, left, removed by
  // the age limit...), on all their tabs, so they stop receiving that group's messages at once.
  function removeFromGroup(userId, groupId) {
    for (const socket of socketsOf(userId)) {
      for (const [roomId, roomGroupId] of [...socket.data.rooms]) {
        if (roomGroupId === groupId) leave(socket, roomId);
      }
    }
  }

  // Empties a room that has been deleted, so nobody keeps receiving anything from it.
  function closeRoom(roomId) {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.rooms?.has(roomId)) {
        socket.leave(channel(roomId));
        socket.data.rooms.delete(roomId);
      }
    }
    presence.delete(roomId);
  }

  // An account removed from Fabulari: tell its open tabs, then disconnect them.
  function removeAccount(userId) {
    io.to(userChannel(userId)).emit('account:removed', {});
    for (const socket of socketsOf(userId)) socket.disconnect(true);
  }

  // Only logged-in users may connect. The Angular app sends its login token in the handshake.
  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth?.token);
      if (!user) return next(new Error('Not logged in'));
      socket.data.user = user;
      socket.data.rooms = new Map(); // roomId -> groupId, for the rooms this socket has joined
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const isSuperAdmin = user.role === 'superadmin';
    socket.join(userChannel(user.id));
    if (isSuperAdmin) socket.join(SUPER_ADMIN_CHANNEL);

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

    // Joins a room's live feed. Replies with the stored messages and who is present.
    handle('room:join', async ({ roomId }) => {
      if (isSuperAdmin) return { ok: false, message: SUPER_ADMIN_NO_CHAT };
      const { room, error } = await roomForMember(roomId, user.id);
      if (error) return { ok: false, message: error };

      socket.join(channel(room.id));
      if (addPresence(socket, room)) {
        const joined = { userId: user.id, username: user.username };
        socket.to(channel(room.id)).emit('presence:joined', { roomId: room.id, user: joined });
      }
      const present = presentUsers(room.id);
      io.to(channel(room.id)).emit('presence:update', { roomId: room.id, users: present });

      return { ok: true, history: await recentMessages(room.id), present };
    });

    // Leaves a room's live feed.
    handle('room:leave', async ({ roomId }) => {
      leave(socket, Number(roomId));
      return { ok: true };
    });

    // Saves a text or image message and broadcasts it to everyone in the room.
    handle('message:send', async ({ roomId, type, content }) => {
      if (isSuperAdmin) return { ok: false, message: SUPER_ADMIN_NO_CHAT };
      roomId = Number(roomId);
      if (!socket.data.rooms.has(roomId))
        return { ok: false, message: 'Join the room before sending messages' };

      // Membership is checked again in case the user was removed while in the room.
      const { error } = await roomForMember(roomId, user.id);
      if (error) return { ok: false, message: error };

      const { value, error: contentError } = validateContent(type, content);
      if (contentError) return { ok: false, message: contentError };

      // Read the sender fresh so a username or photo changed mid-session is used straight away.
      const sender = (await users.findOne({ id: user.id }, NO_ID)) ?? user;

      const message = {
        id: await nextId(db, 'messages'),
        roomId,
        senderId: sender.id,
        senderName: sender.username,
        type,
        content: value,
        timestamp: new Date().toISOString(), // server time; each browser shows it in local time
      };
      await storeMessage(message);

      const withPhoto = { ...message, senderPhoto: sender.profilePhoto ?? null };
      io.to(channel(roomId)).emit('message:new', withPhoto);
      return { ok: true, message: withPhoto };
    });

    // "X is typing..." is passed on to the others in the room. It is never stored.
    socket.on('typing', ({ roomId, typing } = {}) => {
      roomId = Number(roomId);
      if (!socket.data.rooms.has(roomId)) return;
      const who = { userId: user.id, username: user.username };
      socket.to(channel(roomId)).emit('typing', { roomId, user: who, typing: typing === true });
    });

    // Closing the tab (or losing the connection) leaves every room it was in.
    socket.on('disconnect', () => {
      for (const roomId of [...socket.data.rooms.keys()]) leave(socket, roomId);
    });
  });

  return { notify, refresh, notifySuperAdmin, removeFromGroup, closeRoom, removeAccount };
}

module.exports = initializeSockets;
