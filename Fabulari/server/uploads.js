const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Tests point this at a separate folder so they never touch real uploads.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const UPLOADS_URL = '/uploads';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // client limit: files under 2MB

// Every PNG file starts with these 8 bytes. Checking them means a renamed .jpg or other file is rejected,
// whatever name or type the browser claims.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Paths we hand out look like /uploads/<uuid>.png
const UPLOAD_PATH_PATTERN = /^\/uploads\/[0-9a-f-]{36}\.png$/;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Holds a single file field named "image" in memory (at most 2MB) so it can be checked before saving.
const receiveImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
}).single('image');

// True if the file starts with the PNG signature, whatever its name says.
function isPng(buffer) {
  return (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

// Saves a PNG under a random name and returns its public path, e.g. /uploads/1b9d...png
async function savePng(buffer) {
  const name = `${crypto.randomUUID()}.png`;
  await fs.promises.writeFile(path.join(UPLOADS_DIR, name), buffer);
  return `${UPLOADS_URL}/${name}`;
}

// True for a path this server issued and whose file still exists.
function isStoredUpload(urlPath) {
  return (
    typeof urlPath === 'string' &&
    UPLOAD_PATH_PATTERN.test(urlPath) &&
    fs.existsSync(fileFor(urlPath))
  );
}

// Where an uploaded file's public path is stored on disk. basename() stops paths escaping the folder.
function fileFor(urlPath) {
  return path.join(UPLOADS_DIR, path.basename(urlPath));
}

// Deletes uploaded files, ignoring any that are already gone.
async function deleteUploads(urlPaths) {
  await Promise.all(
    urlPaths
      .filter((p) => UPLOAD_PATH_PATTERN.test(p))
      .map((p) => fs.promises.rm(fileFor(p), { force: true })),
  );
}

// Profile photos live at a fixed path per user and are overwritten when changed, so messages that
// show an older photo never point at a deleted file. The ?v= part makes browsers fetch the new version.
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

// Saves (or replaces) a user's profile photo and returns its public path.
async function saveAvatar(userId, buffer) {
  await fs.promises.writeFile(path.join(AVATARS_DIR, `${Number(userId)}.png`), buffer);
  return `${UPLOADS_URL}/avatars/${Number(userId)}.png?v=${Date.now()}`;
}

// Deletes a user's profile photo, if they have one.
async function deleteAvatar(userId) {
  await fs.promises.rm(path.join(AVATARS_DIR, `${Number(userId)}.png`), { force: true });
}

// Express middleware: receives the "image" field and turns upload problems into clear 400/413 responses.
function handleImageUpload(req, res, next) {
  receiveImage(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ message: 'Images must be 2MB or smaller' });
    if (err) return res.status(400).json({ message: 'Could not read the uploaded file' });
    if (!req.file) return res.status(400).json({ message: 'No image was uploaded' });
    if (!isPng(req.file.buffer))
      return res.status(400).json({ message: 'Only PNG images are allowed' });
    next();
  });
}

module.exports = {
  UPLOADS_DIR,
  UPLOADS_URL,
  MAX_IMAGE_BYTES,
  handleImageUpload,
  savePng,
  isStoredUpload,
  deleteUploads,
  saveAvatar,
  deleteAvatar,
};
