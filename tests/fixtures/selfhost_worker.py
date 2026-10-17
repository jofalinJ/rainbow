"""Test-only transport fixture: real HTTP/storage with an explicit mock engine.

Never serves production models or reads the production worker configuration.
The caller supplies a temporary data directory and a disposable server key.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mock-engine', action='store_true', required=True)
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()

    # Import the implementation under test; there is no copy of its routes here.
    service_path = Path(__file__).resolve().parents[2] / 'services' / 'face-biometric'
    sys.path.insert(0, str(service_path))
    from app import create_app, Settings
    import uvicorn

    class MockEngine:
        ready = True

        def process(self, frames):
            if frames != ['contract-test-frame'] * 6:
                raise ValueError('Only synthetic contract-test frames are accepted')
            return b'\x01\x00\x00\x00' * 128, .99

        def similarity(self, left, right):
            return .8 if left == right else .1

    settings = Settings(
        api_key=os.environ['SELF_HOSTED_CONTRACT_API_KEY'],
        template_key=os.urandom(32),
        origins=('https://contract.example.test',),
        data_dir=args.data_dir,
        model_dir=args.data_dir / 'no-models',
        # This applies solely to the isolated synthetic fixture, never the app.
        pilot_approved=True,
    )
    application = create_app(settings, MockEngine())
    # Keeping the bound socket avoids a choose-port/close/rebind race.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        print(json.dumps({'port': listener.getsockname()[1], 'mock_engine': True}), flush=True)
        server = uvicorn.Server(uvicorn.Config(application, log_level='error', access_log=False))
        server.run(sockets=[listener])


if __name__ == '__main__':
    main()
