#!/usr/bin/env bash
# compress.sh — shrink an oversized video to fit the target size
#
# Arguments:
#   $1 = input video file path
#   $2 = output .mp4 file path
#   $3 = target size in MB
#
# Strategy: compute a video bitrate from the known duration so the output
# lands under the target. Cap resolution at 480p, audio at 64 kbps AAC —
# plenty for subtitle work, and Whisper only listens to the audio anyway.

set -euo pipefail

INPUT="${1:?Missing input file}"
OUTPUT="${2:?Missing output path}"
TARGET_MB="${3:?Missing target size}"

if [[ ! -f "$INPUT" ]]; then
  echo "Input file not found: $INPUT" >&2
  exit 1
fi

DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$INPUT")"
DURATION="${DURATION%.*}"
if [[ -z "$DURATION" || "$DURATION" -le 0 ]]; then
  echo "Could not determine duration for compression" >&2
  exit 1
fi

# Total budget in kilobits, with a 5% container-overhead safety margin
TOTAL_KBIT=$(( TARGET_MB * 8192 * 95 / 100 ))
AUDIO_KBPS=64
VIDEO_KBPS=$(( TOTAL_KBIT / DURATION - AUDIO_KBPS ))
if (( VIDEO_KBPS < 100 )); then VIDEO_KBPS=100; fi

echo "Compressing: $INPUT -> $OUTPUT (duration=${DURATION}s, video=${VIDEO_KBPS}k, audio=${AUDIO_KBPS}k)"

ffmpeg -y -i "$INPUT" \
  -vf "scale='min(854,iw)':-2" \
  -c:v libx264 -preset veryfast \
  -b:v "${VIDEO_KBPS}k" -maxrate "${VIDEO_KBPS}k" -bufsize "$(( VIDEO_KBPS * 2 ))k" \
  -c:a aac -b:a "${AUDIO_KBPS}k" \
  -movflags +faststart \
  "$OUTPUT"

if [[ ! -s "$OUTPUT" ]]; then
  echo "Compression produced no output" >&2
  exit 1
fi

echo "Compression done: $OUTPUT ($(stat -c%s "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT") bytes)"
exit 0
