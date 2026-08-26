"""Clean SRT subtitles (YouTube auto-captions) into a readable transcript.

YouTube auto-captions use a rolling window: each block repeats the tail of the
previous one plus adds new words. This script removes that overlap, joins the
text, and splits it into paragraphs.

Timing is preserved: every paragraph is prefixed with a [MM:SS] marker. Words
are bucketed into one paragraph per ~60s of audio (not per sentence), because
auto-captions often lack punctuation — sentence-based splitting would collapse
the whole transcript into one markerless block. The downstream LLM uses these
evenly spaced markers to put timecodes on topic headings.

Usage:
    python clean_transcript.py \\
        --srt video.ru.srt \\
        --out transcript.md \\
        --title "Title" --source "https://..." --channel "Channel" --duration "12 min"

Frontmatter is added automatically. If no metadata is passed, only the cleaned
text is written (no frontmatter) — handy for debugging. With --no-frontmatter
(the path the orchestrator uses) the output is just the timestamped body.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path


def _parse_timing(line: str) -> float | None:
    """SRT timing line: '00:01:23,400 --> 00:01:25,000'. Return start seconds."""
    m = re.match(
        r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)",
        line.strip(),
    )
    if not m:
        return None
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return h * 3600 + mi * 60 + s


def parse_srt_blocks(raw: str) -> list[tuple[int, str]]:
    """Return (start_sec, text) for each SRT block (index and timing stripped)."""
    out: list[tuple[int, str]] = []
    for block in re.split(r"\r?\n\r?\n", raw):
        parts = block.strip().split("\n")
        # Block: [index, timing, text...]. Take everything after the timing line.
        if len(parts) < 3:
            continue
        start = _parse_timing(parts[1])
        if start is None:
            continue
        text = " ".join(parts[2:]).strip()
        text = html.unescape(text)
        if text:
            out.append((int(start), text))
    return out


def dedup_rolling(blocks: list[tuple[int, str]]) -> list[tuple[str, float]]:
    """Remove rolling caption overlap.

    Returns a list of (word, start_sec): each surviving word carries the start
    time of the SRT block it originated from, so timing survives into paragraphs.
    """
    kept: list[tuple[str, float]] = []
    prev_words: list[str] = []
    for start, line in blocks:
        words = line.split()
        if not words:
            continue
        # Largest k where prev[-k:] == words[:k]
        max_k = min(len(prev_words), len(words))
        overlap = 0
        for k in range(max_k, 0, -1):
            if " ".join(prev_words[-k:]).lower() == " ".join(words[:k]).lower():
                overlap = k
                break
        new_words = words[overlap:]
        if new_words:
            for w in new_words:
                kept.append((w, float(start)))
            prev_words = words
    return kept


def fmt_ts(sec: float) -> str:
    """Format seconds as [H:]MM:SS for transcript markers and topic timecodes."""
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _fix_punct(s: str) -> str:
    """Fix punctuation spacing introduced by word splitting."""
    for sep in (",", ".", "!", "?", ";", ":", ")"):
        s = s.replace(f" {sep}", sep)
    return s.replace(" (", "(")


def to_paragraphs(words: list[tuple[str, float]], window_sec: int = 60) -> str:
    """Group words into paragraphs by a fixed time window; prefix each with [MM:SS].

    One paragraph per `window_sec` of audio (default 60s). This yields evenly
    spaced [MM:SS] markers across the whole video regardless of punctuation.
    YouTube auto-captions — Russian in particular — often ship as an unpunctuated
    stream of words, so sentence-based splitting collapses the whole transcript
    into a single block with one marker, leaving the downstream LLM with almost
    no timecode anchors.
    """
    if not words:
        return ""
    paragraphs: list[tuple[float, list[str]]] = []
    pbuf: list[str] = []
    p_start = words[0][1]
    for w, t in words:
        if not pbuf:
            p_start = t
            pbuf.append(w)
            continue
        # Close the paragraph once the window has elapsed.
        if t - p_start >= window_sec:
            paragraphs.append((p_start, pbuf))
            pbuf = [w]
            p_start = t
        else:
            pbuf.append(w)
    if pbuf:
        paragraphs.append((p_start, pbuf))
    return "\n\n".join(
        f"[{fmt_ts(start)}] {_fix_punct(' '.join(buf))}" for start, buf in paragraphs
    )


FRONTMATTER = """---
type: source
created: {today}
tags: [video-transcript]
source: {source}
channel: {channel}
title: "{title}"
duration: "{duration}"
language: {language}
transcript_method: youtube auto-captions (yt-dlp), deduplicated
---

# {title} — {channel}

> Full transcript. Auto-generated captions — names and terms may be misrecognized.

"""


def build_frontmatter(meta: dict) -> str:
    import datetime

    today = meta.get("today") or datetime.date.today().isoformat()
    return FRONTMATTER.format(
        today=today,
        source=meta.get("source", ""),
        channel=meta.get("channel", ""),
        title=(meta.get("title") or "Video").replace('"', '\\"'),
        duration=meta.get("duration", ""),
        language=meta.get("language", "ru"),
    )


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--srt", required=True, help="Path to the .srt subtitle file")
    p.add_argument("--out", help="Where to write the result (.md). If omitted, stdout")
    p.add_argument("--title", help="Video title (for frontmatter)")
    p.add_argument("--source", help="Source URL (for frontmatter)")
    p.add_argument("--channel", help="Channel (for frontmatter)")
    p.add_argument("--duration", help='Duration, e.g. "12 min" (for frontmatter)')
    p.add_argument("--language", default="ru", help="Language (for frontmatter)")
    p.add_argument(
        "--no-frontmatter", action="store_true", help="Write text only, no frontmatter"
    )
    args = p.parse_args()

    srt_path = Path(args.srt)
    if not srt_path.exists():
        print(f"Error: {srt_path} not found", file=sys.stderr)
        return 1

    raw = srt_path.read_text(encoding="utf-8", errors="replace")
    blocks = parse_srt_blocks(raw)
    if not blocks:
        print("Error: no text blocks found in SRT", file=sys.stderr)
        return 1

    words = dedup_rolling(blocks)
    body = to_paragraphs(words)

    meta = {
        "today": None,
        "source": args.source or "",
        "channel": args.channel or "",
        "title": args.title or "",
        "duration": args.duration or "",
        "language": args.language,
    }
    output = body if args.no_frontmatter else build_frontmatter(meta) + body + "\n"

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # Force LF: the output is read by the LLM and by tests; avoid CRLF noise
        # that Path.write_text would inject on Windows.
        with out_path.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write(output)
        print(f"Written: {out_path} ({len(words)} words)")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
