"""Execute real CPU models on two checksum-pinned public upstream sample JPEGs.

This is a software compatibility smoke test, not a camera, accuracy or liveness
certification. It neither enrolls a person nor writes attendance/templates.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np

from inference import CaptureRejected, FaceEngine

BASE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=BASE / 'models')
    args = parser.parse_args()
    manifest = json.loads((BASE / 'models.manifest.json').read_text())
    engine = FaceEngine(args.directory)
    report = {'models_ready': engine.ready, 'sample_results': [], 'scope': 'Software smoke only; real camera and presentation attacks remain unvalidated.'}
    for entry in manifest['smoke_samples']:
        path = args.directory / entry['name']
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
            raise RuntimeError('Run download_models.py --include-smoke; sample missing or altered: ' + entry['name'])
        image = cv2.imread(str(path))
        height, width = image.shape[:2]
        engine.detector.setInputSize((width, height))
        _, faces = engine.detector.detect(image)
        if faces is None or len(faces) != 1:
            raise AssertionError('Public fixture must yield exactly one detected face')
        feature = engine.recognizer.feature(engine.recognizer.alignCrop(image, faces[0])).astype('<f4')
        if feature.shape != (1, 128) or not np.isfinite(feature).all():
            raise AssertionError('SFace did not produce a finite 128-dimensional feature')
        self_similarity = engine.similarity(feature.tobytes(), feature.tobytes())
        if self_similarity < .999:
            raise AssertionError('SFace self-match smoke failed')
        probabilities = engine.pad_probabilities(image, faces[0][:4])
        if probabilities.shape != (3,) or not np.isfinite(probabilities).all() or not math.isclose(float(probabilities.sum()), 1., abs_tol=1e-5):
            raise AssertionError('PAD ensemble did not produce a three-class probability distribution')
        accepted = False
        reason = None
        try:
            _, score = engine.inspect_frame(image)
            accepted = score >= engine.live_threshold
        except CaptureRejected as exc:
            reason = str(exc)
        expected_live_fixture = entry['name'] == 'smoke_image_T1.jpg'
        if accepted != expected_live_fixture:
            raise AssertionError('Unexpected result on the fixed upstream smoke fixture: ' + entry['name'])
        report['sample_results'].append({'sample': entry['name'], 'detected_faces': len(faces), 'sface_dimensions': feature.shape[1], 'self_cosine': self_similarity, 'ensemble_live_score': float(probabilities[1]), 'capture_quality_and_pad_passed': accepted, 'rejection': reason})
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
