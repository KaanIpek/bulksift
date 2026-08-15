# App Store listing — BulkSift

Everything App Store Connect asks for, written out. Nothing here can be filled in
from this repo: the fields live in a web form behind an Apple ID, so this is the
copy to paste, not a script that submits it.

---

## Name (30 characters max)

```
BulkSift
```

## Subtitle (30 characters max)

```
Scan bulk cards, see values
```

Chosen over "Pokémon card scanner": the app is not affiliated with the rights
holders, and putting their mark in the subtitle invites both a rejection and a
takedown. The subtitle is also the second-most-read line on the product page, so
it is spent on what the app *does*.

## Promotional text (170 characters, changeable without review)

```
Point your phone at a stack and let it work. Every card is recognised on the
device - no account, no upload, no waiting on a server - with current US market
prices attached.
```

## Description

```
BulkSift turns a pile of trading cards into a priced list.

Prop your phone over the table, pass cards under it, and each one is recognised
as it goes by. There is no shutter button and no waiting between cards. A bulk
box that takes an evening to enter by hand takes a few minutes.

RECOGNITION THAT RUNS ON YOUR PHONE
Every card is identified on the device itself. Nothing is uploaded, nothing is
queued on a server, and it works with the wifi off - at a card show, in a
basement, on a table at the back of a shop. 20,444 cards ship inside the app.

PRICES YOU CAN CHECK
Every card carries current US market prices, refreshed on demand. Refreshing
also re-prices the cards you scanned last week, so a collection total is a
number you can act on rather than a snapshot of whenever each card was added.

BUILT FOR PILES, NOT FOR SINGLES
- Several collections, so bulk, keepers and trade stock stay apart
- Every scan lands in a feed you can correct: delete a row, or swap it for the
  next-closest match in one tap
- Search the full catalogue and add anything by hand
- A want list, and a value history for the whole collection

WHAT IT COSTS
Scanning is free every day, and watching a short video adds more scans. Pro
removes the limit entirely and unlocks CSV export. Scan credits can also be
bought outright, with no subscription.

BulkSift is not affiliated with, endorsed by, or sponsored by Nintendo,
Creatures Inc., GAME FREAK inc., The Pokémon Company, or Wizards of the Coast.
All card names, images and trademarks are the property of their respective
owners. Prices are estimates gathered from public sources and are not offers to
buy or sell.
```

## Keywords (100 characters, comma-separated, never seen by the user)

```
tcg,card scanner,collection,inventory,price,bulk,trading card,binder,checklist,value,tracker,sorter
```

100 characters exactly. Do not repeat words already in the name or subtitle -
Apple indexes those anyway, and a repeat wastes a slot.

## Support URL / Marketing URL

Required. A single static page is enough; App Review rejects a placeholder or a
404. Needs a contact route on it.

## Age rating

4+. No user-generated content, no chat, no gambling, no purchases of physical
goods. The rewarded video is an ad, which the questionnaire asks about
separately - answer yes to "third-party advertising".

---

## Privacy — App Privacy questionnaire

Answer honestly and narrowly. The app is unusual in how little it takes, which
is worth stating plainly rather than hedging.

| Data type | Collected | Linked to user | Tracking | Why |
|---|---|---|---|---|
| Photos or video (camera) | No | - | - | Frames are recognised in memory and discarded. Nothing is written or sent. |
| Email address | Yes, optional | Yes | No | Only if the user makes an account to sync collections. |
| User content (collection) | Yes, optional | Yes | No | Only with an account, to sync between devices. |
| Purchases | Yes | Yes | No | Handled by RevenueCat for subscription state. |
| Identifiers (IDFA) | Yes | No | **Yes** | The rewarded ad SDK. This one makes App Tracking Transparency mandatory. |
| Diagnostics | No | - | - | No analytics or crash SDK is linked. |

The camera row is the one people get wrong. Answer **No** for photo collection:
the frames never leave the buffer. Say so in the review notes too.

### App Tracking Transparency

Required because of the ad SDK, not because of anything the app does with the
camera. The prompt must appear before any ad request, and the purpose string
should be honest about the exchange:

```
Allow tracking so the free scan videos can show relevant ads. Declining does not
reduce the scans you earn - the ads are just less relevant.
```

That is true, and it has to stay true: rewards must not depend on the answer.

---

## Review notes

App Review has to be able to test a camera app without a card, and cannot be
expected to own one.

```
BulkSift recognises trading cards through the camera and looks their prices up
in data bundled with the app. No account is needed to use it.

TO TEST WITHOUT CARDS
Settings > Diagnostics > Run self-test replays bundled card frames through the
recognition engine and shows the results. No camera or cards required.

CAMERA
The camera is used only to recognise a card in front of the lens. Frames are
processed in memory and discarded. No image is stored, and none is uploaded -
recognition is entirely on-device, which is why the app works with no network.

ACCOUNTS
Optional, and only for syncing a collection between devices. Sign in with Apple
is offered alongside email. The account can be deleted from Settings > Account >
Delete account, which removes the synced copy.

TRADEMARKS
BulkSift is not affiliated with or endorsed by Nintendo, Creatures Inc.,
GAME FREAK inc., The Pokémon Company, or Wizards of the Coast. Card names and
numbers are used to identify collectible cards, and card images are shown for
identification within the user's own collection.
```

---

## Screenshots

Required: 6.9" (1320 x 2868) and 6.5" (1242 x 2688). Everything else is
inherited by App Store Connect.

Six frames, in this order. The first two are what most people ever see.

1. **Scanning, mid-pile** — the card under the reticle, the feed filling
   underneath. Caption: *Pass the pile under your phone.*
2. **A collection with a total** — real cards, a real number. Caption:
   *Every card priced, on the device.*
3. **The scan feed being corrected** — a row mid-swap to its runner-up.
   Caption: *Wrong call? One tap to fix it.*
4. **Card detail** — art, set, variants, price history. Caption:
   *Variants and market prices for each.*
5. **Several collections** — bulk, keepers, trade. Caption:
   *Keep bulk and keepers apart.*
6. **Offline** — the same scan with airplane mode on in the status bar.
   Caption: *Works with no signal at all.*

Number 6 is the one competitors cannot copy, so it is worth a slot even though
"works offline" sounds like a footnote.

---

## Not written here

The two things that still block submission, both of which need an account this
repo cannot open:

- **Products in App Store Connect** - `com.rldgames.bulksift.credits.200`,
  `.1000`, `.5000`, and an auto-renewing subscription carrying the `pro`
  entitlement, then the same identifiers in RevenueCat.
- **An AdMob app and rewarded unit.** Until one exists the app ships Google's
  test unit, which must not go to review: it serves test ads, and shipping it is
  against AdMob's terms.
