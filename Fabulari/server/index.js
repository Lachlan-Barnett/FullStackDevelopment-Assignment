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

  app.post('/api/groups', requireSuperAdmin, (req, res) => {
    const { name, description, ageLimit, colourTheme, adminUserId } = req.body;

    if (!name || !adminUserId) {
      return res.status(400).json({ message: 'Name and an admin user are required' });
    }

    const group = {
      id: nextId(db.groups),
      name,
      description: description || '',
      ageLimit: Number(ageLimit) || 0,
      colourTheme: colourTheme || 'Blue',
      members: [{ userId: Number(adminUserId), role: 'admin' }],
    };

    db.groups.push(group);
    saveDb(db);
    res.json(group);
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

    if (req.user.id === userId) {
      return res.status(403).json({ message: 'You cannot change your own admin status.' });
    }

    member.role = req.body.role === 'admin' ? 'admin' : 'member';
    saveDb(db);
    res.json(group);
  });

  app.get('/api/groups/:groupId/rooms', requireGroupMember, (req, res) => {
    const groupId = req.group.id;
    res.json(db.rooms.filter((r) => r.groupId === groupId));
  });

  app.post('/api/groups/:groupId/rooms', requireGroupAdmin, (req, res) => {
    const groupId = req.group.id;

    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });

    const room = { id: nextId(db.rooms), groupId, name, description: description || '' };
    db.rooms.push(room);
    saveDb(db);
    res.json(room);
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
