"""Model-stack tests; run separately from the lightweight HTTP/storage suite."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import cv2
import numpy as np
import torch

from inference import CaptureRejected, FaceEngine, decode_frame, pad_tensor, upstream_crop

BASE = Path(__file__).resolve().parents[1]


def upstream_module(filename):
    path = BASE / 'model_tests' / 'upstream' / filename
    manifest = json.loads((BASE / 'models.manifest.json').read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['preprocessing_fixture_sha256'][filename]:
        raise AssertionError('Pinned upstream preprocessing fixture changed: ' + filename)
    spec = importlib.util.spec_from_file_location('upstream_' + path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PreprocessingTests(unittest.TestCase):
    def test_vendored_architecture_is_pinned(self):
        manifest = json.loads((BASE / 'models.manifest.json').read_text())
        self.assertEqual(hashlib.sha256((BASE / 'vendor' / 'minifasnet.py').read_bytes()).hexdigest(), manifest['architecture_sha256'])

    def test_crop_matches_official_helper_including_image_edges(self):
        reference = upstream_module('generate_patches.py').CropImage()
        image = np.random.default_rng(18).integers(0, 256, (640, 480, 3), dtype=np.uint8)
        boxes = [(100, 100, 150, 210), (1, 1, 180, 220), (290, 400, 180, 230), (0, 0, 479, 639), (119.13, 113.49, 169.56, 239.91)]
        for box in boxes:
            for scale in (2.7, 4.0):
                with self.subTest(box=box, scale=scale):
                    expected = reference.crop(image, box, scale, 80, 80)
                    np.testing.assert_array_equal(upstream_crop(image, box, scale), expected)

    def test_tensor_matches_official_bgr_without_dividing_by_255(self):
        reference = upstream_module('functional.py')
        patch_image = np.random.default_rng(21).integers(0, 256, (80, 80, 3), dtype=np.uint8)
        patch_image[0, 0] = [255, 100, 1]
        expected = reference.to_tensor(patch_image).unsqueeze(0)
        actual = pad_tensor(patch_image)
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        self.assertEqual(actual.dtype, torch.float32)
        self.assertEqual(actual[0, :, 0, 0].tolist(), [255., 100., 1.])

    def test_decode_rejects_invalid_and_non_jpeg_camera_data(self):
        image = np.zeros((200, 200, 3), dtype=np.uint8)
        _, jpeg = cv2.imencode('.jpg', image)
        self.assertEqual(decode_frame(base64.b64encode(jpeg).decode()).shape, (200, 200, 3))
        _, png = cv2.imencode('.png', image)
        for data in ('not-base64', base64.b64encode(png).decode()):
            with self.subTest(data=data[:20]), self.assertRaises(CaptureRejected):
                decode_frame(data)

    def test_duplicate_decoded_camera_frames_are_rejected(self):
        _, jpeg = cv2.imencode('.jpg', np.zeros((200, 200, 3), dtype=np.uint8))
        encoded = base64.b64encode(jpeg).decode()
        engine = FaceEngine.__new__(FaceEngine)
        engine.live_threshold, engine.match_threshold = .95, .5
        with patch.object(engine, 'inspect_frame', return_value=(b'v'*512, .99)):
            with self.assertRaisesRegex(CaptureRejected, 'fresh frames'):
                engine.process([encoded]*6)


if __name__ == '__main__':
    unittest.main()
