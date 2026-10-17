"""Download only official, commit-pinned files and verify SHA-256 before use."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

BASE = Path(__file__).resolve().parent


def download(entry, directory):
    target = directory / entry['name']
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == entry['sha256']:
        print('Verified:', entry['name'])
        return
    request = urllib.request.Request(entry['url'], headers={'User-Agent':'Rainbow-self-hosted-biometric-model-setup/1'})
    digest = hashlib.sha256()
    temporary = None
    try:
        with urllib.request.urlopen(request, timeout=180) as response, tempfile.NamedTemporaryFile(dir=directory, delete=False) as output:
            temporary = Path(output.name)
            size = 0
            while block := response.read(1024*1024):
                size += len(block)
                if size > entry['bytes']:
                    raise ValueError('Download exceeds pinned size')
                digest.update(block)
                output.write(block)
        if size != entry['bytes'] or digest.hexdigest() != entry['sha256']:
            raise ValueError('Download checksum mismatch: ' + entry['name'])
        os.chmod(temporary, 0o644)
        temporary.replace(target)
        print('Downloaded and verified:', entry['name'])
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=Path(os.environ.get('FACE_MODEL_DIR',BASE/'models')))
    parser.add_argument('--include-smoke',action='store_true',help='Also fetch upstream public sample images, never employee data')
    args=parser.parse_args();args.directory.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((BASE/'models.manifest.json').read_text())
    if hashlib.sha256((BASE/'vendor/minifasnet.py').read_bytes()).hexdigest()!=manifest['architecture_sha256']:
        raise ValueError('Vendored upstream architecture checksum mismatch')
    for entry in manifest['models'] + (manifest.get('smoke_samples',[]) if args.include_smoke else []):
        download(entry,args.directory)


if __name__=='__main__':main()
