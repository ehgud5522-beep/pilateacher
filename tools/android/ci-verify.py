"""Verify the exact signed AAB, manifest and web assets before Play publishing."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parents[2]
aab = root / 'android/app/build/outputs/bundle/release/app-release.aab'
expected_sha1 = '170722E5F1FDF087CBD933268B6DFF4B79817A09'

def capture(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)

def fingerprint(text):
    match = re.search(r'SHA1:\s*([A-Fa-f0-9:]+)', text)
    if not match:
        raise RuntimeError('UPLOAD_CERTIFICATE_UNREADABLE')
    return match[1].replace(':', '').upper()

actual_sha1 = fingerprint(capture(['keytool', '-J-Duser.language=en', '-printcert', '-jarfile', str(aab)]))
if actual_sha1 != expected_sha1:
    raise RuntimeError('UPLOAD_CERTIFICATE_MISMATCH: expected the existing instructor upload certificate')

manifests = list((root / 'android/app/build/intermediates').glob('**/release/**/AndroidManifest.xml'))
valid_manifest = False
for path in manifests:
    try:
        text = path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError):
        continue
    if 'package="com.pilateacher.app"' not in text or 'android:versionCode=' not in text:
        continue
    if 'android:debuggable="true"' in text:
        raise RuntimeError('DEBUGGABLE_RELEASE')
    version = re.search(r'android:versionCode="(\d+)"', text)
    if not version or version[1] != os.environ['ANDROID_VERSION_CODE']:
        raise RuntimeError('BUNDLE_VERSION_MISMATCH')
    expected_name = re.search(r'\bversionName\s+"([^"]+)"', (root / 'android/app/build.gradle').read_text())[1]
    if f'android:versionName="{expected_name}"' not in text:
        raise RuntimeError('BUNDLE_VERSION_NAME_MISMATCH')
    valid_manifest = True
if not valid_manifest:
    raise RuntimeError('RELEASE_MANIFEST_MISSING')

with zipfile.ZipFile(aab) as archive:
    for asset in (root / 'dist').rglob('*'):
        if asset.is_file():
            name = 'base/assets/public/' + asset.relative_to(root / 'dist').as_posix()
            if archive.read(name) != asset.read_bytes():
                raise RuntimeError('BUNDLE_ASSET_MISMATCH: ' + name)

proof = {
    'commit': os.environ['CM_COMMIT'],
    'branch': os.environ['CM_BRANCH'],
    'versionCode': int(os.environ['ANDROID_VERSION_CODE']),
    'playMaximumBeforeBuild': int(os.environ['LATEST_GOOGLE_PLAY_BUILD_NUMBER']),
    'uploadCertificateSha1': actual_sha1,
    'aabSha256': hashlib.sha256(aab.read_bytes()).hexdigest(),
    'track': 'production',
}
(root / '.android-release/ci-release.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof, indent=2))
