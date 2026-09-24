'use strict';
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline, Transform } = require('stream');
const cfg = require('../config');
fs.mkdirSync(cfg.OUTPUT_DIR, { recursive: true });
const storage = {
  _handleFile(req, file, cb) {
    const filename = crypto.randomUUID() + path.extname(file.originalname).toLowerCase();
    const full = path.join(cfg.UPLOAD_DIR, filename);
    let size = 0;
    const output = fs.createWriteStream(full, { flags: 'wx', mode: 0o600 });
    const abort = () => file.stream.destroy(new Error('Upload interrupted.'));
    req.once('aborted', abort);
    pipeline(file.stream, new Transform({ transform(chunk, _encoding, next) { size += chunk.length; next(null, chunk); } }), output, err => {
      req.off('aborted', abort);
      if (err || req.aborted) return fs.unlink(full, () => cb(err || new Error('Upload interrupted.')));
      cb(null, { destination: cfg.UPLOAD_DIR, filename, path: full, size });
    });
    if (req.aborted) abort();
  },
  _removeFile(_req, file, cb) { fs.unlink(file.path, err => cb(err?.code === 'ENOENT' ? null : err)); }
};
const upload = multer({ storage, limits: { fileSize: cfg.MAX_FILE_SIZE_MB * 1024 * 1024, files: 1, fields: 2, parts: 3, fieldSize: 1024 },
  fileFilter(_req, file, cb) { cb(cfg.ALLOWED_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase()) ? null : new Error('Unsupported video format.'), true); }
});
module.exports = { upload };
