# Map Rank Times Info

Explanation of how I calculate rank times, split into 2 parts.

<h3 style="font-weight: normal">First to clarify some terms I use:</h3>

- **7 days in qualified rule** - mapsets must be qualified for at least 7 days in total
- **daily rank limit** - maximum amount of mapsets that can be ranked in a 24h period
- **queue date** - the calculated rank date without adjusting for the daily rank limit (only using the 7 days in qualified rule)
- **rank date** - the correct rank date adjusted for daily rank limit (does not include the random ~1 to ~10 min delay that is added by osu server)

## **Part 1** - Get the queue date

For each mapset in qualified mapsets:

1. Add up the total duration the mapset has been qualified for (include previous qualified durations for disqualified mapsets)  
   [Code link](https://github.com/ssz7-ch2/mapranktimes-back/blob/main/beatmap.js#L48-L51)
2. Then subtract that from 7 days to get the remaining time left
   [Code link](https://github.com/ssz7-ch2/mapranktimes-back/blob/main/beatmap.js#L56)
3. Disqualified mapsets have to be requalified for at least 1 day before being ranked, so take the larger number of the two -> `max(1 day, remaining time left)`
   [Code link](https://github.com/ssz7-ch2/mapranktimes-back/blob/main/beatmap.js#L60)

## **Part 2** - Adjust for the daily rank limit (currently 12 mapsets per day)

For each mapset in qualified mapsets:

1. Calculate the earliest date the mapset can be ranked without going over daily rank limit, which is the mapset ranked 12 mapsets ago + 1 day
   [Code link](https://github.com/ssz7-ch2/mapranktimes-back/blob/main/osuHelpers.js#L17)
2. Compare this date with the queue date and pick whichever is later
   [Code link](https://github.com/ssz7-ch2/mapranktimes-back/blob/main/osuHelpers.js#L24)

### Visual explanation of what the code does:

#### Clarifications:

- `Ranked #1` is the 12th newest ranked mapset
- `Ranked #12` is the newest ranked mapset
- `Qualified #1` is the mapset that will be ranked next

Loop through qualified mapsets and choose the later date:

| Rank Dates               | =   | Qualified Queue Dates     |     | Rank Limit Date                 |
| ------------------------ | --- | ------------------------- | --- | ------------------------------- |
| `Qualified #1 rank date` | =   | `Qualified #1 queue date` | vs  | `Ranked #1 ranked date + 1 day` |
| `Qualified #2 rank date` | =   | `Qualified #2 queue date` | vs  | `Ranked #2 ranked date + 1 day` |

| ...
| `Qualified #12 rank date` | = | `Qualified #12 queue date` | vs | `Ranked #12 ranked date + 1 day` |
| `Qualified #13 rank date` | = | `Qualified #13 queue date` | vs | `Qualified #1 rank date + 1 day 20 min` |
| `Qualified #14 rank date` | = | `Qualified #14 queue date` | vs | `Qualified #2 rank date + 1 day 20 min` |
| ...

It's a bit complicated but adding `1 day 20 min` instead of `1 day` makes things more accurate

<br />

---

# **More complicated stuff** - <sub><sup>Rank delay, why some mapsets get ranked early, and calculating probability</sup></sub>

### How the ranking system works

Every 20 min (`XX:00`, `XX:20`, `XX:40`), the server runs a function to rank maps.  
If the `current date > mapset's rank date`, then the mapset will be ranked.

## How random delay works

Every ranking interval, there is a random delay of 10 seconds to 8 minutes\* before the ranking function actually runs for standard mapsets.
And when the interval runs, both 7 days in qualified rule and daily rank limit must be upheld (so basically the rank date that is calculated in previous section).  
If either one is false, then the mapset will be ranked on the next interval instead. If both are true, then the mapset will be ranked after another random delay of 5 seconds to 2 minutes (adding up to a total max of 10 minutes\*\* of delay)

\*Techincally up to 20 minutes and \*\*technically up to 24 minutes, but that's never going to happen. Explained further down ↓

## Why some mapsets get ranked early

Because of random delay, it is possible the ranking function to run soon after the rank date instead of 20 minutes later like usual.  
e.g. Let's say a mapset has a rank date at `15:25:30`. At interval `15:20:00`, suppose there is a random delay of `3:47` added. Which means the ranking function runs at `15:23:47`. Since `15:23:47 < 15:25:30`, the mapset can't be ranked and has to wait till the next interval `15:40:00` to be ranked.  
But if the rank date was at `15:22:39` instead, then the mapset will be ranked as `15:23:47 > 15:22:39`.

Essentially, the later the rank date is from an interval, the less likely it is for the mapset to be ranked early.  
e.g. A rank date of `15:20:31` is much more likely to be ranked early compared to a rank date of `15:26:40`.

Anything past 10 minutes after an interval is highly unlikely to be ranked early, as this requires there to be a mapset in another gamemode to be ranked at the same interval. Read below ↓

How it's written in server code:

- For every gamemode, there is a random delay of 5 seconds to 2 minutes added (the order is shuffled every interval).
- And for every mapset in that gamemode (up to 2 per interval), there is another random delay of 5 sec to 2 min added.
- Which means it can go up to 24 minutes `(2 min + 2 mapsets * 2 min) * 4 modes = 24 min` before the last mapset gets ranked, but this requires 2 mapsets in every gamemode to be queued at the same ranking interval...

As to why `1 day 20 min` is used, the probability of a mapset being ranked early is lower, so using `1 day 20 min` instead of `1 day` is more accurate.

## Calculating the probability

<sup><i>May not be 100% accurate as I'm not good at probability but the calculations seem to match both real and simulated data</i></sup>

\*Does not account for scenarios where there are mapsets in other modes being ranked at the same interval

<h3 style="font-weight: normal">Probability that sum of rank delays is greater than <code>x</code> seconds - <a href="https://github.com/ssz7-ch2/mapranktimes-back/blob/main/utils/probability.js#L7-L37">Code link</a></h3>

- Because of shuffle, there is a 25% chance for each of the positions.
- For each position, calculate the probability that the sum of the random delays is greater than `x` seconds
  - The number of random delays depends on the position (1st = 1 delay, 2nd = 2 delays, etc.)
  - Since each random delay is a uniform distribution, use the Irwin-Hall distribution (uniform sum distribution) to calculate this. Probability of the sum being greater than `x` is 1 - CDF of the distribution.
- Sum up the probability for each position and divide by 4 to get final probability.

---

# How it used to work - Before random delay

##### _May not be very accurate, this is mostly from observations I made a few years ago_

## For mapsets ranked using 7 days in qualified rule

<sup>when `Qualified #X queue date > Ranked #X ranked date + 1 day`</sup>

Very straightforward, if current date is > mapset's qualified date + 7 days, then rank the mapset.

## For mapsets ranked using daily rank limit

<sup>when `Qualified #X queue date < Ranked #X ranked date + 1 day`</sup>

### Some context:

- This was during a few month period between `2019/05/27` and `2019/09/08` (when random delay was added)
- The daily rank limit was **8** during this time.

As explained, the ranking function runs on 20 min intervals, but it isn't exactly perfect to the second, so mapsets either got ranked at `XX:X0:01` or `XX:X0:02`. But this is where the problem occurs.

Let's say a map gets ranked at `15:20:02`, then the 8th map after it must be ranked after `15:20:02` on the next day. In other words, the 8th map will be ranked at `15:40:01` or `15:40:02` on the next day.  
But if the map gets ranked at `15:20:01`, then it is possible for the 8th map after it to be ranked at `15:20:02` on the next day, 20 minutes earlier than normal.

Some actual examples here in this [google sheet](https://docs.google.com/spreadsheets/d/1pZHOsVa2eyY10a5HlDhLPqKBOaHuNXz00abiVA7Ygx4/edit#gid=739515871)
