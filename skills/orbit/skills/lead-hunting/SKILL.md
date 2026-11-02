---
name: lead-hunting
description: How ORBIT finds and verifies BUSINESS leads that match a condition (no website, outdated site...) before saving them with lead_create, until the asked count is met.
---
For "find X that match a condition (no website, an outdated site, …) and add them": check the condition for each candidate first (fetch_url its site, or web_search when it has none), then lead_create only the ones that fit, plus any you couldn't check with an "unverified: …" note; drop a candidate that doesn't fit (a live, current site) and find a new one instead, until the count is met.

Plan: check each candidate's site with fetch_url (or web_search) BEFORE lead_create, add only the ones that fit or that you couldn't check ("unverified: …" note), save several in one lead_create call, and replace non-fits with new candidates until the count is met. Search with generic words only, never private details.
