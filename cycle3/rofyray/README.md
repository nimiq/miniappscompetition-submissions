# CediNest

> Save in dollars. See it in cedis.

<img src="icon.png" alt="App icon" width="128">

| Field | Value |
| --- | --- |
| Category | Earn |
| Pricing | Free |
| Team name | LynxSphynx Co. |
| Team members | _Not provided — optional_ |
| X account | rofyray |
| Heard about it via | X |
| Contact email | rofyone@gmail.com |
| GitHub login | @rofyray |
| Submitted at | 2026-11-10T09:03:15.627Z |

## Links

| Link | URL |
| --- | --- |
| Repo | [https://github.com/rofyray/cedinest](<https://github.com/rofyray/cedinest>) |
| Demo | [https://cedinest.vercel.app](<https://cedinest.vercel.app>) |
| Video | [https://youtu.be/yc5u1duo5Mo](<https://youtu.be/yc5u1duo5Mo>) |
| Skool post | [https://www.skool.com/miniappscompetition/cedinest-is-live-save-in-dollars-see-it-in-cedis?p=017c9537](<https://www.skool.com/miniappscompetition/cedinest-is-live-save-in-dollars-see-it-in-cedis?p=017c9537>) |
| Social post | [https://x.com/rofyray/status/2120078940127846504?a=SPPSzO92DXdUG1t-Ki4&s=20](<https://x.com/rofyray/status/2120078940127846504?a=SPPSzO92DXdUG1t-Ki4&s=20>) |

## Description

Your USDT earns a variable rate in Aave on Polygon while CediNest shows every balance, goal and gain in Ghana cedis. Stamp a saving whenever you can, pay a tiny NIM fee instead of gas, and watch your monthly stamp card fill up like a susu card.

## Builder story

In Ghana, the cedi has lost roughly a third of its value against the dollar in some recent years, so saving in cedis means watching your money shrink. People who can save in dollars do, but the tools are either banks with high minimums or crypto apps that assume you hold gas tokens and read everything in USD.

CediNest is the susu card I wished existed. You keep USDT in your own Nimiq Pay wallet, put it to work in Aave on Polygon, and the app shows every balance, goal, and gain in cedis, the unit people actually plan in. The stamp card comes straight from the paper cards susu collectors use: one stamp per saving, a full card at the end of the month.

The technical knot was gas. Nimiq Pay users hold NIM and USDT, not POL, so CediNest charges a tiny NIM fee and a relayer pays the Polygon gas, using an EIP-2612 permit so the money only ever moves between the user's wallet and their own Aave position. The relay contract is about 70 lines, holds nothing, and cannot take funds.

## Thumbnail

![Thumbnail](thumbnail.png)

## Screenshots

![Screenshot 2](screenshot-2.png)

![Screenshot 3](screenshot-3.png)

![Screenshot 4](screenshot-4.png)

![Screenshot 5](screenshot-5.png)

---

_Generated from the submission form. `submission.yaml` in this folder is the machine-readable source of truth._
