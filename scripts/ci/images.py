"""Discover unique versioned infrastructure images without reading env files."""

import json
import os
import re
from pathlib import Path


def discover(root):
    paths = [root / "compose.yml", *sorted((root / "infra/compose").glob("*.y*ml"))]
    crate = root / "apps/api-rust/compose.test.yml"
    if crate.exists():
        paths.append(crate)
    images = set()
    for path in paths:
        for match in re.finditer(r"^\s*image:\s*([^\s#]+)", path.read_text(encoding="utf-8"), re.MULTILINE):
            image = match[1].strip("\"'")
            if path == root / "infra/compose/production.yml" and image.startswith("${API_IMAGE:"):
                print("::notice::Deployment-supplied API_IMAGE must be scanned by its publishing pipeline")
                continue
            # Locally built fixture images have no remotely published artifact.
            if image == "webapp-template-rust-auth-prototype:local" and path == crate:
                continue
            if "$" in image or ":" not in image or image.endswith(":latest"):
                raise ValueError(f"Expected a versioned literal image in {path}: {image}")
            images.add(image)
    if not images:
        raise ValueError("No Compose images found")
    return {"image": sorted(images)}


if __name__ == "__main__":
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write("matrix=" + json.dumps(discover(Path.cwd())) + "\n")
        for directory in ["apps/api-rust", "apps/api"]:
            if Path(directory, "Cargo.lock").exists():
                output.write(f"cargo={directory}\n")
                break
