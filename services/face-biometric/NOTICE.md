# Upstream attribution

`vendor/minifasnet.py` is byte-for-byte `src/model_lib/MiniFASNet.py` from
[minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15),
commit `b6d5f04ad78778917853b25c778acef6d5626d15`, SHA-256
`e498c4ec5e1ddfaba62b941a126c19d65aa564999f3309661fe43ee8bf38acd7`.
Original author/company notices are retained; Apache-2.0 text is in
`licenses/Silent-Face-Anti-Spoofing-LICENSE`. The two pretrained model weights
are from that same official repository and commit. The crop implementation in
`inference.py` adapts upstream `src/generate_patches.py`, while BGR 0..255 float
preprocessing and class-1 ensemble classification follow upstream
`src/data_io/functional.py`, `src/anti_spoof_predict.py`, and `test.py`.
`model_tests/upstream/generate_patches.py` and `functional.py` are unchanged
official files from that same commit, retained only for preprocessing parity
tests. Their SHA-256 digests are in `models.manifest.json`; the same Apache-2.0
license applies. They are excluded from the container build context.

The downloaded YuNet and SFace models come from official
[OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98),
commit `47534e27c9851bb1128ccc0102f1145e27f23f98`. YuNet's MIT license is in
`licenses/YuNet-LICENSE`; SFace's Apache-2.0 license is in
`licenses/SFace-LICENSE`. Names and full model/download digests are pinned in
`models.manifest.json`. OpenCV's detector, alignment, feature and cosine-match
APIs are used directly; this project does not implement a new biometric model.

Public upstream smoke images are optional downloads into the ignored model
folder and are never employee enrollment records. A successful inference test
on these still images provides no live-camera or presentation-attack assurance.
