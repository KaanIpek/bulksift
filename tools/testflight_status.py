"""Ask App Store Connect what state each TestFlight build is in.

`eas submit` only reports that the binary reached Apple. Whether it then
finished processing, and whether it is actually installable by a tester, is a
separate question that otherwise means refreshing a web page.

Usage:
  EXPO_ASC_API_KEY_PATH=... EXPO_ASC_KEY_ID=... EXPO_ASC_ISSUER_ID=... \\
  python tools/testflight_status.py [app_id]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

import jwt

API = "https://api.appstoreconnect.apple.com/v1"
DEFAULT_APP_ID = "6800808960"  # BulkSift


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

    app_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_APP_ID
    tok = token(key_path, key_id, issuer)

    try:
        data = get(
            f"/builds?filter[app]={app_id}&limit=8&sort=-uploadedDate"
            "&fields[builds]=version,processingState,uploadedDate,expired,"
            "usesNonExemptEncryption",
            tok,
        )
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read()[:300]!r}")
        return 1

    builds = data.get("data", [])
    if not builds:
        print("no builds visible for this app yet")
        return 1

    print(f"{'build':>6}  {'state':<12} {'uploaded':<21} expired")
    for b in builds:
        a = b["attributes"]
        print(
            f"{a['version']:>6}  {a['processingState']:<12} "
            f"{a.get('uploadedDate', '?'):<21} {a.get('expired')}"
        )

    newest = builds[0]["attributes"]
    state = newest["processingState"]
    print()
    if state == "VALID":
        print(f"build {newest['version']} is installable from TestFlight now")
    elif state == "PROCESSING":
        print(f"build {newest['version']} is still processing at Apple")
    else:
        print(f"build {newest['version']} is {state} - it will not appear to testers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
