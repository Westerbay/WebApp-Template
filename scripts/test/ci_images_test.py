import tempfile
import unittest
from pathlib import Path
from ci_plan_test import load


images = load("images")


class ImageDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "infra/compose").mkdir(parents=True)
        (self.root / "compose.yml").write_text("services:\n  db:\n    image: postgres:17.11-alpine3.24\n", encoding="utf-8")

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_deduplicates_images_and_includes_source_rust_infrastructure(self):
        self.write("apps/api-rust/compose.test.yml", "image: postgres:17.11-alpine3.24\nimage: axllent/mailpit:v1.32.0\nimage: webapp-template-rust-auth-prototype:local\n")
        self.assertEqual(images.discover(self.root), {"image": ["axllent/mailpit:v1.32.0", "postgres:17.11-alpine3.24"]})

    def test_rejects_unpinned_and_dynamic_images(self):
        for image in ["postgres", "postgres:latest", "${IMAGE}"]:
            self.write("infra/compose/test.yml", f"image: {image}\n")
            with self.subTest(image=image), self.assertRaises(ValueError):
                images.discover(self.root)

    def test_only_deployed_application_image_is_external(self):
        self.write("infra/compose/production.yml", "image: ${API_IMAGE:?Set API_IMAGE}\n")
        self.assertEqual(len(images.discover(self.root)["image"]), 1)
        self.write("infra/compose/other.yml", "image: ${API_IMAGE:?Set API_IMAGE}\n")
        with self.assertRaises(ValueError):
            images.discover(self.root)

    def test_does_not_read_real_environment_files(self):
        self.write(".env", "malformed and private data")
        self.assertEqual(len(images.discover(self.root)["image"]), 1)


if __name__ == "__main__":
    unittest.main()
