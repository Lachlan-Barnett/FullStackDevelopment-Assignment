const bcrypt = require('bcryptjs');
const { loadDb, saveDb } = require('./data');
const createAuth = require('./auth');

const SALT_ROUNDS = 10;

function nextId(items) {
  return items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
}

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

// Never send the password hash back to the client.
function publicUser(user) {
  const { passwordHash, ...details } = user;
  return details;
}

function initializeRoutes(app) {
  const db = loadDb();
  const { signToken, requireAuth, requireSuperAdmin, requireGroupAdmin, requireGroupMember, requireSelf } =
    createAuth(db);

  app.post('/api/auth', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ valid: false, message: 'Email and password are required' });
    }

    const user = db.users.find((u) => u.email === email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.json({ valid: false });
    }

    res.json({ valid: true, token: signToken(user), ...publicUser(user) });
  });

  app.post('/api/signup', async (req, res) => {
    const { email, username, birthdate, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ valid: false, message: 'Email, username and password are required' });
    }

    if (db.users.some((u) => u.email === email)) {
      return res.status(409).json({ valid: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = { id: nextId(db.users), email, username, birthdate, passwordHash, role: 'user' };
    db.users.push(user);
    saveDb(db);

    res.json({ valid: true, token: signToken(user), ...publicUser(user) });
  });

  // Every route below this line requires a valid login token.
  app.use('/api', requireAuth);

  app.get('/api/users', (req, res) => {
    res.json(db.users.map(publicUser));
  });

  app.put('/api/users/:userId', requireSelf, (req, res) => {
    const user = req.user;

    const { username, birthdate } = req.body;
    if (username !== undefined) user.username = username;
    if (birthdate !== undefined) user.birthdate = birthdate;

    saveDb(db);
    res.json(publicUser(user));
  });

  app.put('/api/users/:userId/password', requireSelf, async (req, res) => {
    const user = req.user;

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(403).json({ message: 'Current password is incorrect' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    saveDb(db);
    res.json({ updated: true });
  });

  app.get('/api/groups', (req, res) => {
    res.json(db.groups);
  });

  app.get('/api/groups/:groupId', (req, res) => {
    const group = db.groups.find((g) => g.id === Number(req.params.groupId));
    if (!group) return res.status(404).json({ message: 'Group not found' });
    res.json(group);
  });

  // Users ask for a group; the super admin creates it by approving the request.
  // The requester becomes the new group's first admin.
  app.post('/api/group-requests', (req, res) => {
    if (req.user.role === 'superadmin') {
      return res.status(403).json({ message: 'The super admin cannot request groups' });
    }

    const { name, description, ageLimit, colourTheme } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'A group name is required' });

    const nameTaken = (n) => n.toLowerCase() === name.trim().toLowerCase();
    if (db.groups.some((g) => nameTaken(g.name))) {
      return res.status(409).json({ message: 'A group with that name already exists' });
    }
    if (db.groupRequests.some((r) => r.status === 'pending' && nameTaken(r.name))) {
      return res.status(409).json({ message: 'A group with that name has already been requested' });
    }

    const request = {
      id: nextId(db.groupRequests),
      requestedBy: req.user.id,
      name: name.trim(),
      description: description?.trim() || '',
      ageLimit: Math.max(0, Number(ageLimit) || 0),
      colourTheme: colourTheme || 'Blue',
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    db.groupRequests.push(request);
    saveDb(db);
    res.json(request);
  });

  app.get('/api/group-requests/mine', (req, res) => {
    res.json(db.groupRequests.filter((r) => r.requestedBy === req.user.id));
  });

  app.get('/api/admin/group-requests', requireSuperAdmin, (req, res) => {
    const pending = db.groupRequests.filter((r) => r.status === 'pending');
    res.json(
      pending.map((r) => ({ ...r, requesterName: db.users.find((u) => u.id === r.requestedBy)?.username ?? null })),
    );
  });

  app.put('/api/admin/group-requests/:requestId', requireSuperAdmin, (req, res) => {
    const request = db.groupRequests.find((r) => r.id === Number(req.params.requestId));
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'Request already actioned' });

    const approve = req.body.approve === true;

    if (!approve) {
      request.status = 'rejected';
      request.reviewedBy = req.user.id;
      request.rejectionReason = req.body.reason?.trim() || null;
      saveDb(db);
      return res.json(request);
    }

    if (!db.users.some((u) => u.id === request.requestedBy)) {
      return res.status(400).json({ message: 'The requesting user no longer exists' });
    }
    if (db.groups.some((g) => g.name.toLowerCase() === request.name.toLowerCase())) {
      return res.status(409).json({ message: 'A group with that name already exists' });
    }

    const group = {
      id: nextId(db.groups),
      name: request.name,
      description: request.description,
      ageLimit: request.ageLimit,
      colourTheme: request.colourTheme,
      members: [{ userId: request.requestedBy, role: 'admin' }],
    };
    db.groups.push(group);
    request.status = 'approved';
    request.reviewedBy = req.user.id;
    saveDb(db);
    res.json({ request, group });
  });

  app.put('/api/groups/:groupId', requireGroupAdmin, (req, res) => {
    const group = req.group;

    const { description, ageLimit, colourTheme } = req.body;
    if (description !== undefined) group.description = description;
    if (ageLimit !== undefined) group.ageLimit = Number(ageLimit) || 0;
    if (colourTheme !== undefined) group.colourTheme = colourTheme;

    saveDb(db);
    res.json(group);
  });

  // Joining is a request the group admin approves. Users under the age limit are rejected straight away.
  app.post('/api/groups/:groupId/join-requests', (req, res) => {
    const group = db.groups.find((g) => g.id === Number(req.params.groupId));
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const userId = req.user.id;
    if (group.members.some((m) => m.userId === userId)) {
      return res.status(409).json({ message: 'Already a member of this group' });
    }
    if (db.joinRequests.some((r) => r.groupId === group.id && r.userId === userId && r.status === 'pending')) {
      return res.status(409).json({ message: 'You already have a pending request for this group' });
    }

    const underAge = ageOf(req.user.birthdate) < group.ageLimit;
    const request = {
      id: nextId(db.joinRequests),
      groupId: group.id,
      userId,
      status: underAge ? 'rejected' : 'pending',
      rejectionReason: underAge ? `You must be ${group.ageLimit} or older to join this group` : null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    db.joinRequests.push(request);
    saveDb(db);
    res.json(request);
  });

  app.get('/api/join-requests/mine', (req, res) => {
    res.json(db.joinRequests.filter((r) => r.userId === req.user.id));
  });

  app.get('/api/groups/:groupId/join-requests', requireGroupAdmin, (req, res) => {
    const pending = db.joinRequests.filter((r) => r.groupId === req.group.id && r.status === 'pending');
    res.json(
      pending.map((r) => ({ ...r, username: db.users.find((u) => u.id === r.userId)?.username ?? null })),
    );
  });

  app.put('/api/groups/:groupId/join-requests/:requestId', requireGroupAdmin, (req, res) => {
    const group = req.group;
    const request = db.joinRequests.find(
      (r) => r.id === Number(req.params.requestId) && r.groupId === group.id,
    );
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'Request already actioned' });

    const applicant = db.users.find((u) => u.id === request.userId);
    const approve = req.body.approve === true;

    // Re-check the age in case the group's limit was raised after the request was made.
    if (approve && (!applicant || ageOf(applicant.birthdate) < group.ageLimit)) {
      return res.status(400).json({ message: 'That user no longer meets the group age limit' });
    }

    request.status = approve ? 'approved' : 'rejected';
    request.reviewedBy = req.user.id;
    if (approve) {
      group.members.push({ userId: request.userId, role: 'member' });
    } else {
      request.rejectionReason = req.body.reason?.trim() || null;
    }

    saveDb(db);
    res.json(request);
  });

  app.put('/api/groups/:groupId/members/:userId/role', requireGroupAdmin, (req, res) => {
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

    member.role = newRole;
    saveDb(db);
    res.json(group);
  });

  app.get('/api/groups/:groupId/rooms', requireGroupMember, (req, res) => {
    const groupId = req.group.id;
    res.json(db.rooms.filter((r) => r.groupId === groupId));
  });

  // Members propose rooms; a group admin approves (creating the room) or rejects with a reason.
  app.post('/api/groups/:groupId/room-requests', requireGroupMember, (req, res) => {
    const groupId = req.group.id;
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'A room name is required' });

    const nameTaken = (n) => n.toLowerCase() === name.trim().toLowerCase();
    if (db.rooms.some((r) => r.groupId === groupId && nameTaken(r.name))) {
      return res.status(409).json({ message: 'This group already has a room with that name' });
    }
    if (db.roomRequests.some((r) => r.groupId === groupId && r.status === 'pending' && nameTaken(r.name))) {
      return res.status(409).json({ message: 'A room with that name has already been requested' });
    }

    const request = {
      id: nextId(db.roomRequests),
      groupId,
      requestedBy: req.user.id,
      name: name.trim(),
      description: description?.trim() || '',
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    db.roomRequests.push(request);
    saveDb(db);
    res.json(request);
  });

  app.get('/api/room-requests/mine', (req, res) => {
    res.json(db.roomRequests.filter((r) => r.requestedBy === req.user.id));
  });

  app.get('/api/groups/:groupId/room-requests', requireGroupAdmin, (req, res) => {
    const pending = db.roomRequests.filter((r) => r.groupId === req.group.id && r.status === 'pending');
    res.json(
      pending.map((r) => ({ ...r, requesterName: db.users.find((u) => u.id === r.requestedBy)?.username ?? null })),
    );
  });

  app.put('/api/groups/:groupId/room-requests/:requestId', requireGroupAdmin, (req, res) => {
    const groupId = req.group.id;
    const request = db.roomRequests.find((r) => r.id === Number(req.params.requestId) && r.groupId === groupId);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'Request already actioned' });
    if (request.requestedBy === req.user.id) {
      return res.status(403).json({ message: 'Another admin must review your own request' });
    }

    const approve = req.body.approve === true;

    if (!approve) {
      const reason = req.body.reason?.trim();
      if (!reason) return res.status(400).json({ message: 'A reason is required to reject a room request' });
      request.status = 'rejected';
      request.rejectionReason = reason;
      request.reviewedBy = req.user.id;
      saveDb(db);
      return res.json(request);
    }

    if (db.rooms.some((r) => r.groupId === groupId && r.name.toLowerCase() === request.name.toLowerCase())) {
      return res.status(409).json({ message: 'This group already has a room with that name' });
    }

    const room = {
      id: nextId(db.rooms),
      groupId,
      name: request.name,
      description: request.description,
      createdAt: new Date().toISOString(),
    };
    db.rooms.push(room);
    request.status = 'approved';
    request.reviewedBy = req.user.id;
    saveDb(db);
    res.json({ request, room });
  });

  app.delete('/api/groups/:groupId/rooms/:roomId', requireGroupAdmin, (req, res) => {
    const groupId = req.group.id;
    const roomId = Number(req.params.roomId);
    const index = db.rooms.findIndex((r) => r.id === roomId && r.groupId === groupId);
    if (index === -1) return res.status(404).json({ message: 'Room not found' });

    db.rooms.splice(index, 1);
    saveDb(db);
    res.json({ deleted: true });
  });

  // A report is always filed within a group, so that group's admins can act on it.
  app.post('/api/reports', (req, res) => {
    const { groupId, username, reason } = req.body;
    if (!groupId || !username?.trim() || !reason?.trim()) {
      return res.status(400).json({ message: 'Group, username and reason are required' });
    }

    const group = db.groups.find((g) => g.id === Number(groupId));
    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (!group.members.some((m) => m.userId === req.user.id)) {
      return res.status(403).json({ message: 'You can only report users in groups you belong to' });
    }

    const reported = db.users.find(
      (u) => u.username === username.trim() && group.members.some((m) => m.userId === u.id),
    );
    if (!reported) return res.status(404).json({ message: `No member called "${username.trim()}" in that group` });
    if (reported.id === req.user.id) return res.status(400).json({ message: 'You cannot report yourself' });

    const report = {
      id: nextId(db.reports),
      reportedUserId: reported.id,
      reportedBy: req.user.id,
      groupId: group.id,
      reason: reason.trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    db.reports.push(report);
    saveDb(db);
    res.json(report);
  });
}

module.exports = initializeRoutes;
