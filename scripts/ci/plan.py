"""Plan CI events and reuse only a successful PR run for the exact merged tree."""

import io
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
import urllib.error
import zipfile
from pathlib import Path


PROOF_NAME = "ci-validated-tree"


def validated_merge(event, tree, api):
    repository = event["repository"]
    repo = repository["full_name"]
    sha = event["after"]
    for pr in api(f"repos/{repo}/commits/{sha}/pulls?per_page=100"):
        if not (
            pr.get("merged_at")
            and pr.get("merge_commit_sha") == sha
            and pr["base"]["ref"] == repository["default_branch"]
            and pr["head"]["repo"]
            and pr["head"]["repo"]["id"] == repository["id"]
        ):
            continue
        head = pr["head"]["sha"]
        query = urllib.parse.urlencode(
            {"event": "pull_request", "head_sha": head, "status": "success", "per_page": 100}
        )
        runs = api(f"repos/{repo}/actions/workflows/ci.yml/runs?{query}")
        for run in runs["workflow_runs"]:
            if not (
                run["head_sha"] == head
                and run["conclusion"] == "success"
                and run["event"] == "pull_request"
                and run["head_repository"]["id"] == repository["id"]
            ):
                continue
            artifacts = api(f"repos/{repo}/actions/runs/{run['id']}/artifacts?per_page=100")
            for artifact in artifacts["artifacts"]:
                if (
                    artifact["name"] != PROOF_NAME
                    or artifact["expired"]
                    or artifact["size_in_bytes"] > 65536
                ):
                    continue
                archive = api(f"repos/{repo}/actions/artifacts/{artifact['id']}/zip", binary=True)
                with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
                    entry = zipped.getinfo("proof.json")
                    if entry.file_size > 4096:
                        continue
                    proof = json.loads(zipped.read(entry))
                if proof == {
                    "repository_id": repository["id"],
                    "pull_request": pr["number"],
                    "head": head,
                    "tree": tree,
                }:
                    return True
    return False


def plan(event_name, event, tree, api):
    if event_name == "schedule":
        return {"validation": False, "security": True}
    if event_name == "push":
        try:
            if validated_merge(event, tree, api):
                return {"validation": False, "security": False}
        except (KeyError, ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError, TypeError) as error:
            # Missing permissions, expired proof or API errors must run checks.
            print(f"::warning::Cannot reuse previous CI ({type(error).__name__}); running all checks")
    return {"validation": True, "security": True}


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        if urllib.parse.urlsplit(new_url).scheme != "https":
            raise urllib.error.URLError("Refusing an insecure API redirect")
        redirected = super().redirect_request(request, response, code, message, headers, new_url)
        if urllib.parse.urlsplit(new_url).netloc != urllib.parse.urlsplit(request.full_url).netloc:
            redirected.remove_header("Authorization")
        return redirected


def github_api(path, binary=False):
    request = urllib.request.Request(
        os.environ["GITHUB_API_URL"].rstrip("/") + "/" + path,
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "WebApp-Template-CI",
        },
    )
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=30) as response:
        data = response.read(65537 if binary else 4 * 1024 * 1024)
    return data if binary else json.loads(data)


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip()
    if len(sys.argv) > 1 and sys.argv[1] == "prove":
        pr = event.get("pull_request", {})
        proof = {
            "repository_id": event["repository"]["id"],
            "pull_request": pr.get("number"),
            "head": pr.get("head", {}).get("sha", os.environ["GITHUB_SHA"]),
            "tree": tree,
        }
        Path(sys.argv[2]).write_text(json.dumps(proof), encoding="utf-8")
        return
    result = plan(os.environ["GITHUB_EVENT_NAME"], event, tree, github_api)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key, value in result.items():
            output.write(f"{key}={str(value).lower()}\n")
    print("CI plan:", json.dumps(result))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        if not result["validation"] and not result["security"]:
            summary = "Reused a successful PR validation for the exact merged Git tree. No checks repeated."
        elif not result["validation"]:
            summary = "Scheduled security refresh. Application and template tests are not repeated."
        else:
            summary = "Full validation required: PR, manual run, direct push, or no matching successful validation proof."
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            output.write(summary + "\n")


if __name__ == "__main__":
    main()
