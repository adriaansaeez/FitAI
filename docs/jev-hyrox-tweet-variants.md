# Jev × HYROX — commercial tweet variants

These versions adopt the direct, product-demo style: a provocative hook, a visible input → decision flow, concrete operating metrics, and an “imagine” payoff. Each draft is under X's 280-character limit **including** the `>` characters.

**Measured 2026-09-22:** 20 successful real calls to `jev-1.13.0` through the app's end-to-end decision route gave **582 ms median latency** (p95: 937 ms). A separate 20-call metered request with the same running state and four typed decisions averaged 1,086 input tokens; at the published $0.042/M input-token rate, that is **$0.000046 per decision**. Output tokens are free.

## 1. Recommended — strongest product-demo framing

```text
Jev is wild 🫣

I’m testing Jev for HYROX running.

> I run
> Jev sees pace, HR trend, RPE, gradient
> decides: push, hold, ease off, recover

cost: ~$0.000046/decision
speed: ~582ms/decision

It’s not about chasing a number. It’s about knowing what to do next.
```

**Characters:** 261

## 2. Watch → decision hook

```text
Your watch shows a number.

Jev can help turn it into a decision.

For my HYROX prep:
> pace vs. target
> HR trend
> RPE + gradient
> signal quality

output: push, hold, ease off, recover, or wait.

cost: ~$0.000046/decision
latency: ~582ms

That’s a new kind of training partner.
```

**Characters:** 280

## 3. Closest to the reference structure

```text
I built a Jev × running experiment for HYROX.

> watch sends context
> Jev reads pace, HR trend, RPE & terrain
> safety rules set the limits
> I get a clear next move

cost: ~$0.000046/decision
speed: ~582ms/decision

Imagine knowing when to push before the next station.
```

**Characters:** 271

## 4. Problem-first

```text
HYROX running isn’t just pace.

A slow split can mean a hill, fatigue, bad data—or nothing.

So I’m testing Jev:
> inputs: pace, HR trend, RPE, gradient
> output: push, hold, ease off, recover

cost: ~$0.000046/decision
latency: ~582ms

Context is the product.
```

**Characters:** 260

## 5. Aspirational / shareable

```text
What if your run could explain itself?

I’m using Jev in a HYROX running experiment:
> pace vs. target
> HR trend
> RPE
> terrain + data quality

Then it turns that context into a simple call: push, hold, ease off, or recover.

cost: ~$0.000046/decision | ~582ms
```

**Characters:** 262

## Publishing recommendation

Post **variant 1** with a 10–15 second screen recording: show the running inputs, the safety status, then the resulting action. The posted cost is an estimate from this measured request shape; it will vary if the state or decision questions grow.

Keep the claim bounded: Jev interprets training context within safety rules. It does not diagnose, prevent injury, or replace a coach or clinician.

## Thread reply — how the decision is made

Use this as the second tweet, attached to the screenshot. It explains the decision loop without repeating the first post's commercial pitch.

```text
How Jev makes the call:

> code smooths pace + HR
> safety blocks symptoms, stale data & bad signal
> Jev weighs pace vs target, HR drift, RPE & gradient
> confidence constrains answer

Output: push, hold, ease off, recover—or wait.

No free-text advice. No single-metric guess.
```

**Characters:** 278
