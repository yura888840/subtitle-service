#!/usr/bin/env bash
# burn.sh — command 2: burn subtitles into the video with ffmpeg
#
# Arguments:
#   $1 = input video file path (any format ffmpeg can read)
#   $2 = .srt subtitle file path (user-edited)
#   $3 = output video file path (ALWAYS .mp4 — see note below)
#
# Why always re-encode to H.264/AAC MP4:
#   The `subtitles` filter always re-encodes the video stream. H.264 is only
#   compatible with a limited set of containers, and copying the source audio
#   ("-c:a copy") breaks when the source codec doesn't fit the output container
#   (e.g. Opus/Vorbis from .webm). Producing a standard H.264 + AAC .mp4 makes
#   the result play everywhere (browsers, phones, editors) regardless of the
#   input format (.mov, .mkv, .webm, .avi, .flv, ...).

set -euo pipefail

TMP="${1:?Missing input video}"
SRT_FILE="${2:?Missing srt file}"
OUTPUT="${3:?Missing output path}"

if [[ ! -f "$TMP" ]]; then
  echo "Input video not found: $TMP" >&2
  exit 1
fi
if [[ ! -f "$SRT_FILE" ]]; then
  echo "Subtitle file not found: $SRT_FILE" >&2
  exit 1
fi

echo "Burning subtitles: $TMP + $SRT_FILE -> $OUTPUT"

ffmpeg \
  -y \
  -i "$TMP" \
  -vf "subtitles='$SRT_FILE'" \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUTPUT"

if [[ ! -s "$OUTPUT" ]]; then
  echo "ffmpeg did not produce an output file" >&2
  exit 1
fi

echo "Burn done: $OUTPUT"
exit 0
