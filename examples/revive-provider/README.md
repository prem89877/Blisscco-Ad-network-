# Revive JSON test fixture (manual testing only)

`ad.json` is a **static test fixture**. Please read this before using it.

- It is **not a real Revive-generated ad**. No Revive server produced it.
- It is **not a Revive API endpoint**. It is a plain file with fixed placeholder values.
- It is **not production advertiser content**. The text is a demonstration, and the destination is the reserved `example.com` domain.

## What it shows

The JSON shape that Blisscco's existing Revive contract reads. Only these four fields are used:

| Field | Required | Rule |
| --- | --- | --- |
| `headline` | yes | plain text, max 90 characters, no `<` or `>` |
| `body` | yes | plain text, max 300 characters, no `<` or `>` |
| `cta_text` | no | plain text, max 30 characters, or `null` / omitted |
| `destination_url` | yes | `https` only, no credentials in the URL |

Anything else in a provider response is ignored. HTML, script or markup fields reject the whole creative.

## Opt-in only

Nothing in Blisscco reads this file. The adapter, fallback routing and the match route never import it, and no fallback is wired to it. It does nothing unless you choose to use it by hand.

To try it manually in a **test environment only**:

1. Serve the file yourself over HTTPS with `Content-Type: application/json`.
2. Point the existing server-only Revive settings at that test URL yourself.
3. Remove the settings and the test host when you are done.

Do not put real credentials, tracking parameters or a production URL in this file. `tests/ads/day23-part2-revive-fixture.test.ts` checks the fixture against the contract.
