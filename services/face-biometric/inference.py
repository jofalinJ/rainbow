"""OpenCV face verification and upstream Silent-Face passive PAD on CPU.

PAD uses BGR, unnormalized 0..255 float tensor preprocessing and crop scales from official test.py.
No hand-coded gesture or client-side liveness claim is used as a decision.
"""
import base64
import hashlib
import io
import json
import math
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from vendor.minifasnet import MiniFASNetV1SE, MiniFASNetV2

FRAME_COUNT = 6
MAX_FRAME_BYTES = 1024 * 1024
Image.MAX_IMAGE_PIXELS = 8_000_000


class CaptureRejected(ValueError):
    pass


def decode_frame(encoded: str):
    if not isinstance(encoded, str) or len(encoded) > (MAX_FRAME_BYTES * 4 // 3 + 8):
        raise CaptureRejected('Invalid frame size')
    if encoded.startswith('data:image/jpeg;base64,'):
        encoded = encoded.split(',', 1)[1]
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not 64 <= len(raw) <= MAX_FRAME_BYTES:
            raise CaptureRejected('Invalid frame size')
        with Image.open(io.BytesIO(raw)) as image:
            w, h = image.size
            if image.format != 'JPEG' or min(w, h) < 160 or max(w, h) > 4096 or w*h > 8_000_000:
                raise CaptureRejected('Use a camera JPEG between 160 and 4096 pixels')
            image.verify()
        result = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if result is None:
            raise CaptureRejected('Invalid JPEG')
        return result
    except CaptureRejected:
        raise
    except Exception as exc:
        raise CaptureRejected('Invalid camera JPEG') from exc


def upstream_crop(image, box, scale):
    """Same bounding-box expansion/clamping as upstream CropImage._get_new_box."""
    height, width = image.shape[:2]
    x, y, box_w, box_h = map(float, box)
    scale = min((height - 1) / box_h, (width - 1) / box_w, scale)
    new_w, new_h = box_w * scale, box_h * scale
    center_x, center_y = box_w / 2 + x, box_h / 2 + y
    left, top = center_x - new_w / 2, center_y - new_h / 2
    right, bottom = center_x + new_w / 2, center_y + new_h / 2
    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > width - 1:
        left -= right - width + 1
        right = width - 1
    if bottom > height - 1:
        top -= bottom - height + 1
        bottom = height - 1
    return cv2.resize(image[int(top):int(bottom)+1, int(left):int(right)+1], (80, 80))


def pad_tensor(patch):
    """Official NumPy ToTensor path: retain BGR order and 0..255 values."""
    return torch.from_numpy(np.ascontiguousarray(patch.transpose(2, 0, 1))).float().unsqueeze(0)


class FaceEngine:
    def __init__(self, model_dir: Path, live_threshold=.95, match_threshold=.5):
        self.ready = False
        self.live_threshold = live_threshold
        self.match_threshold = match_threshold
        manifest = json.loads((Path(__file__).parent / 'models.manifest.json').read_text())
        for entry in manifest['models']:
            path = model_dir / entry['name']
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
                raise RuntimeError('Model missing or checksum mismatch: ' + entry['name'])
        cv2.setNumThreads(1)
        torch.set_num_threads(1)
        self.detector = cv2.FaceDetectorYN.create(str(model_dir / 'face_detection_yunet_2023mar.onnx'), '', (320, 320), .9, .3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(str(model_dir / 'face_recognition_sface_2021dec.onnx'), '')
        self.pad = []
        for name, builder, scale in [('2.7_80x80_MiniFASNetV2.pth', MiniFASNetV2, 2.7), ('4_0_0_80x80_MiniFASNetV1SE.pth', MiniFASNetV1SE, 4.0)]:
            model = builder(conv6_kernel=(5, 5))
            # Only pinned official state dictionaries; weights_only forbids pickle objects.
            state = torch.load(model_dir / name, map_location='cpu', weights_only=True)
            model.load_state_dict({key.removeprefix('module.'): value for key, value in state.items()}, strict=True)
            model.eval()
            self.pad.append((model, scale))
        self.ready = True

    def pad_probabilities(self, image, box):
        probabilities = []
        with torch.inference_mode():
            for model, scale in self.pad:
                patch = upstream_crop(image, box, scale)
                probabilities.append(torch.softmax(model(pad_tensor(patch)), dim=1)[0].cpu().numpy())
        return np.mean(probabilities, axis=0)

    def similarity(self, left: bytes, right: bytes) -> float:
        a = np.frombuffer(left, dtype='<f4').reshape(1, -1).copy()
        b = np.frombuffer(right, dtype='<f4').reshape(1, -1).copy()
        if a.shape != (1, 128) or b.shape != (1, 128) or not np.isfinite(a).all() or not np.isfinite(b).all():
            raise CaptureRejected('Invalid template')
        score = float(self.recognizer.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))
        if not math.isfinite(score):
            raise CaptureRejected('Invalid template score')
        return max(-1., min(1., score))

    def inspect_frame(self, image):
        height, width = image.shape[:2]
        # YuNet training is strongest below ~300px face size; use 640px input.
        ratio = min(1., 640 / max(width, height))
        detection_image = cv2.resize(image, (round(width*ratio), round(height*ratio)))
        self.detector.setInputSize((detection_image.shape[1], detection_image.shape[0]))
        _, faces = self.detector.detect(detection_image)
        if faces is None or len(faces) != 1:
            raise CaptureRejected('Exactly one face is required')
        face = faces[0].copy()
        face[:14] /= ratio
        x, y, w, h = face[:4]
        if min(w, h) < 100 or x < 0 or y < 0 or x+w >= width or y+h >= height:
            raise CaptureRejected('Move closer and keep the complete face visible')
        crop = image[int(y):int(y+h), int(x):int(x+w)]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        if not 40 <= float(gray.mean()) <= 215 or float(cv2.Laplacian(gray, cv2.CV_64F).var()) < 35:
            raise CaptureRejected('Face is too dark, bright, or blurred')
        # Keep near-frontal framing; large eye slope is rejected.
        eye_dx, eye_dy = face[4] - face[6], face[5] - face[7]
        if abs(eye_dx) < .2*w or abs(math.degrees(math.atan2(eye_dy, abs(eye_dx)))) > 20:
            raise CaptureRejected('Look straight at the camera')
        aligned = self.recognizer.alignCrop(image, face)
        feature = self.recognizer.feature(aligned).astype('<f4').reshape(1, 128)
        ensemble = self.pad_probabilities(image, face[:4])
        live = float(ensemble[1])  # Upstream labels: 1 = live.
        if not math.isfinite(live) or int(np.argmax(ensemble)) != 1:
            raise CaptureRejected('Passive liveness check failed')
        return feature.tobytes(), live

    def process(self, frames: list[str]):
        if len(frames) != FRAME_COUNT:
            raise CaptureRejected('Six camera frames are required')
        vectors, scores, seen = [], [], set()
        for encoded in frames:
            image = decode_frame(encoded)
            digest = hashlib.sha256(image.tobytes()).digest()
            if digest in seen:
                raise CaptureRejected('Capture fresh frames from the camera')
            seen.add(digest)
            vector, live = self.inspect_frame(image)
            # Every frame must pass, not just the average of six frames.
            if live < self.live_threshold:
                raise CaptureRejected('Passive liveness check failed')
            if any(self.similarity(previous, vector) < self.match_threshold for previous in vectors):
                raise CaptureRejected('Keep the same person in view')
            vectors.append(vector)
            scores.append(live)
        # Use a real SFace feature, not a synthetic averaged biometric vector.
        return vectors[0], min(scores)
