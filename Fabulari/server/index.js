const bcrypt = require('bcryptjs');
const createAuth = require('./auth');
const { nextId, NO_ID, CASE_INSENSITIVE } = require('./db');
const { handleImageUpload, savePng, deleteUploads, saveAvatar, deleteAvatar } = require('./uploads');

const SALT_ROUNDS = 10;

// Group themes follow the Fabulari logo colours.
const COLOUR_THEMES = ['Blue', 'Yellow', 'Red'];

// Whole years between a "YYYY-MM-DD" birthdate and today. No birthdate counts as age 0.
function ageOf(birthdate) {
  if (!birthdate) return 0;
  const born = new Date(birthdate);
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const hadBirthday =
    today.getMonth() > born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate());
  return hadBirthday ? age : age - 1;
}

// A non-empty string. Request bodies are JSON, so a field could be a number, object, etc.
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Never send the password hash back to the client.
function publicUser(user) {
  const { passwordHash, _id, ...details } = user;
  return details;
}

function initializeRoutes(app, db) {
  const users = db.collection('users');
  const groups = db.collection('groups');
  const rooms = db.collection('rooms');
  const reports = db.collection('reports');
  const joinRequests = db.collection('joinRequests');
  const groupRequests = db.collection('groupRequests');
  const roomRequests = db.collection('roomRequests');
  const messages = db.collection('messages');
  const groupDeleteRequests = db.collection('groupDeleteRequests');

  const { signToken, requireAuth, requireSuperAdmin, requireGroupAdmin, requireGroupMember, requireSelf } =
    createAuth(db);

  // Adds a display name to each item, looked up from the user id in `idField`.
  async function withUsernames(items, idField, nameField) {
    const ids = [...new Set(items.map((i) => i[idField]))];
    const found = await users.find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, username: 1 } }).toArray();
    const names = new Map(found.map((u) => [u.id, u.username]));
    return items.map((i) => ({ ...i, [nameField]: names.get(i[idField]) ?? null }));
  }

  app.post('/api/auth', async (req, res) => {
    const { email, password } = req.body;

    if (!isText(email) || !isText(password)) {
      return res.status(400).json({ valid: false, message: 'Email and password are required' });
    }

    const user = await users.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.json({ valid: false });
    }

    res.json({ valid: true, token: signToken(user), ...publicUser(user) });
  });

  app.post('/api/signup', async (req, res) => {
    const { email, username, birthdate, password } = req.body;

    if (!isText(email) || !isText(username) || !isText(password)) {
      return res.status(400).json({ valid: false, message: 'Email, username and password are required' });
    }

    if (await users.findOne({ email })) {
      return res.status(409).json({ valid: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = {
      id: await nextId(db, 'users'),
      email,
      username,
      birthdate,
      passwordHash,
      role: 'user',
      profilePhoto: null,
    };
    await users.insertOne(user);

    res.json({ valid: true, token: signToken(user), ...publicUser(user) });
  });

  // Every route below this line requires a valid login token.
  app.use('/api', requireAuth);

  app.get('/api/users', async (req, res) => {
    res.json(await users.find({}, { projection: { _id: 0, passwordHash: 0 } }).toArray());
  });

  app.put('/api/users/:userId', requireSelf, async (req, res) => {
    const { username, birthdate } = req.body;
    const changes = {};
    if (username !== undefined) changes.username = username;
    if (birthdate !== undefined) changes.birthdate = birthdate;

    if (Object.keys(changes).length) {
      await users.updateOne({ id: req.user.id }, { $set: changes });
    }
    res.json(publicUser({ ...req.user, ...changes }));
  });

  app.put('/api/users/:userId/password', requireSelf, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Current password and the new password twice are required' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'New passwords do not match' });
    }
    if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
      return res.status(403).json({ message: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await users.updateOne({ id: req.user.id }, { $set: { passwordHash } });
    res.json({ updated: true });
  });

  // Profile photo: PNG only, 2MB max (same checks as chat images). Replaces any existing photo.
  app.put('/api/users/:userId/photo', requireSelf, handleImageUpload, async (req, res) => {
    const profilePhoto = await saveAvatar(req.user.id, req.file.buffer);
    await users.updateOne({ id: req.user.id }, { $set: { profilePhoto } });
    res.json(publicUser({ ...req.user, profilePhoto }));
  });

  app.delete('/api/users/:userId/photo', requireSelf, async (req, res) => {
    await deleteAvatar(req.user.id);
    await users.updateOne({ id: req.user.id }, { $set: { profilePhoto: null } });
    res.json(publicUser({ ...req.user, profilePhoto: null }));
  });

  app.get('/api/groups', async (req, res) => {
    res.json(await groups.find({}, NO_ID).sort({ id: 1 }).toArray());
  });

  app.get('/api/groups/:groupId', async (req, res) => {
    const group = await groups.findOne({ id: Number(req.params.groupId) }, NO_ID);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    res.json(group);
  });

  // Users ask for a group; the super admin creates it by approving the request.
  // The requester becomes the new group's first admin.
  app.post('/api/group-requests', async (req, res) => {
    if (req.user.role === 'superadmin') {
      return res.status(403).json({ message: 'The super admin cannot request groups' });
    }

    const { name, description, ageLimit, colourTheme } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'A group name is required' });
    if (colourTheme !== undefined && !COLOUR_THEMES.includes(colourTheme)) {
      return res.status(400).json({ message: `Colour theme must be one of: ${COLOUR_THEMES.join(', ')}` });
    }

    const trimmedName = name.trim();
    if (await groups.findOne({ name: trimmedName }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'A group with that name already exists' });
    }
    if (await groupRequests.findOne({ name: trimmedName, status: 'pending' }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'A group with that name has already been requested' });
    }

    const request = {
      id: await nextId(db, 'groupRequests'),
      requestedBy: req.user.id,
      name: trimmedName,
      description: description?.trim() || '',
      ageLimit: Math.max(0, Number(ageLimit) || 0),
      colourTheme: colourTheme || 'Blue',
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    await groupRequests.insertOne({ ...request });
    res.json(request);
  });

  app.get('/api/group-requests/mine', async (req, res) => {
    res.json(await groupRequests.find({ requestedBy: req.user.id }, NO_ID).sort({ id: 1 }).toArray());
  });

  app.get('/api/admin/group-requests', requireSuperAdmin, async (req, res) => {
    const pending = await groupRequests.find({ status: 'pending' }, NO_ID).sort({ id: 1 }).toArray();
    res.json(await withUsernames(pending, 'requestedBy', 'requesterName'));
  });

  app.put('/api/admin/group-requests/:requestId', requireSuperAdmin, async (req, res) => {
    const request = await groupRequests.findOne({ id: Number(req.params.requestId) }, NO_ID);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'Request already actioned' });

    const approve = req.body.approve === true;

    if (!approve) {
      const changes = { status: 'rejected', reviewedBy: req.user.id, rejectionReason: req.body.reason?.trim() || null };
      await groupRequests.updateOne({ id: request.id }, { $set: changes });
      return res.json({ ...request, ...changes });
    }

    if (!(await users.findOne({ id: request.requestedBy }))) {
      return res.status(400).json({ message: 'The requesting user no longer exists' });
    }
    if (await groups.findOne({ name: request.name }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'A group with that name already exists' });
    }

    const group = {
      id: await nextId(db, 'groups'),
      name: request.name,
      description: request.description,
      ageLimit: request.ageLimit,
      colourTheme: request.colourTheme,
      members: [{ userId: request.requestedBy, role: 'admin' }],
    };
    await groups.insertOne({ ...group });

    const changes = { status: 'approved', reviewedBy: req.user.id };
    await groupRequests.updateOne({ id: request.id }, { $set: changes });
    res.json({ request: { ...request, ...changes }, group });
  });

  app.put('/api/groups/:groupId', requireGroupAdmin, async (req, res) => {
    const { description, ageLimit, colourTheme } = req.body;
    if (colourTheme !== undefined && !COLOUR_THEMES.includes(colourTheme)) {
      return res.status(400).json({ message: `Colour theme must be one of: ${COLOUR_THEMES.join(', ')}` });
    }

    const changes = {};
    if (description !== undefined) changes.description = description;
    if (ageLimit !== undefined) changes.ageLimit = Number(ageLimit) || 0;
    if (colourTheme !== undefined) changes.colourTheme = colourTheme;

    if (Object.keys(changes).length) {
      await groups.updateOne({ id: req.group.id }, { $set: changes });
    }
    res.json({ ...req.group, ...changes });
  });

  // Member list for people inside the group. Profiles are private, so only username and role are shared.
  app.get('/api/groups/:groupId/members', requireGroupMember, async (req, res) => {
    res.json(await withUsernames(req.group.members, 'userId', 'username'));
  });

  // Joining is a request the group admin approves. Users under the age limit are rejected straight away.
  app.post('/api/groups/:groupId/join-requests', async (req, res) => {
    // The super admin runs the system but doesn't take part in groups or chat.
    if (req.user.role === 'superadmin') {
      return res.status(403).json({ message: 'The super admin cannot join groups' });
    }

    const group = await groups.findOne({ id: Number(req.params.groupId) }, NO_ID);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const userId = req.user.id;
    if (group.members.some((m) => m.userId === userId)) {
      return res.status(409).json({ message: 'Already a member of this group' });
    }
    if (await joinRequests.findOne({ groupId: group.id, userId, status: 'pending' })) {
      return res.status(409).json({ message: 'You already have a pending request for this group' });
    }

    const underAge = ageOf(req.user.birthdate) < group.ageLimit;
    const request = {
      id: await nextId(db, 'joinRequests'),
      groupId: group.id,
      userId,
      status: underAge ? 'rejected' : 'pending',
      rejectionReason: underAge ? `You must be ${group.ageLimit} or older to join this group` : null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    await joinRequests.insertOne({ ...request });
    res.json(request);
  });

  app.get('/api/join-requests/mine', async (req, res) => {
    res.json(await joinRequests.find({ userId: req.user.id }, NO_ID).sort({ id: 1 }).toArray());
  });

  app.get('/api/groups/:groupId/join-requests', requireGroupAdmin, async (req, res) => {
    const pending = await joinRequests.find({ groupId: req.group.id, status: 'pending' }, NO_ID).sort({ id: 1 }).toArray();
    res.json(await withUsernames(pending, 'userId', 'username'));
  });

  app.put('/api/groups/:groupId/join-requests/:requestId', requireGroupAdmin, async (req, res) => {
    const group = req.group;
    const request = await joinRequests.findOne({ id: Number(req.params.requestId), groupId: group.id }, NO_ID);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'Request already actioned' });

    const applicant = await users.findOne({ id: request.userId });
    const approve = req.body.approve === true;

    // Re-check the age in case the group's limit was raised after the request was made.
    if (approve && (!applicant || ageOf(applicant.birthdate) < group.ageLimit)) {
      return res.status(400).json({ message: 'That user no longer meets the group age limit' });
    }

    const changes = { status: approve ? 'approved' : 'rejected', reviewedBy: req.user.id };
    if (approve) {
      await groups.updateOne({ id: group.id }, { $push: { members: { userId: request.userId, role: 'member' } } });
    } else {
      changes.rejectionReason = req.body.reason?.trim() || null;
    }

    await joinRequests.updateOne({ id: request.id }, { $set: changes });
    res.json({ ...request, ...changes });
  });

  app.put('/api/groups/:groupId/members/:userId/role', requireGroupAdmin, async (req, res) => {
    const group = req.group;

    const userId = Number(req.params.userId);
    const member = group.members.find((m) => m.userId === userId);
    if (!member) return res.status(404).json({ message: 'User is not a member of this group' });

    // Any admin may demote any admin, including themselves, as long as one admin is left.
    const newRole = req.body.role === 'admin' ? 'admin' : 'member';
    const adminCount = group.members.filter((m) => m.role === 'admin').length;
    if (member.role === 'admin' && newRole === 'member' && adminCount === 1) {
      return res.status(409).json({ message: 'A group must always have at least one admin. Promote someone else first.' });
    }

    await groups.updateOne({ id: group.id, 'members.userId': userId }, { $set: { 'members.$.role': newRole } });
    res.json(await groups.findOne({ id: group.id }, NO_ID));
  });

  app.get('/api/groups/:groupId/rooms', requireGroupMember, async (req, res) => {
    res.json(await rooms.find({ groupId: req.group.id }, NO_ID).sort({ id: 1 }).toArray());
  });

  // Members propose rooms; a group admin approves (creating the room) or rejects with a reason.
  app.post('/api/groups/:groupId/room-requests', requireGroupMember, async (req, res) => {
    const groupId = req.group.id;
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'A room name is required' });

    const trimmedName = name.trim();
    if (await rooms.findOne({ groupId, name: trimmedName }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'This group already has a room with that name' });
    }
    if (await roomRequests.findOne({ groupId, name: trimmedName, status: 'pending' }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'A room with that name has already been requested' });
    }

    const request = {
      id: await nextId(db, 'roomRequests'),
      groupId,
      requestedBy: req.user.id,
      name: trimmedName,
      description: description?.trim() || '',
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    await roomRequests.insertOne({ ...request });
    res.json(request);
  });

  app.get('/api/room-requests/mine', async (req, res) => {
    res.json(await roomRequests.find({ requestedBy: req.user.id }, NO_ID).sort({ id: 1 }).toArray());
  });

  app.get('/api/groups/:groupId/room-requests', requireGroupAdmin, async (req, res) => {
    const pending = await roomRequests.find({ groupId: req.group.id, status: 'pending' }, NO_ID).sort({ id: 1 }).toArray();
    res.json(await withUsernames(pending, 'requestedBy', 'requesterName'));
  });

  app.put('/api/groups/:groupId/room-requests/:requestId', requireGroupAdmin, async (req, res) => {
    const groupId = req.group.id;
    const request = await roomRequests.findOne({ id: Number(req.params.requestId), groupId }, NO_ID);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'Request already actioned' });
    if (request.requestedBy === req.user.id) {
      return res.status(403).json({ message: 'Another admin must review your own request' });
    }

    const approve = req.body.approve === true;

    if (!approve) {
      const reason = req.body.reason?.trim();
      if (!reason) return res.status(400).json({ message: 'A reason is required to reject a room request' });
      const changes = { status: 'rejected', rejectionReason: reason, reviewedBy: req.user.id };
      await roomRequests.updateOne({ id: request.id }, { $set: changes });
      return res.json({ ...request, ...changes });
    }

    if (await rooms.findOne({ groupId, name: request.name }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'This group already has a room with that name' });
    }

    const room = {
      id: await nextId(db, 'rooms'),
      groupId,
      name: request.name,
      description: request.description,
      createdAt: new Date().toISOString(),
    };
    await rooms.insertOne({ ...room });

    const changes = { status: 'approved', reviewedBy: req.user.id };
    await roomRequests.updateOne({ id: request.id }, { $set: changes });
    res.json({ request: { ...request, ...changes }, room });
  });

  app.delete('/api/groups/:groupId/rooms/:roomId', requireGroupAdmin, async (req, res) => {
    const roomId = Number(req.params.roomId);
    const result = await rooms.deleteOne({ id: roomId, groupId: req.group.id });
    if (!result.deletedCount) return res.status(404).json({ message: 'Room not found' });

    const images = await messages.find({ roomId, type: 'image' }, { projection: { content: 1 } }).toArray();
    await messages.deleteMany({ roomId });
    await deleteUploads(images.map((m) => m.content));
    res.json({ deleted: true });
  });

  // Step 1 of sending an image: upload the PNG (max 2MB) and get back its path.
  // Step 2 is sending a message:send over the socket with type "image" and that path.
  // The room is checked before the file is read, so non-members can't upload at all.
  app.post(
    '/api/rooms/:roomId/images',
    async (req, res, next) => {
      const room = await rooms.findOne({ id: Number(req.params.roomId) }, NO_ID);
      if (!room) return res.status(404).json({ message: 'Room not found' });
      const group = await groups.findOne({ id: room.groupId }, NO_ID);
      if (!group?.members.some((m) => m.userId === req.user.id)) {
        return res.status(403).json({ message: 'Group members only' });
      }
      next();
    },
    handleImageUpload,
    async (req, res) => {
      res.json({ url: await savePng(req.file.buffer) });
    },
  );

  // Group deletion: a group admin asks, the super admin decides. Groups are never deleted directly.
  app.post('/api/groups/:groupId/delete-requests', requireGroupAdmin, async (req, res) => {
    const group = req.group;
    if (await groupDeleteRequests.findOne({ groupId: group.id, status: 'pending' })) {
      return res.status(409).json({ message: 'A deletion request for this group is already waiting' });
    }

    const request = {
      id: await nextId(db, 'groupDeleteRequests'),
      groupId: group.id,
      groupName: group.name, // kept so the request still makes sense once the group is gone
      requestedBy: req.user.id,
      reason: req.body.reason?.trim() || '',
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    await groupDeleteRequests.insertOne({ ...request });
    res.json(request);
  });

  app.get('/api/groups/:groupId/delete-requests', requireGroupAdmin, async (req, res) => {
    res.json(await groupDeleteRequests.find({ groupId: req.group.id }, NO_ID).sort({ id: -1 }).toArray());
  });

  app.get('/api/admin/group-delete-requests', requireSuperAdmin, async (req, res) => {
    const pending = await groupDeleteRequests.find({ status: 'pending' }, NO_ID).sort({ id: 1 }).toArray();
    res.json(await withUsernames(pending, 'requestedBy', 'requesterName'));
  });

  app.put('/api/admin/group-delete-requests/:requestId', requireSuperAdmin, async (req, res) => {
    const request = await groupDeleteRequests.findOne({ id: Number(req.params.requestId) }, NO_ID);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'Request already actioned' });

    const approve = req.body.approve === true;
    const changes = { status: approve ? 'approved' : 'rejected', reviewedBy: req.user.id };
    if (!approve) changes.rejectionReason = req.body.reason?.trim() || null;

    if (approve) {
      // Remove the group and everything that only exists inside it.
      const groupId = request.groupId;
      const roomIds = (await rooms.find({ groupId }, { projection: { id: 1 } }).toArray()).map((r) => r.id);
      const images = await messages
        .find({ roomId: { $in: roomIds }, type: 'image' }, { projection: { content: 1 } })
        .toArray();
      await messages.deleteMany({ roomId: { $in: roomIds } });
      await deleteUploads(images.map((m) => m.content));
      await rooms.deleteMany({ groupId });
      await joinRequests.deleteMany({ groupId, status: 'pending' });
      await roomRequests.deleteMany({ groupId, status: 'pending' });
      await groups.deleteOne({ id: groupId });
    }

    await groupDeleteRequests.updateOne({ id: request.id }, { $set: changes });
    res.json({ ...request, ...changes });
  });

  // A report is always filed within a group, so that group's admins can act on it.
  app.post('/api/reports', async (req, res) => {
    const { groupId, username, reason } = req.body;
    if (!groupId || !username?.trim() || !reason?.trim()) {
      return res.status(400).json({ message: 'Group, username and reason are required' });
    }

    const group = await groups.findOne({ id: Number(groupId) }, NO_ID);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (!group.members.some((m) => m.userId === req.user.id)) {
      return res.status(403).json({ message: 'You can only report users in groups you belong to' });
    }

    const reported = await users.findOne({
      username: username.trim(),
      id: { $in: group.members.map((m) => m.userId) },
    });
    if (!reported) return res.status(404).json({ message: `No member called "${username.trim()}" in that group` });
    if (reported.id === req.user.id) return res.status(400).json({ message: 'You cannot report yourself' });

    const report = {
      id: await nextId(db, 'reports'),
      reportedUserId: reported.id,
      reportedBy: req.user.id,
      groupId: group.id,
      reason: reason.trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await reports.insertOne({ ...report });
    res.json(report);
  });

  // Anything that throws (e.g. the database going down) ends up here instead of crashing the server.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: 'Something went wrong on the server' });
  });
}

module.exports = initializeRoutes;
