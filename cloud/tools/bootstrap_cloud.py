#!/usr/bin/env python3
"""One-time import of Y.U.R.A. Cloud sources from the verified release ZIP.

Imports only the Worker source, schema migrations and public config. Never
copies secrets, OAuth files, local credentials or the release helper scripts.
"""
import pathlib
import re
import sys
import zipfile

EXPECTED_DB = "a9a1cd82-2b0e-46a1-910a-706a6bd6f4d9"
ROOT_SUFFIX = "/Cloud/yura-cloud/wrangler.toml"
REQUIRED = ("wrangler.toml", "package.json", "tsconfig.json", "src/index.ts")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: bootstrap_cloud.py <release.zip> <output-dir>")
    archive, dest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    if not archive.is_file():
        raise SystemExit(f"Missing release archive: {archive}")
    if (dest / "src/index.ts").exists():
        raise SystemExit("Cloud sources already exist; refusing to overwrite them")

    with zipfile.ZipFile(archive) as z:
        roots = [n[: -len("wrangler.toml")] for n in z.namelist()
                 if n.endswith(ROOT_SUFFIX)]
        if len(roots) != 1:
            raise SystemExit("Expected exactly one Cloud/yura-cloud source folder")
        base = roots[0]
        selected = list(REQUIRED) + sorted(
            n[len(base):] for n in z.namelist()
            if n.startswith(base + "migrations/") and n.endswith(".sql")
            and "/" not in n[len(base + "migrations/"):]
        )
        if len(selected) < len(REQUIRED) + 10:
            raise SystemExit("Incomplete D1 migration history. Import cancelled")
        payload = {name: z.read(base + name).decode("utf-8-sig")
                   for name in selected}
    config = payload["wrangler.toml"]
    if not re.search(r'(?m)^name\s*=\s*"yura-cloud"\s*$', config):
        raise SystemExit("Worker name mismatch. Import cancelled")
    if not re.search(r'database_id\s*=\s*"' + EXPECTED_DB + r'"', config):
        raise SystemExit("Production D1 database ID mismatch. Import cancelled")

    # Preserve all production dashboard variables and secrets when deploying.
    # Existing config [vars] values must not override dashboard changes.
    config = re.sub(r'(?ms)^\[vars\]\s*\n.*?(?=^\[|\Z)', '', config)
    config = re.sub(r'(?m)^keep_vars\s*=.*\n?', '', config).strip() + "\n"
    payload["wrangler.toml"] = "keep_vars = true\n" + config
    payload[".gitignore"] = (
        "node_modules/\n.wrangler/\n.dev.vars*\n.env*\n*.log\n"
        "cloud-install.json\nprivate.secrets.bin\n"
    )
    for name, data in payload.items():
        output = dest / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(data, encoding="utf-8")
    print(f"Imported {len(payload)} reviewed files to {dest}")
    print("Remote D1 kept in place. Dashboard secrets and variables preserved.")


if __name__ == "__main__":
    main()
