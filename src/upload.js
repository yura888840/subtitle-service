'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cfg = require('./config');

// Create directories on boot
fs.mkdirSync(cfg.UPLOAD_DIR, { recursive: true });
fs.mkdirSync(cfg.OUTPUT_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, cfg.UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (cfg.ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${ext}. Allowed: ${cfg.ALLOWED_EXTENSIONS.join(', ')}`));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: cfg.MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 }
});

module.exports = { upload };
