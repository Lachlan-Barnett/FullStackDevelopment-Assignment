const bcrypt = require('bcryptjs');
const createAuth = require('./auth');
const { nextId, NO_ID, CASE_INSENSITIVE } = require('./db');
const {
  handleImageUpload,
  savePng,
  deleteUploads,
  saveAvatar,
  deleteAvatar,
} = require('./uploads');

const SALT_ROUNDS = 10;

// Group themes follow the Fabulari logo colours.
const COLOUR_THEMES = ['Blue', 'Yellow', 'Red'];

// Longest allowed text for each kind of field. The Angular forms use the same limits.
const LIMITS = { email: 254, username: 30, password: 100, name: 50, description: 500, reason: 500 };

// How many audit log entries one page of the super admin's log holds, by default and at most.
const AUDIT_PAGE_SIZE = 50;
const AUDIT_MAX_PAGE_SIZE = 200;

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

// Required text: the trimmed string if it has 1 to `max` characters, otherwise null.
function requiredText(value, max) {
  if (!isText(value)) return null;
  const text = value.trim();
  return text.length <= max ? text : null;
}

// Optional text: '' when left out, the trimmed string when it fits, or null when it is too long or not text.
function optionalText(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length <= max ? text : null;
}

// A simple email shape check: no spaces, one @, and a dot in the part after it.
function isValidEmail(email) {
  return email.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// A real "YYYY-MM-DD" date from 1900 up to today (a birthdate can't be in the future).
function isValidBirthdate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false; // e.g. 2001-02-30
  return value >= '1900-01-01' && value <= new Date().toISOString().slice(0, 10);
}

// Age limits are whole years from 0 to 120. Returns the number, or null if the value isn't valid.
function parseAgeLimit(value) {
  const limit = Number(value);
  return value !== '' && value !== null && Number.isInteger(limit) && limit >= 0 && limit <= 120
    ? limit
    : null;
}

// A group as sent to a user: who is banned stays private; the user only learns whether *they* are banned.
function groupFor(group, userId) {
  const { bannedUserIds = [], _id, ...rest } = group;
  return { ...rest, isBanned: bannedUserIds.includes(userId) };
}

// Never send the password hash back to the client. Accounts made before dark mode was saved count as light.
function publicUser(user) {
  const { passwordHash, _id, ...details } = user;
  return { ...details, darkMode: details.darkMode === true };
}

// User ids of a group's members, and of its admins.
const memberIds = (group) => group.members.map((m) => m.userId);
const adminIds = (group) => group.members.filter((m) => m.role === 'admin').map((m) => m.userId);

// Registers every REST route. `live` holds the socket helpers (socket.js) used to push real-time updates.
function initializeRoutes(app, db, live) {
  const users = db.collection('users');
  const groups = db.collection('groups');
  const rooms = db.collection('rooms');
  const reports = db.collection('reports');
  const joinRequests = db.collection('joinRequests');
  const groupRequests = db.collection('groupRequests');
  const roomRequests = db.collection('roomRequests');
  const messages = db.collection('messages');
  const groupDeleteRequests = db.collection('groupDeleteRequests');
  const bans = db.collection('bans');
  const systemBanRequests = db.collection('systemBanRequests');
  const bannedEmails = db.collection('bannedEmails');
  const auditLog = db.collection('auditLog');

  const {
    signToken,
    requireAuth,
    requireSuperAdmin,
    requireGroupAdmin,
    requireGroupMember,
    requireSelf,
  } = createAuth(db);

  // Adds a display name to each item, looked up from the user id in `idField`.
  async function withUsernames(items, idField, nameField) {
    const ids = [...new Set(items.map((i) => i[idField]))];
    const found = await users
      .find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, username: 1 } })
      .toArray();
    const names = new Map(found.map((u) => [u.id, u.username]));
    return items.map((i) => ({ ...i, [nameField]: names.get(i[idField]) ?? null }));
  }

  // Records an entry in the super admin's audit log. Names are stored with the entry so the log still
  // reads correctly after an account or group is deleted. The super admin's open dashboard reloads.
  async function audit(type, actor, details, target = {}) {
    await auditLog.insertOne({
      id: await nextId(db, 'auditLog'),
      type,
      actorId: actor?.id ?? null,
      actorName: actor?.username ?? null,
      targetType: target.type ?? null, // "user", "group", "room", "report"...
      targetId: target.id ?? null,
      details,
      timestamp: new Date().toISOString(),
    });
    live.notifySuperAdmin();
  }

  // The given user ids without the person making the request, who doesn't need a pop-up about their own action.
  const others = (ids, req) => ids.filter((id) => id !== req.user.id);

  // A username already used by someone else (ignoring case), or null.
  const usernameTaken = (username, exceptId = null) =>
    users.findOne({ username, id: { $ne: exceptId } }, { collation: CASE_INSENSITIVE });

  // Logs in with an email or a username, plus the password. Returns the user and a login token.
  app.post('/api/auth', async (req, res) => {
    const { password } = req.body;
    const login = req.body.login ?? req.body.email; // "email" is the older name for the same field

    if (!isText(login) || !isText(password)) {
      return res
        .status(400)
        .json({ valid: false, message: 'Enter your email or username, and your password' });
    }

    // Usernames can't contain "@", so anything with one is an email.
    const name = login.trim();
    const user = name.includes('@')
      ? await users.findOne({ email: name.toLowerCase() })
      : await users.findOne({ username: name }, { collation: CASE_INSENSITIVE });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.json({ valid: false });
    }

    res.json({ valid: true, token: signToken(user), ...publicUser(user) });
  });

  // Creates a normal user account. Emails are stored in lower case, so they are unique ignoring case.
  app.post('/api/signup', async (req, res) => {
    const { birthdate, password } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const username = requiredText(req.body.username, LIMITS.username);

    if (!isValidEmail(email)) {
      return res.status(400).json({ valid: false, message: 'Enter a valid email address' });
    }
    if (!username || username.includes('@')) {
      return res.status(400).json({
        valid: false,
        message: `Enter a username of at most ${LIMITS.username} characters, without "@"`,
      });
    }
    if (!isText(password) || password.length > LIMITS.password) {
      return res.status(400).json({
        valid: false,
        message: `Enter a password of at most ${LIMITS.password} characters`,
      });
    }
    if (!isValidBirthdate(birthdate)) {
      return res
        .status(400)
        .json({ valid: false, message: 'Enter a valid date of birth (not in the future)' });
    }

    if (await bannedEmails.findOne({ email }, { collation: CASE_INSENSITIVE })) {
      return res
        .status(403)
        .json({ valid: false, message: 'This email address has been banned from Fabulari' });
    }
    if (await users.findOne({ email })) {
      return res.status(409).json({ valid: false, message: 'Email already registered' });
    }
    if (await usernameTaken(username)) {
      return res.status(409).json({ valid: false, message: 'That username is already taken' });
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
      darkMode: false,
    };
    await users.insertOne(user);
    await audit('USER_SIGNED_UP', user, `${username} (${email}) created an account`, {
      type: 'user',
      id: user.id,
    });

    res.json({ valid: true, token: signToken(user), ...publicUser(user) });
  });

  // Every route below this line requires a valid login token.
  app.use('/api', requireAuth);

  // Every account, with emails. Profiles are private, so only the super admin may see this list;
  // group admins get names for their own members from GET /groups/:groupId/members instead.
  app.get('/api/users', requireSuperAdmin, async (req, res) => {
    res.json(
      (await users.find({}, { projection: { _id: 0, passwordHash: 0 } }).toArray()).map(publicUser),
    );
  });

  // Changes the user's own username, birthdate or dark mode setting. Email can never change.
  app.put('/api/users/:userId', requireSelf, async (req, res) => {
    const { username, birthdate, darkMode } = req.body;
    const changes = {};

    if (username !== undefined) {
      const name = requiredText(username, LIMITS.username);
      if (!name || name.includes('@')) {
        return res.status(400).json({
          message: `Enter a username of at most ${LIMITS.username} characters, without "@"`,
        });
      }
      if (await usernameTaken(name, req.user.id)) {
        return res.status(409).json({ message: 'That username is already taken' });
      }
      changes.username = name;
    }
    if (birthdate !== undefined) {
      if (!isValidBirthdate(birthdate)) {
        return res.status(400).json({ message: 'Enter a valid date of birth (not in the future)' });
      }
      changes.birthdate = birthdate;
    }
    if (darkMode !== undefined) {
      if (typeof darkMode !== 'boolean')
        return res.status(400).json({ message: 'darkMode must be true or false' });
      changes.darkMode = darkMode;
    }

    // A new birthdate can put the user under the age limit of groups they are in. Like an admin raising
    // the limit, that removes them, unless they are the group's only admin (a group always keeps one).
    let tooYoungFor = [];
    if (changes.birthdate) {
      const age = ageOf(changes.birthdate);
      tooYoungFor = (await groups.find({ 'members.userId': req.user.id }, NO_ID).toArray()).filter(
        (g) => age < g.ageLimit,
      );
      const soleAdminOf = tooYoungFor.filter(
        (g) => adminIds(g).length === 1 && adminIds(g)[0] === req.user.id,
      );
      if (soleAdminOf.length) {
        const g = soleAdminOf[0];
        return res.status(409).json({
          message: `You are the only admin of "${g.name}", which has an age limit of ${g.ageLimit}. Promote another member first.`,
        });
      }
    }

    if (Object.keys(changes).length) {
      await users.updateOne({ id: req.user.id }, { $set: changes });
    }
    for (const group of tooYoungFor) {
      await groups.updateOne({ id: group.id }, { $pull: { members: { userId: req.user.id } } });
      await audit(
        'MEMBERS_REMOVED_AGE_LIMIT',
        req.user,
        `${req.user.username}'s new birthdate is under the age limit of "${group.name}" (${group.ageLimit}), so they were removed`,
        { type: 'group', id: group.id },
      );
      live.removeFromGroup(req.user.id, group.id);
      live.refresh(memberIds(group), 'groups');
      live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    }
    // Other members see the new name in their member lists straight away.
    if (changes.username) {
      const shared = await groups
        .find({ 'members.userId': req.user.id }, { projection: { members: 1 } })
        .toArray();
      live.refresh(shared.flatMap(memberIds), 'groups');
    }

    res.json({
      ...publicUser({ ...req.user, ...changes }),
      removedFrom: tooYoungFor.map((g) => ({ id: g.id, name: g.name, ageLimit: g.ageLimit })),
    });
  });

  // Changes the user's own password: the current one once, then the new one twice.
  app.put('/api/users/:userId/password', requireSelf, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!isText(currentPassword) || !isText(newPassword) || !isText(confirmPassword)) {
      return res
        .status(400)
        .json({ message: 'Current password and the new password twice are required' });
    }
    if (newPassword.length > LIMITS.password) {
      return res
        .status(400)
        .json({ message: `Passwords can be at most ${LIMITS.password} characters` });
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

  // Removes the user's own profile photo; their initial is shown instead.
  app.delete('/api/users/:userId/photo', requireSelf, async (req, res) => {
    await deleteAvatar(req.user.id);
    await users.updateOne({ id: req.user.id }, { $set: { profilePhoto: null } });
    res.json(publicUser({ ...req.user, profilePhoto: null }));
  });

  // Every group, so users can browse and ask to join any of them (whatever their age).
  app.get('/api/groups', async (req, res) => {
    const all = await groups.find({}, NO_ID).sort({ id: 1 }).toArray();
    res.json(all.map((g) => groupFor(g, req.user.id)));
  });

  // One group, with its members' ids and roles.
  app.get('/api/groups/:groupId', async (req, res) => {
    const group = await groups.findOne({ id: Number(req.params.groupId) }, NO_ID);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    res.json(groupFor(group, req.user.id));
  });

  // Users ask for a group; the super admin creates it by approving the request.
  // The requester becomes the new group's first admin.
  app.post('/api/group-requests', async (req, res) => {
    if (req.user.role === 'superadmin') {
      return res.status(403).json({ message: 'The super admin cannot request groups' });
    }

    const { ageLimit, colourTheme } = req.body;
    const name = requiredText(req.body.name, LIMITS.name);
    const description = optionalText(req.body.description, LIMITS.description);
    const limit = ageLimit === undefined ? 0 : parseAgeLimit(ageLimit);
    if (!name)
      return res
        .status(400)
        .json({ message: `A group name of at most ${LIMITS.name} characters is required` });
    if (description === null) {
      return res
        .status(400)
        .json({ message: `Descriptions can be at most ${LIMITS.description} characters` });
    }
    if (limit === null)
      return res.status(400).json({ message: 'Age limit must be a whole number from 0 to 120' });
    if (colourTheme !== undefined && !COLOUR_THEMES.includes(colourTheme)) {
      return res
        .status(400)
        .json({ message: `Colour theme must be one of: ${COLOUR_THEMES.join(', ')}` });
    }

    if (await groups.findOne({ name }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'A group with that name already exists' });
    }
    if (await groupRequests.findOne({ name, status: 'pending' }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'A group with that name has already been requested' });
    }

    const request = {
      id: await nextId(db, 'groupRequests'),
      requestedBy: req.user.id,
      name,
      description,
      ageLimit: limit,
      colourTheme: colourTheme || 'Blue',
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    await groupRequests.insertOne({ ...request });
    await audit('GROUP_REQUESTED', req.user, `Requested a new group "${request.name}"`, {
      type: 'groupRequest',
      id: request.id,
    });
    live.notifySuperAdmin(`${req.user.username} asked for a new group "${request.name}"`);
    res.json(request);
  });

  // The user's own group requests, for the My Requests page.
  app.get('/api/group-requests/mine', async (req, res) => {
    res.json(
      await groupRequests.find({ requestedBy: req.user.id }, NO_ID).sort({ id: 1 }).toArray(),
    );
  });

  // Group requests waiting for the super admin.
  app.get('/api/admin/group-requests', requireSuperAdmin, async (req, res) => {
    const pending = await groupRequests
      .find({ status: 'pending' }, NO_ID)
      .sort({ id: 1 })
      .toArray();
    res.json(await withUsernames(pending, 'requestedBy', 'requesterName'));
  });

  // The super admin approves (creating the group) or rejects a group request.
  app.put('/api/admin/group-requests/:requestId', requireSuperAdmin, async (req, res) => {
    const request = await groupRequests.findOne({ id: Number(req.params.requestId) }, NO_ID);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending')
      return res.status(409).json({ message: 'Request already actioned' });

    const approve = req.body.approve === true;

    if (!approve) {
      const reason = optionalText(req.body.reason, LIMITS.reason);
      if (reason === null)
        return res
          .status(400)
          .json({ message: `Reasons can be at most ${LIMITS.reason} characters` });
      const changes = {
        status: 'rejected',
        reviewedBy: req.user.id,
        rejectionReason: reason || null,
      };
      await groupRequests.updateOne({ id: request.id }, { $set: changes });
      await audit(
        'GROUP_REQUEST_REJECTED',
        req.user,
        `Rejected the request for "${request.name}"${reason ? `: ${reason}` : ''}`,
        { type: 'groupRequest', id: request.id },
      );
      live.notify(
        [request.requestedBy],
        `Your request for the group "${request.name}" was rejected${reason ? `: ${reason}` : ''}`,
      );
      live.refresh([request.requestedBy], 'requests');
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
    await audit('GROUP_CREATED', req.user, `Approved and created the group "${group.name}"`, {
      type: 'group',
      id: group.id,
    });
    live.notify(
      [request.requestedBy],
      `Your group "${group.name}" was approved. You are its admin.`,
    );
    live.refresh([request.requestedBy], 'groups');
    live.refresh([request.requestedBy], 'requests');
    res.json({ request: { ...request, ...changes }, group });
  });

  // A group admin edits the group's name, description, age limit or colour theme.
  app.put('/api/groups/:groupId', requireGroupAdmin, async (req, res) => {
    const { name, description, ageLimit, colourTheme } = req.body;
    if (colourTheme !== undefined && !COLOUR_THEMES.includes(colourTheme)) {
      return res
        .status(400)
        .json({ message: `Colour theme must be one of: ${COLOUR_THEMES.join(', ')}` });
    }

    const changes = {};
    if (name !== undefined) {
      const newName = requiredText(name, LIMITS.name);
      if (!newName)
        return res
          .status(400)
          .json({ message: `A group name of at most ${LIMITS.name} characters is required` });
      if (newName !== req.group.name) {
        // Group names stay unique, ignoring case. Changing only the capitals of your own name is fine.
        const clash = await groups.findOne(
          { name: newName, id: { $ne: req.group.id } },
          { collation: CASE_INSENSITIVE },
        );
        if (clash)
          return res.status(409).json({ message: 'A group with that name already exists' });
        changes.name = newName;
      }
    }
    if (description !== undefined) {
      const text = optionalText(description, LIMITS.description);
      if (text === null) {
        return res
          .status(400)
          .json({ message: `Descriptions can be at most ${LIMITS.description} characters` });
      }
      changes.description = text;
    }
    if (colourTheme !== undefined) changes.colourTheme = colourTheme;
    if (ageLimit !== undefined) {
      const limit = parseAgeLimit(ageLimit);
      if (limit === null)
        return res.status(400).json({ message: 'Age limit must be a whole number from 0 to 120' });
      changes.ageLimit = limit;
    }

    // Raising the age limit removes members who are now too young (the client's rule).
    // Birthdates are private, so the server works this out and reports who was removed.
    let removed = [];
    if (changes.ageLimit !== undefined && changes.ageLimit > req.group.ageLimit) {
      const memberUsers = await users
        .find(
          { id: { $in: memberIds(req.group) } },
          { projection: { _id: 0, id: 1, username: 1, birthdate: 1 } },
        )
        .toArray();
      removed = memberUsers.filter((u) => ageOf(u.birthdate) < changes.ageLimit);

      const removedIds = new Set(removed.map((u) => u.id));
      const adminsLeft = adminIds(req.group).filter((id) => !removedIds.has(id));
      if (adminsLeft.length === 0) {
        return res.status(409).json({
          message: `An age limit of ${changes.ageLimit} would leave the group with no admin. Promote an older member first.`,
        });
      }
    }

    const update = Object.keys(changes).length ? { $set: changes } : {};
    if (removed.length) update.$pull = { members: { userId: { $in: removed.map((u) => u.id) } } };
    if (Object.keys(update).length) {
      await groups.updateOne({ id: req.group.id }, update);
    }
    const groupName = changes.name ?? req.group.name;
    if (changes.ageLimit !== undefined) {
      // Pending requests from people now under the limit can never be approved.
      const pending = await joinRequests
        .find({ groupId: req.group.id, status: 'pending' })
        .toArray();
      const applicants = await users
        .find(
          { id: { $in: pending.map((r) => r.userId) } },
          { projection: { _id: 0, id: 1, birthdate: 1 } },
        )
        .toArray();
      const tooYoung = applicants
        .filter((u) => ageOf(u.birthdate) < changes.ageLimit)
        .map((u) => u.id);
      if (tooYoung.length) {
        await joinRequests.updateMany(
          { groupId: req.group.id, status: 'pending', userId: { $in: tooYoung } },
          {
            $set: {
              status: 'rejected',
              rejectionReason: `You must be ${changes.ageLimit} or older to join this group`,
              reviewedBy: req.user.id,
            },
          },
        );
        live.notify(
          tooYoung,
          `Your request to join "${groupName}" was rejected: you must be ${changes.ageLimit} or older`,
        );
        live.refresh(tooYoung, 'requests');
      }
    }

    if (Object.keys(changes).length) {
      const fields = Object.entries(changes)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      await audit('GROUP_UPDATED', req.user, `Updated "${req.group.name}" (${fields})`, {
        type: 'group',
        id: req.group.id,
      });
    }
    if (removed.length) {
      await audit(
        'MEMBERS_REMOVED_AGE_LIMIT',
        req.user,
        `Age limit ${changes.ageLimit} removed ${removed.map((u) => u.username).join(', ')} from "${groupName}"`,
        { type: 'group', id: req.group.id },
      );
      for (const u of removed) live.removeFromGroup(u.id, req.group.id);
      live.notify(
        others(
          removed.map((u) => u.id),
          req,
        ),
        `You were removed from "${groupName}" because its age limit is now ${changes.ageLimit}`,
      );
    }

    // Everyone who was in the group sees the new name, colour or description, or that they were removed.
    live.refresh(memberIds(req.group), 'groups');
    live.refresh(adminIds(req.group), 'group-admin', { groupId: req.group.id });

    const updated = await groups.findOne({ id: req.group.id }, NO_ID);
    res.json({
      ...groupFor(updated, req.user.id),
      removedMembers: removed.map((u) => ({ userId: u.id, username: u.username })),
    });
  });

  // Member list for people inside the group. Profiles are private, so only username and role are shared.
  app.get('/api/groups/:groupId/members', requireGroupMember, async (req, res) => {
    res.json(await withUsernames(req.group.members, 'userId', 'username'));
  });

  // Leaving is immediate. The only admin can't leave, because a group must always have an admin.
  app.delete('/api/groups/:groupId/membership', requireGroupMember, async (req, res) => {
    const group = req.group;
    const me = group.members.find((m) => m.userId === req.user.id);
    const otherAdmins = group.members.filter((m) => m.role === 'admin' && m.userId !== req.user.id);
    if (me.role === 'admin' && otherAdmins.length === 0) {
      return res.status(409).json({
        message:
          'You are the only admin. Promote another member first, or ask the super admin to delete the group.',
      });
    }

    await groups.updateOne({ id: group.id }, { $pull: { members: { userId: req.user.id } } });
    await audit('GROUP_LEFT', req.user, `Left "${group.name}"`, { type: 'group', id: group.id });
    live.removeFromGroup(req.user.id, group.id);
    live.refresh(memberIds(group), 'groups');
    live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    res.json({ left: true });
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
    // Group bans are permanent (the client: "banned forever").
    if ((group.bannedUserIds ?? []).includes(userId)) {
      return res.status(403).json({ message: 'You are banned from this group' });
    }
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
      rejectionReason: underAge
        ? `You must be ${group.ageLimit} or older to join this group`
        : null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    await joinRequests.insertOne({ ...request });
    await audit(
      underAge ? 'JOIN_AUTO_REJECTED' : 'JOIN_REQUESTED',
      req.user,
      underAge
        ? `Asked to join "${group.name}", rejected automatically (under ${group.ageLimit})`
        : `Asked to join "${group.name}"`,
      { type: 'group', id: group.id },
    );
    if (!underAge) {
      live.notify(adminIds(group), `${req.user.username} asked to join "${group.name}"`);
      live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    }
    res.json(request);
  });

  // The user's own join requests, for the Groups and My Requests pages.
  app.get('/api/join-requests/mine', async (req, res) => {
    res.json(await joinRequests.find({ userId: req.user.id }, NO_ID).sort({ id: 1 }).toArray());
  });

  // Join requests waiting for this group's admins.
  app.get('/api/groups/:groupId/join-requests', requireGroupAdmin, async (req, res) => {
    const pending = await joinRequests
      .find({ groupId: req.group.id, status: 'pending' }, NO_ID)
      .sort({ id: 1 })
      .toArray();
    res.json(await withUsernames(pending, 'userId', 'username'));
  });

  // A group admin approves (adding the member) or rejects a join request.
  app.put('/api/groups/:groupId/join-requests/:requestId', requireGroupAdmin, async (req, res) => {
    const group = req.group;
    const request = await joinRequests.findOne(
      { id: Number(req.params.requestId), groupId: group.id },
      NO_ID,
    );
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending')
      return res.status(409).json({ message: 'Request already actioned' });

    const applicant = await users.findOne({ id: request.userId });
    const approve = req.body.approve === true;
    const reason = optionalText(req.body.reason, LIMITS.reason);
    if (!approve && reason === null) {
      return res
        .status(400)
        .json({ message: `Reasons can be at most ${LIMITS.reason} characters` });
    }

    // Re-check the age in case the group's limit was raised after the request was made.
    if (approve && (!applicant || ageOf(applicant.birthdate) < group.ageLimit)) {
      return res.status(400).json({ message: 'That user no longer meets the group age limit' });
    }

    const changes = { status: approve ? 'approved' : 'rejected', reviewedBy: req.user.id };
    if (approve) {
      await groups.updateOne(
        { id: group.id },
        { $push: { members: { userId: request.userId, role: 'member' } } },
      );
    } else {
      changes.rejectionReason = reason || null;
    }

    await joinRequests.updateOne({ id: request.id }, { $set: changes });
    const who = applicant?.username ?? `User #${request.userId}`;
    await audit(
      approve ? 'JOIN_APPROVED' : 'JOIN_REJECTED',
      req.user,
      approve
        ? `Let ${who} join "${group.name}"`
        : `Turned down ${who}'s request to join "${group.name}"${reason ? `: ${reason}` : ''}`,
      { type: 'user', id: request.userId },
    );
    if (approve) {
      live.notify(
        [request.userId],
        `You have joined "${group.name}". You can chat in its rooms now.`,
      );
      live.refresh([...memberIds(group), request.userId], 'groups');
    } else {
      live.notify(
        [request.userId],
        `Your request to join "${group.name}" was rejected${reason ? `: ${reason}` : ''}`,
      );
      live.refresh([request.userId], 'groups');
    }
    live.refresh([request.userId], 'requests');
    live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    res.json({ ...request, ...changes });
  });

  // Promotes a member to admin or demotes an admin to member.
  app.put('/api/groups/:groupId/members/:userId/role', requireGroupAdmin, async (req, res) => {
    const group = req.group;

    const userId = Number(req.params.userId);
    const member = group.members.find((m) => m.userId === userId);
    if (!member) return res.status(404).json({ message: 'User is not a member of this group' });

    // Any admin may demote any admin, including themselves, as long as one admin is left.
    const newRole = req.body.role === 'admin' ? 'admin' : 'member';
    if (member.role === 'admin' && newRole === 'member' && adminIds(group).length === 1) {
      return res.status(409).json({
        message: 'A group must always have at least one admin. Promote someone else first.',
      });
    }

    await groups.updateOne(
      { id: group.id, 'members.userId': userId },
      { $set: { 'members.$.role': newRole } },
    );
    if (member.role !== newRole) {
      const who = (await users.findOne({ id: userId }))?.username ?? `User #${userId}`;
      await audit(
        newRole === 'admin' ? 'MEMBER_PROMOTED' : 'ADMIN_DEMOTED',
        req.user,
        `${newRole === 'admin' ? 'Made' : 'Removed'} ${who} ${newRole === 'admin' ? 'an admin of' : 'as an admin of'} "${group.name}"`,
        { type: 'user', id: userId },
      );
      live.notify(
        others([userId], req),
        newRole === 'admin'
          ? `You are now an admin of "${group.name}"`
          : `You are no longer an admin of "${group.name}"`,
      );
      live.refresh(memberIds(group), 'groups');
      live.refresh([...adminIds(group), userId], 'group-admin', { groupId: group.id });
    }
    res.json(groupFor(await groups.findOne({ id: group.id }, NO_ID), req.user.id));
  });

  // The group's rooms, for its members.
  app.get('/api/groups/:groupId/rooms', requireGroupMember, async (req, res) => {
    res.json(await rooms.find({ groupId: req.group.id }, NO_ID).sort({ id: 1 }).toArray());
  });

  // Members propose rooms; a group admin approves (creating the room) or rejects with a reason.
  app.post('/api/groups/:groupId/room-requests', requireGroupMember, async (req, res) => {
    const groupId = req.group.id;
    const name = requiredText(req.body.name, LIMITS.name);
    const description = optionalText(req.body.description, LIMITS.description);
    if (!name)
      return res
        .status(400)
        .json({ message: `A room name of at most ${LIMITS.name} characters is required` });
    if (description === null) {
      return res
        .status(400)
        .json({ message: `Descriptions can be at most ${LIMITS.description} characters` });
    }

    if (await rooms.findOne({ groupId, name }, { collation: CASE_INSENSITIVE })) {
      return res.status(409).json({ message: 'This group already has a room with that name' });
    }
    if (
      await roomRequests.findOne(
        { groupId, name, status: 'pending' },
        { collation: CASE_INSENSITIVE },
      )
    ) {
      return res.status(409).json({ message: 'A room with that name has already been requested' });
    }

    const request = {
      id: await nextId(db, 'roomRequests'),
      groupId,
      requestedBy: req.user.id,
      name,
      description,
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    await roomRequests.insertOne({ ...request });
    await audit(
      'ROOM_REQUESTED',
      req.user,
      `Requested the room "${request.name}" in "${req.group.name}"`,
      {
        type: 'roomRequest',
        id: request.id,
      },
    );
    live.notify(
      others(adminIds(req.group), req),
      `${req.user.username} asked for a new room "${name}" in "${req.group.name}"`,
    );
    live.refresh(adminIds(req.group), 'group-admin', { groupId });
    res.json(request);
  });

  // The user's own room requests, for the My Requests page.
  app.get('/api/room-requests/mine', async (req, res) => {
    res.json(
      await roomRequests.find({ requestedBy: req.user.id }, NO_ID).sort({ id: 1 }).toArray(),
    );
  });

  // Room requests waiting for this group's admins.
  app.get('/api/groups/:groupId/room-requests', requireGroupAdmin, async (req, res) => {
    const pending = await roomRequests
      .find({ groupId: req.group.id, status: 'pending' }, NO_ID)
      .sort({ id: 1 })
      .toArray();
    res.json(await withUsernames(pending, 'requestedBy', 'requesterName'));
  });

  // A group admin approves (creating the room) or rejects a room request. Rejecting needs a reason.
  app.put('/api/groups/:groupId/room-requests/:requestId', requireGroupAdmin, async (req, res) => {
    const groupId = req.group.id;
    const request = await roomRequests.findOne(
      { id: Number(req.params.requestId), groupId },
      NO_ID,
    );
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending')
      return res.status(409).json({ message: 'Request already actioned' });
    // No self-approval (the client): another admin must review an admin's own request.
    if (request.requestedBy === req.user.id) {
      return res.status(403).json({ message: 'Another admin must review your own request' });
    }

    const approve = req.body.approve === true;

    if (!approve) {
      const reason = requiredText(req.body.reason, LIMITS.reason);
      if (!reason) {
        return res.status(400).json({
          message: `A reason of at most ${LIMITS.reason} characters is required to reject a room request`,
        });
      }
      const changes = { status: 'rejected', rejectionReason: reason, reviewedBy: req.user.id };
      await roomRequests.updateOne({ id: request.id }, { $set: changes });
      await audit(
        'ROOM_REJECTED',
        req.user,
        `Rejected the room "${request.name}" in "${req.group.name}": ${reason}`,
        {
          type: 'roomRequest',
          id: request.id,
        },
      );
      live.notify(
        [request.requestedBy],
        `Your room "${request.name}" in "${req.group.name}" was rejected: ${reason}`,
      );
      live.refresh([request.requestedBy], 'requests');
      live.refresh(adminIds(req.group), 'group-admin', { groupId });
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
    await audit(
      'ROOM_CREATED',
      req.user,
      `Approved and created the room "${room.name}" in "${req.group.name}"`,
      {
        type: 'room',
        id: room.id,
      },
    );
    live.notify(
      [request.requestedBy],
      `Your room "${room.name}" in "${req.group.name}" was approved`,
    );
    live.refresh([request.requestedBy], 'requests');
    live.refresh(memberIds(req.group), 'rooms', { groupId });
    live.refresh(adminIds(req.group), 'group-admin', { groupId });
    res.json({ request: { ...request, ...changes }, room });
  });

  // Admins can fix a room's name or description (e.g. a typo from the original request).
  app.put('/api/groups/:groupId/rooms/:roomId', requireGroupAdmin, async (req, res) => {
    const room = await rooms.findOne(
      { id: Number(req.params.roomId), groupId: req.group.id },
      NO_ID,
    );
    if (!room) return res.status(404).json({ message: 'Room not found' });

    const { name, description } = req.body;
    const changes = {};
    if (name !== undefined) {
      const trimmed = requiredText(name, LIMITS.name);
      if (!trimmed)
        return res
          .status(400)
          .json({ message: `A room name of at most ${LIMITS.name} characters is required` });
      const clash = await rooms.findOne(
        { groupId: req.group.id, name: trimmed, id: { $ne: room.id } },
        { collation: CASE_INSENSITIVE },
      );
      if (clash)
        return res.status(409).json({ message: 'This group already has a room with that name' });
      changes.name = trimmed;
    }
    if (description !== undefined) {
      const text = optionalText(description, LIMITS.description);
      if (text === null)
        return res.status(400).json({
          message: `Descriptions must be text of at most ${LIMITS.description} characters`,
        });
      changes.description = text;
    }

    if (Object.keys(changes).length) {
      await rooms.updateOne({ id: room.id }, { $set: changes });
      const renamed =
        changes.name && changes.name !== room.name ? ` (renamed from "${room.name}")` : '';
      await audit(
        'ROOM_UPDATED',
        req.user,
        `Edited the room "${changes.name ?? room.name}" in "${req.group.name}"${renamed}`,
        {
          type: 'room',
          id: room.id,
        },
      );
      live.refresh(memberIds(req.group), 'rooms', { groupId: req.group.id });
    }
    res.json({ ...room, ...changes });
  });

  // Deletes a room with its messages and images. Anyone chatting in it is taken out straight away.
  app.delete('/api/groups/:groupId/rooms/:roomId', requireGroupAdmin, async (req, res) => {
    const roomId = Number(req.params.roomId);
    const room = await rooms.findOne({ id: roomId, groupId: req.group.id });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    await rooms.deleteOne({ id: roomId });

    const images = await messages
      .find({ roomId, type: 'image' }, { projection: { content: 1 } })
      .toArray();
    await messages.deleteMany({ roomId });
    await deleteUploads(images.map((m) => m.content));
    await audit(
      'ROOM_DELETED',
      req.user,
      `Deleted the room "${room.name}" from "${req.group.name}"`,
      { type: 'room', id: roomId },
    );
    live.closeRoom(roomId);
    live.refresh(memberIds(req.group), 'rooms', { groupId: req.group.id });
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

  // Reports filed in a group are reviewed by that group's admins. Banning always comes from a report.
  app.get('/api/groups/:groupId/reports', requireGroupAdmin, async (req, res) => {
    const pending = await reports
      .find({ groupId: req.group.id, status: 'pending' }, NO_ID)
      .sort({ id: 1 })
      .toArray();
    const named = await withUsernames(
      await withUsernames(pending, 'reportedBy', 'reporterName'),
      'reportedUserId',
      'reportedName',
    );
    res.json(named);
  });

  // A group admin bans the reported member from the group, or dismisses the report.
  app.put('/api/groups/:groupId/reports/:reportId', requireGroupAdmin, async (req, res) => {
    const group = req.group;
    const report = await reports.findOne(
      { id: Number(req.params.reportId), groupId: group.id },
      NO_ID,
    );
    if (!report) return res.status(404).json({ message: 'Report not found' });
    if (report.status !== 'pending')
      return res.status(409).json({ message: 'Report already actioned' });
    // Admins can't act on their own reports (the client: no self-approving).
    if (report.reportedBy === req.user.id) {
      return res.status(403).json({ message: 'Another admin must review a report you filed' });
    }

    const action = req.body.action;
    if (action !== 'ban' && action !== 'dismiss') {
      return res.status(400).json({ message: 'Action must be "ban" or "dismiss"' });
    }

    if (action === 'ban') {
      const target = group.members.find((m) => m.userId === report.reportedUserId);
      if (target?.role === 'admin') {
        return res.status(409).json({ message: 'Admins cannot be banned. Demote them first.' });
      }

      await groups.updateOne(
        { id: group.id },
        {
          $pull: { members: { userId: report.reportedUserId } },
          $addToSet: { bannedUserIds: report.reportedUserId },
        },
      );
      await joinRequests.updateMany(
        { groupId: group.id, userId: report.reportedUserId, status: 'pending' },
        {
          $set: {
            status: 'rejected',
            rejectionReason: 'You are banned from this group',
            reviewedBy: req.user.id,
          },
        },
      );
      await bans.insertOne({
        id: await nextId(db, 'bans'),
        userId: report.reportedUserId,
        scope: 'group',
        groupId: group.id,
        reportId: report.id,
        issuedBy: req.user.id,
        createdAt: new Date().toISOString(),
      });
    }

    const changes = {
      status: action === 'ban' ? 'actioned' : 'dismissed',
      reviewedBy: req.user.id,
    };
    await reports.updateOne({ id: report.id }, { $set: changes });
    const who =
      (await users.findOne({ id: report.reportedUserId }))?.username ??
      `User #${report.reportedUserId}`;
    await audit(
      action === 'ban' ? 'USER_BANNED_FROM_GROUP' : 'REPORT_DISMISSED',
      req.user,
      action === 'ban'
        ? `Banned ${who} from "${group.name}" (report: ${report.reason})`
        : `Dismissed the report about ${who} in "${group.name}"`,
      { type: 'user', id: report.reportedUserId },
    );
    if (action === 'ban') {
      live.removeFromGroup(report.reportedUserId, group.id);
      live.notify([report.reportedUserId], `You have been banned from "${group.name}"`);
      live.refresh([...memberIds(group), report.reportedUserId], 'groups');
    }
    live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    res.json({ ...report, ...changes });
  });

  // Everyone banned from this group, newest first. Basic details only (no emails), per the client.
  app.get('/api/groups/:groupId/banned', requireGroupAdmin, async (req, res) => {
    const groupBans = await bans
      .find({ scope: 'group', groupId: req.group.id }, NO_ID)
      .sort({ id: -1 })
      .toArray();
    const reportIds = groupBans.map((b) => b.reportId);
    const reasons = new Map(
      (
        await reports
          .find({ id: { $in: reportIds } }, { projection: { _id: 0, id: 1, reason: 1 } })
          .toArray()
      ).map((r) => [r.id, r.reason]),
    );
    const named = await withUsernames(
      await withUsernames(groupBans, 'userId', 'username'),
      'issuedBy',
      'bannedByName',
    );
    res.json(
      named.map((b) => ({
        userId: b.userId,
        username: b.username, // null if the account has since been removed from Fabulari
        bannedAt: b.createdAt,
        bannedByName: b.bannedByName,
        reason: reasons.get(b.reportId) ?? null,
      })),
    );
  });

  // A group admin can escalate a report: ask the super admin to remove the user from Fabulari entirely.
  app.post(
    '/api/groups/:groupId/reports/:reportId/escalate',
    requireGroupAdmin,
    async (req, res) => {
      const group = req.group;
      const report = await reports.findOne(
        { id: Number(req.params.reportId), groupId: group.id },
        NO_ID,
      );
      if (!report) return res.status(404).json({ message: 'Report not found' });
      if (report.status !== 'pending')
        return res.status(409).json({ message: 'Report already actioned' });
      if (report.reportedBy === req.user.id) {
        return res.status(403).json({ message: 'Another admin must review a report you filed' });
      }

      const target = await users.findOne({ id: report.reportedUserId }, NO_ID);
      if (!target) return res.status(404).json({ message: 'That user no longer exists' });
      if (target.role === 'superadmin')
        return res.status(403).json({ message: 'The super admin cannot be removed' });
      if (await systemBanRequests.findOne({ userId: target.id, status: 'pending' })) {
        return res
          .status(409)
          .json({ message: 'A removal request for this user is already waiting' });
      }

      const request = {
        id: await nextId(db, 'systemBanRequests'),
        userId: target.id,
        username: target.username, // kept for the record once the account is gone
        email: target.email,
        groupId: group.id,
        groupName: group.name,
        reportId: report.id,
        reason: report.reason,
        requestedBy: req.user.id,
        status: 'pending',
        rejectionReason: null,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
      };
      await systemBanRequests.insertOne({ ...request });
      await reports.updateOne(
        { id: report.id },
        { $set: { status: 'escalated', reviewedBy: req.user.id } },
      );
      await audit(
        'REMOVAL_REQUESTED',
        req.user,
        `Asked the super admin to remove ${target.username} from Fabulari (report: ${report.reason})`,
        {
          type: 'user',
          id: target.id,
        },
      );
      live.notifySuperAdmin(
        `${req.user.username} asked you to remove ${target.username} from Fabulari`,
      );
      live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
      res.json(request);
    },
  );

  // Removal requests waiting for the super admin.
  app.get('/api/admin/system-ban-requests', requireSuperAdmin, async (req, res) => {
    const pending = await systemBanRequests
      .find({ status: 'pending' }, NO_ID)
      .sort({ id: 1 })
      .toArray();
    res.json(await withUsernames(pending, 'requestedBy', 'requesterName'));
  });

  // The super admin removes a user from Fabulari (deleting the account and banning the email) or keeps them.
  app.put('/api/admin/system-ban-requests/:requestId', requireSuperAdmin, async (req, res) => {
    const request = await systemBanRequests.findOne({ id: Number(req.params.requestId) }, NO_ID);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending')
      return res.status(409).json({ message: 'Request already actioned' });

    const approve = req.body.approve === true;
    if (!approve) {
      const reason = optionalText(req.body.reason, LIMITS.reason);
      if (reason === null)
        return res
          .status(400)
          .json({ message: `Reasons can be at most ${LIMITS.reason} characters` });
      const changes = {
        status: 'rejected',
        rejectionReason: reason || null,
        reviewedBy: req.user.id,
      };
      await systemBanRequests.updateOne({ id: request.id }, { $set: changes });
      await audit(
        'REMOVAL_REJECTED',
        req.user,
        `Kept ${request.username} (${request.email})${reason ? `: ${reason}` : ''}`,
        { type: 'user', id: request.userId },
      );
      live.notify(
        [request.requestedBy],
        `The super admin kept ${request.username}${reason ? `: ${reason}` : ''}`,
      );
      return res.json({ ...request, ...changes });
    }

    const userId = request.userId;
    // A group must always have an admin, so its only admin can't be removed until someone replaces them.
    const theirGroups = await groups.find({ 'members.userId': userId }, NO_ID).toArray();
    const soleAdminOf = theirGroups.filter(
      (g) => adminIds(g).length === 1 && adminIds(g)[0] === userId,
    );
    if (soleAdminOf.length) {
      const names = soleAdminOf.map((g) => `"${g.name}"`).join(', ');
      return res.status(409).json({
        message: `${request.username} is the only admin of ${names}. Another admin must be promoted first.`,
      });
    }

    // Permanent removal: the account goes, the email is blocked for good.
    await groups.updateMany({ 'members.userId': userId }, { $pull: { members: { userId } } });
    await joinRequests.deleteMany({ userId, status: 'pending' });
    await groupRequests.deleteMany({ requestedBy: userId, status: 'pending' });
    await roomRequests.deleteMany({ requestedBy: userId, status: 'pending' });
    await deleteAvatar(userId);
    await users.deleteOne({ id: userId });
    await bannedEmails.updateOne(
      { email: request.email },
      { $setOnInsert: { email: request.email, userId, bannedAt: new Date().toISOString() } },
      { upsert: true, collation: CASE_INSENSITIVE },
    );
    await bans.insertOne({
      id: await nextId(db, 'bans'),
      userId,
      scope: 'system',
      groupId: null,
      reportId: request.reportId,
      issuedBy: req.user.id,
      createdAt: new Date().toISOString(),
    });

    const changes = { status: 'approved', reviewedBy: req.user.id };
    await systemBanRequests.updateOne({ id: request.id }, { $set: changes });
    await audit(
      'USER_REMOVED',
      req.user,
      `Removed ${request.username} (${request.email}) from Fabulari and banned the email`,
      {
        type: 'user',
        id: request.userId,
      },
    );
    live.removeAccount(userId);
    for (const group of theirGroups) {
      live.refresh(memberIds(group), 'groups');
      live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    }
    live.notify([request.requestedBy], `The super admin removed ${request.username} from Fabulari`);
    res.json({ ...request, ...changes });
  });

  // Accounts permanently removed from Fabulari, newest first (the client: the super admin can see banned accounts).
  // The account itself is gone, so the details come from the banned email and the approved removal request.
  app.get('/api/admin/removed-users', requireSuperAdmin, async (req, res) => {
    const banned = await bannedEmails.find({}, NO_ID).sort({ bannedAt: -1 }).toArray();
    const approved = await systemBanRequests
      .find({ status: 'approved', userId: { $in: banned.map((b) => b.userId) } }, NO_ID)
      .toArray();
    const requestFor = new Map(approved.map((r) => [r.userId, r]));
    const removed = banned.map((b) => {
      const request = requestFor.get(b.userId);
      return {
        userId: b.userId,
        username: request?.username ?? null,
        email: b.email,
        removedAt: b.bannedAt,
        groupName: request?.groupName ?? null,
        reason: request?.reason ?? null,
        requestedBy: request?.requestedBy ?? null,
      };
    });
    res.json(await withUsernames(removed, 'requestedBy', 'requesterName'));
  });

  // The super admin's audit log, one page at a time. ?type= filters to one kind of entry; ?order=oldest
  // reverses the default newest-first order; ?skip= and ?limit= choose the page. The response also lists
  // every type seen so far (for the filter) and the total number of matching entries.
  app.get('/api/admin/audit-log', requireSuperAdmin, async (req, res) => {
    const filter =
      typeof req.query.type === 'string' && req.query.type ? { type: req.query.type } : {};
    const direction = req.query.order === 'oldest' ? 1 : -1;
    const skip = Math.max(0, Number.parseInt(req.query.skip, 10) || 0);
    const limit = Math.min(
      AUDIT_MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(req.query.limit, 10) || AUDIT_PAGE_SIZE),
    );
    const entries = await auditLog
      .find(filter, NO_ID)
      .sort({ timestamp: direction, id: direction })
      .skip(skip)
      .limit(limit)
      .toArray();
    const [types, total] = await Promise.all([
      auditLog.distinct('type'),
      auditLog.countDocuments(filter),
    ]);
    res.json({ types: types.sort(), entries, total });
  });

  // Group deletion: a group admin asks, the super admin decides. Groups are never deleted directly.
  app.post('/api/groups/:groupId/delete-requests', requireGroupAdmin, async (req, res) => {
    const group = req.group;
    const reason = optionalText(req.body.reason, LIMITS.reason);
    if (reason === null)
      return res
        .status(400)
        .json({ message: `Reasons can be at most ${LIMITS.reason} characters` });
    if (await groupDeleteRequests.findOne({ groupId: group.id, status: 'pending' })) {
      return res
        .status(409)
        .json({ message: 'A deletion request for this group is already waiting' });
    }

    const request = {
      id: await nextId(db, 'groupDeleteRequests'),
      groupId: group.id,
      groupName: group.name, // kept so the request still makes sense once the group is gone
      requestedBy: req.user.id,
      reason,
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
    };
    await groupDeleteRequests.insertOne({ ...request });
    await audit(
      'GROUP_DELETE_REQUESTED',
      req.user,
      `Asked to delete "${group.name}"${request.reason ? `: ${request.reason}` : ''}`,
      {
        type: 'group',
        id: group.id,
      },
    );
    live.notifySuperAdmin(`${req.user.username} asked you to delete the group "${group.name}"`);
    live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    res.json(request);
  });

  // This group's deletion requests, so its admins can see one is waiting or why it was rejected.
  app.get('/api/groups/:groupId/delete-requests', requireGroupAdmin, async (req, res) => {
    res.json(
      await groupDeleteRequests.find({ groupId: req.group.id }, NO_ID).sort({ id: -1 }).toArray(),
    );
  });

  // Group deletion requests waiting for the super admin.
  app.get('/api/admin/group-delete-requests', requireSuperAdmin, async (req, res) => {
    const pending = await groupDeleteRequests
      .find({ status: 'pending' }, NO_ID)
      .sort({ id: 1 })
      .toArray();
    res.json(await withUsernames(pending, 'requestedBy', 'requesterName'));
  });

  // The super admin deletes the group (with its rooms, messages and images) or keeps it.
  app.put('/api/admin/group-delete-requests/:requestId', requireSuperAdmin, async (req, res) => {
    const request = await groupDeleteRequests.findOne({ id: Number(req.params.requestId) }, NO_ID);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending')
      return res.status(409).json({ message: 'Request already actioned' });

    const approve = req.body.approve === true;
    const reason = optionalText(req.body.reason, LIMITS.reason);
    if (!approve && reason === null) {
      return res
        .status(400)
        .json({ message: `Reasons can be at most ${LIMITS.reason} characters` });
    }
    const changes = { status: approve ? 'approved' : 'rejected', reviewedBy: req.user.id };
    if (!approve) changes.rejectionReason = reason || null;

    const group = await groups.findOne({ id: request.groupId }, NO_ID);
    if (approve) {
      // Remove the group and everything that only exists inside it.
      const groupId = request.groupId;
      const roomIds = (await rooms.find({ groupId }, { projection: { id: 1 } }).toArray()).map(
        (r) => r.id,
      );
      const images = await messages
        .find({ roomId: { $in: roomIds }, type: 'image' }, { projection: { content: 1 } })
        .toArray();
      await messages.deleteMany({ roomId: { $in: roomIds } });
      await deleteUploads(images.map((m) => m.content));
      await rooms.deleteMany({ groupId });
      await joinRequests.deleteMany({ groupId, status: 'pending' });
      await roomRequests.deleteMany({ groupId, status: 'pending' });
      await reports.deleteMany({ groupId, status: 'pending' });
      await groups.deleteOne({ id: groupId });
      for (const roomId of roomIds) live.closeRoom(roomId);
    }

    await groupDeleteRequests.updateOne({ id: request.id }, { $set: changes });
    await audit(
      approve ? 'GROUP_DELETED' : 'GROUP_DELETE_REJECTED',
      req.user,
      approve
        ? `Deleted the group "${request.groupName}"`
        : `Kept the group "${request.groupName}"${changes.rejectionReason ? `: ${changes.rejectionReason}` : ''}`,
      { type: 'group', id: request.groupId },
    );
    if (group && approve) {
      live.notify(memberIds(group), `The group "${request.groupName}" has been deleted`);
      live.refresh(memberIds(group), 'groups');
      live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    } else if (group) {
      live.notify(
        [request.requestedBy],
        `The super admin kept "${request.groupName}"${changes.rejectionReason ? `: ${changes.rejectionReason}` : ''}`,
      );
      live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    }
    res.json({ ...request, ...changes });
  });

  // A report is always filed within a group, so that group's admins can act on it.
  app.post('/api/reports', async (req, res) => {
    const { groupId } = req.body;
    const username = requiredText(req.body.username, LIMITS.username);
    const reason = requiredText(req.body.reason, LIMITS.reason);
    if (!groupId || !username || !reason) {
      return res.status(400).json({
        message: `Group, username and a reason of at most ${LIMITS.reason} characters are required`,
      });
    }

    const group = await groups.findOne({ id: Number(groupId) }, NO_ID);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (!group.members.some((m) => m.userId === req.user.id)) {
      return res.status(403).json({ message: 'You can only report users in groups you belong to' });
    }

    // Usernames are unique ignoring case, so the reported member is found the same way.
    const reported = await users.findOne(
      { username, id: { $in: memberIds(group) } },
      { collation: CASE_INSENSITIVE },
    );
    if (!reported)
      return res.status(404).json({ message: `No member called "${username}" in that group` });
    if (reported.id === req.user.id)
      return res.status(400).json({ message: 'You cannot report yourself' });

    const report = {
      id: await nextId(db, 'reports'),
      reportedUserId: reported.id,
      reportedBy: req.user.id,
      groupId: group.id,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await reports.insertOne({ ...report });
    await audit(
      'REPORT_FILED',
      req.user,
      `Reported ${reported.username} in "${group.name}": ${report.reason}`,
      {
        type: 'user',
        id: reported.id,
      },
    );
    live.notify(
      others(adminIds(group), req),
      `New report in "${group.name}": ${req.user.username} reported ${reported.username}`,
    );
    live.refresh(adminIds(group), 'group-admin', { groupId: group.id });
    res.json(report);
  });

  // Anything that throws (e.g. the database going down) ends up here instead of crashing the server.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: 'Something went wrong on the server' });
  });
}

module.exports = initializeRoutes;
