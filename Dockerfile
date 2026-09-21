# Debian-based image: installing Whisper (PyTorch) on Alpine is not practical
FROM node:20-bookworm-slim

# System deps:
# - bash: processing scripts
# - ffmpeg: whisper dependency AND the subtitle burn step (built with libass)
# - fontconfig + fonts-dejavu-core: libass needs real fonts to render subtitles
# - python3/pip: whisper
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ffmpeg fontconfig fonts-dejavu-core python3 python3-pip wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Whisper + CPU-only PyTorch (avoids pulling ~2GB of CUDA libraries)
RUN pip3 install --no-cache-dir --break-system-packages \
      torch --index-url https://download.pytorch.org/whl/cpu \
 && pip3 install --no-cache-dir --break-system-packages \
      openai-whisper

WORKDIR /app

# Node dependencies — separate layer for caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application source
COPY src/     ./src/
COPY public/  ./public/
COPY scripts/ ./scripts/
RUN chmod +x ./scripts/*.sh && mkdir -p ./uploads/outputs ./.cache

# Defaults (override via docker-compose / .env)
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    UPLOAD_DIR=/app/uploads \
    MAX_FILE_SIZE_MB=300 \
    MAX_SRT_SIZE_KB=2048 \
    FILE_TTL_HOURS=24 \
    CLEANUP_INTERVAL_MIN=60 \
    SCRIPT_TIMEOUT_MS=14400000 \
    TRANSCRIBE_SCRIPT=/app/scripts/transcribe.sh \
    BURN_SCRIPT=/app/scripts/burn.sh \
    COMPRESS_SCRIPT=/app/scripts/compress.sh \
    MAX_VIDEO_DURATION_SEC=420 \
    COMPRESS_THRESHOLD_MB=15 \
    COMPRESS_TARGET_MB=14 \
    DAILY_LIMIT=3 \
    LICENSE_TTL_DAYS=7 \
    TG_CONTACT=@it_link_a \
    XDG_CACHE_HOME=/app/.cache

# Unprivileged user
RUN groupadd -r app && useradd -r -g app -d /app app && chown -R app:app /app
USER app

# OPTIONAL: pre-download models at build time so the first job doesn't
# spend 10+ minutes downloading. Uncomment the ones you need.
# Note: large-v3 ~ 3 GB, large ~ 3 GB, medium ~ 1.5 GB — image gets big.
# RUN python3 -c "import whisper; whisper.load_model('large-v3')"
# RUN python3 -c "import whisper; whisper.load_model('medium')"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "src/server.js"]
