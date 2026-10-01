const jwt = require('jsonwebtoken');
const { NO_ID } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'fabulari-dev-secret';
const TOKEN_EXPIRY = '1d';

// Builds the login token helpers and the Express middleware that check who may use each route.
function createAuth(db) {
  const users = db.collection('users');
  const groups = db.collection('groups');

  // A login token holding the user's id, valid for one day.
  function signToken(user) {
    return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  }

  // Returns the user a token belongs to, or null if the token is invalid/expired or the user is gone.
  // Shared by the REST routes and the socket connection.
  async function userFromToken(token) {
    let id;
    try {
      ({ id } = jwt.verify(token, JWT_SECRET));
    } catch {
      return null;
    }
    return users.findOne({ id }, NO_ID);
  }

  // Reads "Authorization: Bearer <token>" and attaches the matching user to req.user.
  // The user is looked up fresh each time so role changes and deletions apply immediately.
  async function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Not logged in' });

    const user = await userFromToken(token);
    if (!user) return res.status(401).json({ message: 'Session expired, please log in again' });
    req.user = user;
    next();
  }

  // Must run after requireAuth: only the super admin may continue.
  function requireSuperAdmin(req, res, next) {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    next();
  }

  // Must run after requireAuth on a route with a :groupId param.
  async function requireGroupAdmin(req, res, next) {
    const group = await groups.findOne({ id: Number(req.params.groupId) }, NO_ID);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const isAdmin = group.members.some((m) => m.userId === req.user.id && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ message: 'Group admin only' });

    req.group = group;
    next();
  }

  // Must run after requireAuth on a route with a :groupId param.
  async function requireGroupMember(req, res, next) {
    const group = await groups.findOne({ id: Number(req.params.groupId) }, NO_ID);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    if (!group.members.some((m) => m.userId === req.user.id)) {
      return res.status(403).json({ message: 'Group members only' });
    }

    req.group = group;
    next();
  }

  // Must run after requireAuth on a route with a :userId param.
  function requireSelf(req, res, next) {
    if (Number(req.params.userId) !== req.user.id) {
      return res.status(403).json({ message: 'You can only change your own account' });
    }
    next();
  }

  return {
    signToken,
    userFromToken,
    requireAuth,
    requireSuperAdmin,
    requireGroupAdmin,
    requireGroupMember,
    requireSelf,
  };
}

module.exports = createAuth;
