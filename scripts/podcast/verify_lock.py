"""Check docs/podcast-check/LOCK.sha256 and LOCK-2.sha256 on any OS.

The lock was made on Windows, where brands.json was written with CRLF line endings; git stores it with LF, so a plain
`sha256sum -c` on a fresh clone reports a mismatch for that file although its content is unchanged. This script hashes
each locked file as it is on disk and with its line endings normalised to LF and to CRLF, and says which one matches.

Usage: python scripts/podcast/verify_lock.py
"""
import hashlib, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ok = True
lines = [l for f in ("LOCK.sha256", "LOCK-2.sha256") if os.path.exists(os.path.join(ROOT, "docs", "podcast-check", f))
         for l in open(os.path.join(ROOT, "docs", "podcast-check", f), encoding="utf-8") if l.strip()]
for line in lines:
    want, name = line.split()
    raw = open(os.path.join(ROOT, name.lstrip("*")), "rb").read()
    lf = raw.replace(b"\r\n", b"\n")
    forms = {"as on disk": raw, "LF line endings": lf, "CRLF line endings": lf.replace(b"\n", b"\r\n")}
    hit = next((k for k, b in forms.items() if hashlib.sha256(b).hexdigest() == want), None)
    ok &= hit is not None
    print(f"{'OK  ' if hit else 'FAIL'} {name.lstrip('*')}" + (f" (matches {hit})" if hit else ""))
sys.exit(0 if ok else 1)
