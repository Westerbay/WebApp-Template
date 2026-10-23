import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ci_plan_test import load

images = load("images")


class ImageDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.write("compose.yml", "services:\n  db:\n    image: postgres:17.11-alpine3.24\n")

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def discover(self):
        return images.discover(self.root)["include"]

    def recipe(self, name="postgres"):
        self.write(f"infra/images/{name}/Dockerfile", "FROM scratch\n")
        return f"    image: template-postgres:17.11-security.1\n    build:\n      context: ./infra/images/{name}\n"

    def test_deduplicates_images_and_includes_source_rust_infrastructure(self):
        self.write("apps/api-rust/compose.test.yml", "services:\n  db:\n    image: postgres:17.11-alpine3.24\n  mail:\n    image: axllent/mailpit:v1.32.0\n  test:\n    image: webapp-template-rust-auth-prototype:local\n")
        self.assertEqual([row["image"] for row in self.discover()], ["axllent/mailpit:v1.32.0", "postgres:17.11-alpine3.24"])

    def test_rejects_unpinned_and_dynamic_images(self):
        for image in ["postgres", "postgres:latest", "${IMAGE}"]:
            self.write("infra/compose/test.yml", f"services:\n  db:\n    image: {image}\n")
            with self.subTest(image=image), self.assertRaises(ValueError):
                self.discover()

    def test_only_deployed_application_image_is_external(self):
        self.write("infra/compose/production.yml", "services:\n  api:\n    image: ${API_IMAGE:?Set API_IMAGE}\n")
        self.assertEqual(len(self.discover()), 1)
        self.write("infra/compose/other.yml", "services:\n  api:\n    image: ${API_IMAGE:?Set API_IMAGE}\n")
        with self.assertRaises(ValueError):
            self.discover()

    def test_does_not_load_root_or_service_environment_files(self):
        self.write(".env", "invalid: [private synthetic fixture")
        self.write("compose.yml", "services:\n  db:\n    image: postgres:17.11-alpine3.24\n    env_file: missing-private.env\n    environment:\n      VALUE: ${REQUIRED:?must not interpolate}\n")
        self.assertEqual(len(self.discover()), 1)

    def test_renders_without_environment_resolution(self):
        with patch.object(images.subprocess, "run") as run:
            run.return_value.stdout = '{"services": {}}'
            images.render(self.root / "compose.yml")
            command = run.call_args.args[0]
            self.assertEqual(command[command.index("--env-file") + 1], os.devnull)
            for flag in ["--no-interpolate", "--no-env-resolution", "--no-consistency"]:
                self.assertIn(flag, command)

    def test_deduplicates_builds_with_paths_relative_to_each_compose_file(self):
        build = self.recipe()
        self.write("compose.yml", "services:\n  db:\n" + build)
        self.write("infra/compose/test.yml", "services:\n  db:\n" + build.replace("./infra/images/", "../images/"))
        self.assertEqual(self.discover(), [{"image": "template-postgres:17.11-security.1", "context": "infra/images/postgres", "artifact": "postgres"}])

    def test_rejects_builds_outside_owned_recipes_and_unsupported_options(self):
        build = self.recipe()
        for config in [build.replace("./infra/images/postgres", "../outside"), build + "      args:\n        CHANGE: unsafe\n", build.replace("postgres\n", "postgres/missing\n")]:
            self.write("compose.yml", "services:\n  db:\n" + config)
            with self.subTest(config=config), self.assertRaises(ValueError):
                self.discover()

    def test_rejects_conflicting_definitions_of_the_same_image(self):
        self.write("compose.yml", "services:\n  db:\n" + self.recipe())
        self.write("infra/compose/test.yml", "services:\n  db:\n    image: template-postgres:17.11-security.1\n")
        with self.assertRaisesRegex(ValueError, "Conflicting build"):
            self.discover()


if __name__ == "__main__":
    unittest.main()
