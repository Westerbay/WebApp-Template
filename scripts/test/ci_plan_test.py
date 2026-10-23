import copy
import importlib.util
import io
import json
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / "ci" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


planner = load("plan")
gate = load("gate")


class PlanningTests(unittest.TestCase):
    def setUp(self):
        self.event = {
            "repository": {"full_name": "owner/repo", "id": 1, "default_branch": "main"},
            "after": "merge",
        }
        self.pr = {
            "number": 47, "merged_at": "2026-10-23", "merge_commit_sha": "merge",
            "base": {"ref": "main"}, "head": {"sha": "head", "repo": {"id": 1}},
        }
        self.run = {"id": 10, "head_sha": "head", "conclusion": "success", "event": "pull_request", "head_repository": {"id": 1}}
        self.artifact = {"id": 20, "name": "ci-validated-tree", "expired": False, "size_in_bytes": 200}
        self.proof = {"repository_id": 1, "pull_request": 47, "head": "head", "tree": "tree"}

    def api(self, path, binary=False):
        if "/commits/" in path:
            return [self.pr]
        if "/workflows/ci.yml/runs?" in path:
            return {"workflow_runs": [self.run]}
        if "/runs/" in path:
            return {"artifacts": [self.artifact]}
        if binary:
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w") as archive:
                archive.writestr("proof.json", json.dumps(self.proof))
            return output.getvalue()
        raise AssertionError(path)

    def test_prs_and_manual_runs_always_validate(self):
        for event in ["pull_request", "workflow_dispatch", "merge_group"]:
            with self.subTest(event=event):
                self.assertEqual(planner.plan(event, self.event, "tree", self.api), {"validation": True, "security": True})

    def test_schedule_refreshes_security_only(self):
        self.assertEqual(planner.plan("schedule", self.event, "tree", self.api), {"validation": False, "security": True})

    def test_exact_successfully_validated_merge_is_not_repeated(self):
        self.assertEqual(planner.plan("push", self.event, "tree", self.api), {"validation": False, "security": False})

    def test_direct_push_is_validated(self):
        self.pr["merge_commit_sha"] = "other"
        self.assertTrue(planner.plan("push", self.event, "tree", self.api)["validation"])

    def test_no_proof_expired_failed_foreign_or_changed_tree_cannot_skip(self):
        changes = [
            (self.proof, "tree", "other-tree"),
            (self.proof, "repository_id", 2),
            (self.proof, "pull_request", 48),
            (self.proof, "head", "old-head"),
            (self.artifact, "expired", True),
            (self.artifact, "name", "unrelated"),
            (self.artifact, "size_in_bytes", 65537),
            (self.run, "conclusion", "failure"),
            (self.run, "head_sha", "old-head"),
            (self.run, "event", "push"),
        ]
        for record, key, value in changes:
            original = record[key]
            with self.subTest(key=key, value=value):
                record[key] = value
                self.assertTrue(planner.plan("push", self.event, "tree", self.api)["validation"])
            record[key] = original

    def test_fork_merge_runs_checks_on_main(self):
        self.pr["head"]["repo"]["id"] = 2
        self.assertTrue(planner.plan("push", self.event, "tree", self.api)["validation"])

    def test_api_failure_fails_closed_by_running_checks(self):
        def unavailable(*args, **kwargs):
            raise urllib.error.URLError("offline")
        self.assertEqual(planner.plan("push", self.event, "tree", unavailable), {"validation": True, "security": True})

    def test_malformed_or_oversized_proof_cannot_skip(self):
        for content in [b"not a zip", b"x" * 5000]:
            def corrupted(path, binary=False):
                if not binary:
                    return self.api(path)
                if content == b"not a zip":
                    return content
                output = io.BytesIO()
                with zipfile.ZipFile(output, "w") as archive:
                    archive.writestr("proof.json", content)
                return output.getvalue()
            with self.subTest(size=len(content)):
                self.assertTrue(planner.plan("push", self.event, "tree", corrupted)["validation"])

    def test_redirect_does_not_disclose_github_token(self):
        request = urllib.request.Request("https://api.github.com/artifact", headers={"Authorization": "Bearer example"})
        redirected = planner.SafeRedirect().redirect_request(request, None, 302, "Found", {}, "https://storage.example.test/proof.zip")
        self.assertIsNone(redirected.get_header("Authorization"))
        with self.assertRaises(urllib.error.URLError):
            planner.SafeRedirect().redirect_request(request, None, 302, "Found", {}, "http://storage.example.test/proof.zip")


class GateTests(unittest.TestCase):
    def setUp(self):
        self.needs = {
            "plan": {"result": "success", "outputs": {"validation": "true", "security": "true"}},
            "security": {"result": "success"}, "application": {"result": "success"},
        }

    def test_success_and_explicit_deduplication(self):
        self.assertTrue(gate.passed(self.needs, ["application"]))
        self.needs["plan"]["outputs"] = {"validation": "false", "security": "false"}
        self.needs["application"]["result"] = "skipped"
        self.needs["security"]["result"] = "skipped"
        self.assertTrue(gate.passed(self.needs, ["application"]))

    def test_failure_cancellation_or_unexpected_skip_cannot_pass(self):
        for job in ["plan", "security", "application"]:
            for result in ["failure", "cancelled", "skipped"]:
                needs = copy.deepcopy(self.needs)
                needs[job]["result"] = result
                with self.subTest(job=job, result=result):
                    self.assertFalse(gate.passed(needs, ["application"]))

    def test_weekly_security_only_and_missing_outputs(self):
        self.needs["plan"]["outputs"]["validation"] = "false"
        self.needs["application"]["result"] = "skipped"
        self.assertTrue(gate.passed(self.needs, ["application"]))
        self.needs["plan"]["outputs"].pop("security")
        self.assertFalse(gate.passed(self.needs, ["application"]))


if __name__ == "__main__":
    unittest.main()
