#!/usr/bin/env bash
# transcribe.sh — command 1: generate subtitles from a video with Whisper
#
# Arguments:
#   $1 = input video file path
#   $2 = output .srt file path
#   $3 = video language (whisper --language value, e.g. "Ukrainian")
#   $4 = whisper model  (large-v3 | large | medium)

set -euo pipefail

INPUT="${1:?Missing input file}"
OUTPUT="${2:?Missing output srt path}"
LANGUAGE="${3:?Missing language}"
MODEL="${4:?Missing model}"

if [[ ! -f "$INPUT" ]]; then
  echo "Input file not found: $INPUT" >&2
  exit 1
fi

echo "Transcribing: $INPUT -> $OUTPUT (language=$LANGUAGE, model=$MODEL)"

# Whisper writes <basename>.srt into --output_dir; work in a temp dir
SRT_DIR="$(mktemp -d)"
trap 'rm -rf "$SRT_DIR"' EXIT

TMP="$INPUT"

whisper "$TMP" \
  --task translate \
  --language "$LANGUAGE" \
  --model "$MODEL" \
  --device cpu \
  --output_format srt \
  --output_dir "$SRT_DIR"

BASENAME="$(basename "$TMP")"
SRT_FILE="$SRT_DIR/${BASENAME%.*}.srt"

if [[ ! -f "$SRT_FILE" ]]; then
  echo "Whisper did not produce an .srt file (expected: $SRT_FILE)" >&2
  exit 1
fi

mv "$SRT_FILE" "$OUTPUT"

echo "Transcription done: $OUTPUT"
exit 0
