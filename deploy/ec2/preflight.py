#!/usr/bin/env python3
"""Validate DAS service environment files without displaying their values."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", stripped)
        if not match:
            continue
        key, value = match.groups()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def valid_url(value: str, schemes: set[str]) -> bool:
    try:
        parsed = urlsplit(value)
        return parsed.scheme in schemes and bool(parsed.hostname)
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-env", type=Path, required=True)
    parser.add_argument("--face-env", type=Path, required=True)
    args = parser.parse_args()

    results: list[tuple[str, bool]] = []
    try:
        server = read_env(args.server_env)
        face = read_env(args.face_env)
    except OSError:
        print("FAIL ENV_FILES")
        return 1

    required = (
        "MONGO_URI", "JWT_SECRET", "CLIENT_URL", "FACE_SERVICE_URL",
        "FACE_SERVICE_TOKEN", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET", "CAMPUS_LATITUDE", "CAMPUS_LONGITUDE",
        "CAMPUS_RADIUS",
    )
    for name in required:
        results.append((name, bool(server.get(name, "").strip())))

    results.append(("MONGO_URI_FORMAT", valid_url(server.get("MONGO_URI", ""), {"mongodb", "mongodb+srv"})))
    results.append(("JWT_SECRET_LENGTH", len(server.get("JWT_SECRET", "")) >= 32))
    client_url = server.get("CLIENT_URL", "")
    results.append(("CLIENT_URL_HTTPS_ORIGIN", valid_url(client_url, {"https"}) and urlsplit(client_url).path in ("", "/") and not urlsplit(client_url).query and not urlsplit(client_url).fragment))
    results.append(("FACE_SERVICE_URL_FORMAT", valid_url(server.get("FACE_SERVICE_URL", ""), {"http", "https"})))
    backend_token = server.get("FACE_SERVICE_TOKEN", "")
    face_token = face.get("FACE_SERVICE_TOKEN", "")
    results.append(("FACE_SERVICE_TOKEN_LENGTH", len(backend_token) >= 32))
    results.append(("FACE_SERVICE_TOKEN_MATCH", bool(backend_token) and backend_token == face_token))

    for name in ("CAMPUS_LATITUDE", "CAMPUS_LONGITUDE", "CAMPUS_RADIUS"):
        try:
            float(server.get(name, ""))
            valid = True
        except ValueError:
            valid = False
        results.append((f"{name}_NUMERIC", valid))

    smtp_names = (
        "BREVO_SMTP_HOST", "BREVO_SMTP_PORT", "BREVO_SMTP_USER",
        "BREVO_SMTP_KEY", "BREVO_FROM_EMAIL", "BREVO_FROM_NAME",
    )
    smtp_values = [server.get(name, "").strip() for name in smtp_names]
    results.append(("BREVO_SMTP_OPTIONAL_OR_COMPLETE", not any(smtp_values) or all(smtp_values)))

    results.append(("FACE_MODEL_NAME_BUFFALO_SC", face.get("FACE_MODEL_NAME", "buffalo_sc") == "buffalo_sc"))
    results.append(("FACE_INFERENCE_THREADS", face.get("FACE_INFERENCE_THREADS", "1") == "1"))

    for name, passed in results:
        print(f"{'PASS' if passed else 'FAIL'} {name}")
    return 0 if all(passed for _, passed in results) else 1


if __name__ == "__main__":
    sys.exit(main())
