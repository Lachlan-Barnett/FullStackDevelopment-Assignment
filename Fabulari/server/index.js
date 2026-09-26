const bcrypt = require('bcryptjs');
const { loadDb, saveDb } = require('./data');

const SALT_ROUNDS = 10;

function nextId(items) {
  return items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
}

// Never send the password hash back to the client.
function publicUser(user) {
  const { passwordHash, ...details } = user;
  return details;
}

function initializeRoutes(app) {
  const db = loadDb();

  app.post('/api/auth', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ valid: false, message: 'Email and password are required' });
    }

    const user = db.users.find((u) => u.email === email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.json({ valid: false });
    }

    res.json({ valid: true, ...publicUser(user) });
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

    res.json({ valid: true, ...publicUser(user) });
  });

  app.get('/api/users', (req, res) => {
    res.json(db.users.map(publicUser));
  });

  app.put('/api/users/:userId', (req, res) => {
    const user = db.users.find((u) => u.id === Number(req.params.userId));
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { username, birthdate } = req.body;
    if (username !== undefined) user.username = username;
    if (birthdate !== undefined) user.birthdate = birthdate;

    saveDb(db);
    res.json(publicUser(user));
  });

  app.put('/api/users/:userId/password', async (req, res) => {
    const user = db.users.find((u) => u.id === Number(req.params.userId));
    if (!user) return res.status(404).json({ message: 'User not found' });

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

  app.post('/api/groups', (req, res) => {
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

  app.put('/api/groups/:groupId', (req, res) => {
    const group = db.groups.find((g) => g.id === Number(req.params.groupId));
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const { description, ageLimit, colourTheme } = req.body;
    if (description !== undefined) group.description = description;
    if (ageLimit !== undefined) group.ageLimit = Number(ageLimit) || 0;
    if (colourTheme !== undefined) group.colourTheme = colourTheme;

    saveDb(db);
    res.json(group);
  });

  app.post('/api/groups/:groupId/join', (req, res) => {
    const group = db.groups.find((g) => g.id === Number(req.params.groupId));
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const userId = Number(req.body.userId);
    if (group.members.some((m) => m.userId === userId)) {
      return res.status(409).json({ message: 'Already a member of this group' });
    }

    group.members.push({ userId, role: 'member' });
    saveDb(db);
    res.json(group);
  });

  app.put('/api/groups/:groupId/members/:userId/role', (req, res) => {
    const group = db.groups.find((g) => g.id === Number(req.params.groupId));
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const userId = Number(req.params.userId);
    const member = group.members.find((m) => m.userId === userId);
    if (!member) return res.status(404).json({ message: 'User is not a member of this group' });

    if (Number(req.body.actingUserId) === userId) {
      return res.status(403).json({ message: 'You cannot change your own admin status.' });
    }

    member.role = req.body.role === 'admin' ? 'admin' : 'member';
    saveDb(db);
    res.json(group);
  });

  app.get('/api/groups/:groupId/rooms', (req, res) => {
    const groupId = Number(req.params.groupId);
    res.json(db.rooms.filter((r) => r.groupId === groupId));
  });

  app.post('/api/groups/:groupId/rooms', (req, res) => {
    const groupId = Number(req.params.groupId);
    const group = db.groups.find((g) => g.id === groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });

    const room = { id: nextId(db.rooms), groupId, name, description: description || '' };
    db.rooms.push(room);
    saveDb(db);
    res.json(room);
  });

  app.delete('/api/groups/:groupId/rooms/:roomId', (req, res) => {
    const groupId = Number(req.params.groupId);
    const roomId = Number(req.params.roomId);
    const index = db.rooms.findIndex((r) => r.id === roomId && r.groupId === groupId);
    if (index === -1) return res.status(404).json({ message: 'Room not found' });

    db.rooms.splice(index, 1);
    saveDb(db);
    res.json({ deleted: true });
  });
}

module.exports = initializeRoutes;
