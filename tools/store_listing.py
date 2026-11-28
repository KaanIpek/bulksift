"""BulkSift App Store listing, one place. `py -3 listing.py` prints lengths; `--write` drafts it to ASC."""
import re
import sys

NAME = "BulkSift: TCG Card Scanner"
SUBTITLE = "Sort bulk by price, hands-free"
KEYWORDS = "pokemon,value,collection,trading,binder,tracker,inventory,checker,collector,holo,worth,scan,sorter"
# Who this is written for changed on 2026-11-27: the box of OLD cards, not this year's bulk. In the price
# book a plain common or uncommon reaches a dollar in 74% of 1999-2002 cards, 56% of 2003-2010, 13% of
# 2011-2016 and 0.5% of 2023 on - so a current box has almost nothing to pull, and saying otherwise would
# sell the app to the people it disappoints. No percentages in the copy itself: prices move.
PROMO = ("Found a box of old cards? Pass them under your phone: a low tick means bulk, "
         "a bell means keep, a rising chime means pull it out. Prices refresh every day.")
DESCRIPTION = """Found a box of old cards? BulkSift scans them as fast as you can pass them under your phone, prices each one, and tells you by sound which are worth pulling out.

Prop the phone over the table. There is no shutter button and no waiting between cards: each one is recognised as it goes by, priced, and added to your list. A box that takes an evening to look up card by card takes a few minutes.

OLD BOXES ARE WHERE THE MONEY IS
A box of this year's commons has very little in it to find. A childhood binder, a collection you bought, a shop's back stock are different: in older sets even plain commons and uncommons are often worth real money, and the older the set, the more of them are. Over 25,000 English-language cards are built in, from the first sets of 1999 to current ones.

SORT BY EAR
Turn on Sort by value and set two price lines. Every card then lands in one of three piles, and each pile has its own sound:
- a low tick: bulk, keep it moving
- a bell: worth keeping
- a rising chime and a tap in your hand: pull this one out
You never have to look at the screen. The camera cannot tell a foil or a reverse holo from the plain printing, so each card is sorted as its most valuable printing: a holo is not waved through as bulk. The one exception is a 1st Edition stamp: those cards sound like their Unlimited twin and are marked in your list, so you can check them for a stamp afterwards. In an older box more cards clear the line, so set the pull line higher. Your total counts each card at its plain printing until you say otherwise.

RECOGNITION THAT RUNS ON YOUR PHONE
Cards are identified on the device itself. No photo is uploaded and nothing waits on a server, so scanning works with no signal at all: at a card show, in a basement, at the back of a shop.

PRICES YOU CAN CHECK
Every card carries US market prices, refreshed daily. A refresh also re-prices what you scanned last week, so a collection total is a number you can act on.

BUILT FOR PILES, NOT FOR SINGLES
- Every scan lands in a feed you can correct: delete a row, or swap it for the next-closest match in one tap
- Search the full catalogue and add anything by hand
- A want list, and a value history for your collection
- With Pro: several collections, so bulk, keepers and trade stock stay apart, and CSV export

WHAT IT COSTS
Scanning is free every day up to a daily limit, and a short video adds more. Pro removes the limit and adds extra collections and CSV export. Scan credits can also be bought once, with no subscription, and they never expire.

BulkSift is an independent app. It is not affiliated with, endorsed by, or sponsored by Nintendo, Creatures Inc., GAME FREAK inc., The Pokémon Company, or Wizards of the Coast. Card names and trademarks belong to their owners. Prices are estimates gathered from public sources and are not offers to buy or sell.

Terms of Use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://kaanipek.github.io/bulksift/privacy.html"""
REVIEW_NOTES = """BulkSift recognises trading cards through the camera and looks their prices up in data bundled with the app. No account is needed to use it.

TO TEST WITHOUT CARDS
Settings > Diagnostics > Run engine self-test replays bundled card frames through the recognition engine and shows the results. No camera or cards required.

CAMERA
The camera is used only to recognise a card in front of the lens. Frames are processed in memory and discarded. No image is stored and none is uploaded; recognition is entirely on-device, which is why the app works with no network.

NETWORK
The only routine download is a price file (about 0.3 MB) from https://kaanipek.github.io/bulksift/prices/ once a day. Card pictures shown in the collection are loaded on demand.

SORTING
Settings > Sorting > Sort by value. With it on, each scanned card plays one of three sounds (bulk, keep, pull) according to two price lines the user sets.

PURCHASES
Free scans refill daily. BulkSift Pro (monthly or yearly, auto-renewing) removes the limit, and three consumable packs add scan credits that never expire. A rewarded video also adds scans; the reward does not depend on the tracking choice. The paywall opens from Settings, or by itself when the free scans run out.

ACCOUNTS
Optional, and only for syncing a collection between devices. Sign in with Apple is offered alongside email. The account can be deleted from Settings > Account > Delete account, which removes the synced copy.

TRADEMARKS
BulkSift is not affiliated with or endorsed by Nintendo, Creatures Inc., GAME FREAK inc., The Pokémon Company, or Wizards of the Coast. Card names and numbers are used only to identify collectible cards."""

LIMITS = {'NAME': 30, 'SUBTITLE': 30, 'KEYWORDS': 100, 'PROMO': 170, 'DESCRIPTION': 4000, 'REVIEW_NOTES': 4000}
ok = True
for k, lim in LIMITS.items():
    n = len(globals()[k])
    print(f'{k:<13}{n:>5} / {lim}', '' if n <= lim else '  TOO LONG')
    ok &= n <= lim
taken = set(re.findall(r'[a-z]+', (NAME + ' ' + SUBTITLE).lower()))
dup = [w for w in KEYWORDS.split(',') if w in taken]
print('keywords repeating name/subtitle:', dup or 'none')
if not ok or dup:
    sys.exit(1)
if '--write' not in sys.argv:
    sys.exit(0)

sys.path.insert(0, r'D:\cowork\Duskhold\Tools')
import asc  # noqa: E402

INFO = '7dcd916f-fb4e-462d-a99b-35b68d667751'
VER = 'a07ef489-7e17-43cc-84ee-9e7ae3199fcd'
VLOC = '352a82c8-1d94-4df7-bd12-89379637d732'


def w(m, p, b):
    s, j = asc.call(m, p, b)
    print(m, p.split('?')[0], s, asc.errors(j) if s >= 300 else 'ok')
    return s, j


s, l = asc.call('GET', f'/appInfos/{INFO}/appInfoLocalizations')
lid = l['data'][0]['id']
w('PATCH', f'/appInfoLocalizations/{lid}', {'data': {'type': 'appInfoLocalizations', 'id': lid,
                                                    'attributes': {'name': NAME, 'subtitle': SUBTITLE}}})
w('PATCH', f'/appStoreVersionLocalizations/{VLOC}', {'data': {
    'type': 'appStoreVersionLocalizations', 'id': VLOC,
    'attributes': {'description': DESCRIPTION, 'keywords': KEYWORDS, 'promotionalText': PROMO}}})

# Review contact: the same person as the account's live app; copied field to field, never printed.
s, dv = asc.call('GET', '/apps/6806370481/appStoreVersions?limit=1')
s, src = asc.call('GET', f"/appStoreVersions/{dv['data'][0]['id']}/appStoreReviewDetail")
c = src['data']['attributes']
attrs = {'contactFirstName': c['contactFirstName'], 'contactLastName': c['contactLastName'],
         'contactPhone': c['contactPhone'], 'contactEmail': c['contactEmail'],
         'demoAccountRequired': False, 'notes': REVIEW_NOTES}
s, cur = asc.call('GET', f'/appStoreVersions/{VER}/appStoreReviewDetail')
if s == 200 and cur.get('data'):
    rid = cur['data']['id']
    w('PATCH', f'/appStoreReviewDetails/{rid}', {'data': {'type': 'appStoreReviewDetails', 'id': rid, 'attributes': attrs}})
else:
    w('POST', '/appStoreReviewDetails', {'data': {
        'type': 'appStoreReviewDetails', 'attributes': attrs,
        'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': VER}}}}})

# Read back what is stored, not what was sent.
s, l = asc.call('GET', f'/appInfos/{INFO}/appInfoLocalizations')
a = l['data'][0]['attributes']
print('stored name:', a['name'], '| subtitle:', a['subtitle'], '| privacy:', a['privacyPolicyUrl'])
s, v = asc.call('GET', f'/appStoreVersionLocalizations/{VLOC}')
a = v['data']['attributes']
print('stored description == draft:', a['description'] == DESCRIPTION, '| keywords:', a['keywords'],
      '| promo == draft:', a['promotionalText'] == PROMO, '| support:', a['supportUrl'])
s, r = asc.call('GET', f'/appStoreVersions/{VER}/appStoreReviewDetail')
a = r['data']['attributes']
print('review notes == draft:', a['notes'] == REVIEW_NOTES, '| contact fields set:',
      all(a.get(k) for k in ('contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail')))
