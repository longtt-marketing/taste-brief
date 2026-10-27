"""Build a captioned local walkthrough from CUA screenshots, not simulated UI.

Usage: python scripts/build-demo-update.py video/v29
Uses the tracked docs/demo-update-2026-10-27.json narration and existing screenshots
in the output folder. Requires edge-tts, ffmpeg and ffprobe.
"""
import asyncio
import json
from pathlib import Path
import subprocess
import sys

import edge_tts


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def stamp(seconds):
    cs = round(seconds * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}"


async def build(folder, source=None):
    source = source or Path(__file__).resolve().parents[1] / "docs" / "demo-update-2026-10-27.json"
    folder.mkdir(parents=True, exist_ok=True)
    scenes = json.loads(source.read_text(encoding="utf-8"))
    metadata = []
    for index, scene in enumerate(scenes):
        stem = f"part-{index:02}"
        words = []
        with (folder / f"{stem}.mp3").open("wb") as output:
            speech = edge_tts.Communicate(scene["text"], "en-US-AndrewMultilingualNeural", rate="+5%", boundary="WordBoundary")
            async for item in speech.stream():
                if item["type"] == "audio":
                    output.write(item["data"])
                elif item["type"] == "WordBoundary":
                    words.append((item["offset"] / 1e7, item["duration"] / 1e7, item["text"]))
        duration = float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(folder / f"{stem}.mp3"))) + 0.5
        header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,34,&H00FFFFFF,&H00FFFFFF,&H0020140B,&H0020140B,0,0,0,0,100,100,0,0,3,10,0,2,90,90,28,1
Style: Header,Arial,26,&H00D4EA5E,&H00FFFFFF,&H0020140B,&H0020140B,0,0,0,0,100,100,0,0,3,5,0,8,90,90,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        label = scene.get("label", "LOCAL WALKTHROUGH | RECORDED API RESULT: 26 OCT 2026, 18:11 UTC")
        lines = [f"Dialogue: 0,0:00:00.00,{stamp(duration)},Header,,0,0,0,,{label}"]
        for start in range(0, len(words), 10):
            chunk = words[start:start + 10]
            begin = chunk[0][0]
            end = words[start + 10][0] if start + 10 < len(words) else duration
            text = " ".join(word[2] for word in chunk).replace("{", "").replace("}", "")
            lines.append(f"Dialogue: 1,{stamp(begin)},{stamp(end)},Default,,0,0,0,,{text}")
        (folder / f"{stem}.ass").write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", scene["image"], "-i", f"{stem}.mp3", "-vf",
                        f"scale=1440:900:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:70:color=0x0b1424,ass={stem}.ass",
                        "-af", "apad", "-t", str(duration), "-r", "24", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", f"{stem}.mp4"], cwd=folder, check=True)
        metadata.append({**scene, "seconds": round(duration, 3)})
        print(stem, round(duration, 2), flush=True)
    (folder / "concat.txt").write_text("\n".join(f"file 'part-{i:02}.mp4'" for i in range(len(scenes))) + "\n", encoding="utf-8")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "-movflags", "+faststart", f"taste-brief-update-{folder.name}.mp4"], cwd=folder, check=True)
    (folder / "manifest.json").write_text(json.dumps({"kind": "captioned still-screen walkthrough", "voice": "synthetic: en-US-AndrewMultilingualNeural", "scenes": metadata}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(build(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None))
