"""Verify an App Store Connect API key works, without a build.

EAS can create certificates, provisioning profiles and TestFlight submissions
non-interactively if it is handed an ASC API key - but the first thing that
tells you the key is wrong is usually a failed build, which costs quota and
20 minutes. This asks Apple directly instead.

Reads the key only to sign a short-lived JWT; nothing is printed or stored.

Usage:
  EXPO_ASC_API_KEY_PATH=... EXPO_ASC_KEY_ID=... EXPO_ASC_ISSUER_ID=... \\
  python tools/check_asc_key.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

import jwt

API = "https://api.appstoreconnect.apple.com/v1"


def token(key_path, key_id, issuer_id):
    with open(key_path, "r") as f:
        private_key = f.read()
    now = int(time.time())
    return jwt.encode(
        {"iss": issuer_id, "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"},
        private_key,
        algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )


def get(path, tok):
    req = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {tok}"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def main():
    key_path = os.environ.get("EXPO_ASC_API_KEY_PATH")
    key_id = os.environ.get("EXPO_ASC_KEY_ID")
    issuer = os.environ.get("EXPO_ASC_ISSUER_ID")
    if not (key_path and key_id and issuer):
        print("set EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID and EXPO_ASC_ISSUER_ID")
        return 1
    if not os.path.exists(key_path):
        print(f"key file not found: {key_path}")
        return 1

    try:
        tok = token(key_path, key_id, issuer)
    except Exception as e:
        print(f"could not sign a token with this key: {e}")
        return 1

    try:
        apps = get("/apps?limit=200", tok)
    except urllib.error.HTTPError as e:
        print(f"Apple rejected the key: HTTP {e.code}")
        print(e.read().decode()[:400])
        return 1

    print(f"key {key_id} works — {len(apps['data'])} apps visible:")
    target = os.environ.get("BULKSIFT_BUNDLE_ID", "com.rldgames.bulksift")
    found = None
    for a in apps["data"]:
        at = a["attributes"]
        mark = ""
        if at.get("bundleId") == target:
            found = a
            mark = "   <-- BulkSift"
        print(f"  {at.get('name','?')[:34]:34s} {at.get('bundleId','?')}{mark}")

    # The build needs certificates; being able to read them proves the key has
    # enough access to create them too.
    try:
        certs = get("/certificates?limit=200", tok)
        kinds = {}
        for c in certs["data"]:
            k = c["attributes"].get("certificateType", "?")
            kinds[k] = kinds.get(k, 0) + 1
        print(f"\ncertificates visible: {kinds or 'none yet'}")
    except urllib.error.HTTPError as e:
        print(f"\ncannot read certificates (HTTP {e.code}) — the key may lack Admin/App Manager")

    print(f"\napp record for {target}: {'exists' if found else 'not created yet'}")
    if not found:
        print("  EAS creates it on the first `eas build` / `eas submit`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
