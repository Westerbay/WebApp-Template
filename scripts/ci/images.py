"""Render Compose without env files and discover each infrastructure image once."""

import json
import os
import re
import subprocess
from pathlib import Path


def render(path):
    result = subprocess.run(
        ["docker", "compose", "--env-file", os.devnull, "-f", str(path),
         "config", "--no-interpolate", "--no-env-resolution", "--no-consistency", "--format", "json"],
        check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


def discover(root, renderer=render):
    root = root.resolve()
    paths = [root / "compose.yml", *sorted((root / "infra/compose").glob("*.y*ml"))]
    crate = root / "apps/api-rust/compose.test.yml"
    if crate.exists():
        paths.append(crate)
    images = {}
    for path in paths:
        for service in renderer(path).get("services", {}).values():
            image = service.get("image")
            if not image:
                raise ValueError(f"Compose service without an image tag in {path}")
            if path == root / "infra/compose/production.yml" and image.startswith("${API_IMAGE:"):
                print("::notice::Deployment-supplied API_IMAGE must be scanned by its publishing pipeline")
                continue
            # This test runner is never delivered as an application runtime.
            if image == "webapp-template-rust-auth-prototype:local" and path == crate:
                continue
            if "$" in image or ":" not in image or image.endswith(":latest"):
                raise ValueError(f"Expected a versioned literal image in {path}: {image}")
            row = {"image": image, "context": "", "artifact": ""}
            if build := service.get("build"):
                if set(build) - {"context", "dockerfile"} or build.get("dockerfile", "Dockerfile") != "Dockerfile":
                    raise ValueError(f"Unsupported image build configuration in {path}: {image}")
                context = Path(build["context"]).resolve()
                relative = context.relative_to(root / "infra/images")
                if len(relative.parts) != 1 or not re.fullmatch(r"[a-z0-9-]+", relative.name):
                    raise ValueError(f"Expected an owned infrastructure recipe directory: {context}")
                if not (context / "Dockerfile").is_file():
                    raise ValueError(f"Missing Dockerfile: {context}")
                row.update(context=context.relative_to(root).as_posix(), artifact=relative.name)
            if image in images and images[image] != row:
                raise ValueError(f"Conflicting build definitions for {image}")
            images[image] = row
    if not images:
        raise ValueError("No Compose images found")
    artifacts = [row["artifact"] for row in images.values() if row["artifact"]]
    if len(artifacts) != len(set(artifacts)):
        raise ValueError("Multiple image tags use the same infrastructure recipe")
    return {"include": [images[name] for name in sorted(images)]}


if __name__ == "__main__":
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write("matrix=" + json.dumps(discover(Path.cwd())) + "\n")
        for directory in ["apps/api-rust", "apps/api"]:
            if Path(directory, "Cargo.lock").exists():
                output.write(f"cargo={directory}\n")
                break
