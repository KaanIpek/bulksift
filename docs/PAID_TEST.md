# A paid test: what it needs, and what the numbers say before spending anything

Written 2026-11-24. Nothing here has been run. No ad account exists, no money
has been spent, and the offer the test would use is not switched on.

The short version: **at the published medians, buying installs for this app
loses money under either offer.** The tighter offer turns a certain loss into
roughly break-even after a year. A small test is therefore not "will ads work"
but "is this app far enough above the median to be worth a larger one" - and
there is one number that answers it, given at the end.

---

## The arithmetic

Benchmarks, with where each came from. None is specific to US + iOS + this
niche + Meta; that combination is not published anywhere that could be found.

| Figure | Value | Source |
|---|---|---|
| Cost per install, US iOS, all ad networks | $4.60 | Singular quarterly report, Q1 2026 data |
| Cost per paying subscriber on Meta, subscription apps, 45 countries | $43 - $82 | Adapty Meta Ads benchmarks, Q3 2026 |
| Install -> paid by day 35, hard paywall | 10.7% median | RevenueCat State of Subscription Apps 2026 |
| Install -> paid by day 35, freemium | 2.1% median | same |
| Install -> paid, North America, all models | 2.6 - 2.8% | same |
| Install -> trial, North America | 7.1% median, top quarter over 15% | same |
| Trial -> paid, North America | 34.2% | same |
| Revenue per install by day 60: hard paywall / freemium | $3.09 / $0.38 | same |
| Weekly plan with trial, revenue per subscriber after ~a year | about $49 - $54 | Adapty, two figures in one article; low confidence |
| Weekly plan, first renewal after a trial | 55 - 59% | RevenueCat 2026 (NA), Adapty |
| Weekly price, North America median | $6.99 (range $4.99 - $6.89 by category) | RevenueCat 2026 |
| What Apple keeps | 15% in the Small Business Program, 30% outside it | Apple |

The Small Business Program is **not automatic**: it has to be applied for, and
until it is approved Apple keeps 30%. Everything below assumes 85% is kept.

**The launch offer** (30 free scans a day, $4.99 a month or $29.99 a year):

- An install costs $4.60 and about 2.6% of installs pay, so a paying customer
  costs about **$177**.
- A yearly subscriber is worth $25.49 after Apple. A monthly one is worth $4.24
  a month, $51 if they stay a full year, which most do not.
- By day 60 a freemium install has earned $0.38 against $4.60 spent.
- Every customer bought this way loses over $120. This is not close.

**The tight offer** (`tight` in `apps/mobile/src/offer.ts`: 10 free scans a
day, the paywall introduced on first launch, a weekly plan with a free trial if
one is created):

- If it behaved like a median hard paywall, 10.7% of installs would pay and a
  customer would cost about **$43** - which matches the bottom of what Adapty
  measured on Meta directly.
- A weekly subscriber who started on a trial is worth roughly $42 - $46 after
  Apple over a year, most of it from a minority who stay: the median one pays
  twice.
- So: about break-even, a year later, at the median. By day 60 a hard-paywall
  install has earned $3.09 against $4.60 - two thirds of the money back.
- It is **not** a hard paywall. Ten free scans a day is still a free tier, so
  the honest expectation sits between the two cases, nearer this one.

## What a small test can and cannot measure

$500 at $4.60 buys about 109 installs. At the North American medians that is
8 trials and 3 paying customers. Three out of 109 is consistent with a true
rate anywhere from about 1% to 8%, which is the whole range between "certain
loss" and "works". **A test this size cannot measure the paying rate.**

What it can measure, to within about a fifth either way: the cost of an
install, and the cost of a started trial. The second is the one to decide on.

> **The line: a started trial has to cost under about $14.**
> A customer is worth ~$42 after Apple and 34% of trials become customers,
> so a trial is worth 42 x 0.342 = $14.40. At a $4.60 install that needs one
> install in three to start a trial - twice the top-quarter mark of 15%. At a
> $2.00 install it needs 14%.

That is a high bar, and the benchmarks say most apps do not clear it. It is the
bar because below it every further dollar buys a loss. If the test lands at $30
a trial, the answer is to stop, not to optimise.

## What has to exist before a test can run

In the app (done 2026-11-24, in the build after 138):

- The paywall states each plan's price and period, lets the buyer choose, says
  it renews, and links the terms and the privacy policy. Before this it had one
  unpriced button, which App Review rejects under guideline 3.1.2.
- Both offers are in the binary. `docs/offer.json` on the Pages site says which
  is live; it currently says `launch`. Changing that one word to `tight` and
  pushing switches every install the next time it comes to the front - no
  build, no review. Changing it back is the same edit.
- The plan list comes from the store. A weekly plan appears on the paywall the
  moment one exists in the RevenueCat offering; no code change is needed.

Not done, and each one is the owner's to decide or to do:

1. **Whether to run it at all, and the budget.**
2. **Switching the live offer to `tight`.** It reduces what every existing
   free user gets.
3. **A weekly product**: App Store Connect product, price, trial length, and
   the RevenueCat package. `docs/SETUP.md` records that a weekly plan was left
   out on purpose in August because rivals' reviews complain about theirs. The
   benchmarks above are the other side of that argument. A product identifier
   can never be reused once created, so this is not a draft to make casually.
4. **The Small Business Program application**, if it has not been made.
5. **How installs are measured.** Two ways, and they are not equivalent:
   - *No Meta SDK.* A campaign can run, but Meta's own documentation says it
     then optimises for link clicks, not installs, and calls that a fallback.
     Installs are read from Apple campaign links in App Store Connect (a metric
     shows once it reaches 5, a day later) and trials from RevenueCat. Nothing
     to build; the traffic is worse and Meta learns nothing.
   - *Meta SDK in the app* (`react-native-fbsdk-next`, which has an Expo
     plugin). Needed for install optimisation and for Meta's aggregated
     measurement. It requires a Meta developer app, a Facebook Page and a
     verified business portfolio; it adds "Device ID - used to track you" to
     the App Privacy label; and RevenueCat's Meta integration needs it too
     (`collectDeviceIdentifiers`, `setFBAnonymousID`, automatic purchase
     logging turned off in the SDK so purchases are not counted twice).
     One build's work once the Meta app id exists.

Meta's learning phase wants about 50 results a week per ad set. At $20 a trial
that is $1,000 a week, so a $500 test cannot optimise for trials at all; it has
to optimise for installs (50 a week is about $230) and read trials afterwards.

## Not verified

- Any cost-per-install figure for Meta + US + iOS + this category.
- Whether Meta requires the app to be live on the App Store before a campaign
  can be created.
- Whether a trial event sent by RevenueCat's server integration is accepted for
  Meta's event optimisation when the install came from the SDK; Meta's page and
  a RevenueCat staff answer disagree.
- The weekly-plan revenue figure, which carries the whole break-even claim.
  It is one vendor's number and their own pages do not agree with each other.
