# 08 — Tool / Connector Runtime Audit

Read-only audit of `lib/integrations/**`, `lib/documents/**`, `lib/sales/candidateSource.ts`, `lib/ai/provider.ts`, and `package.json`.

## 8.1 Gmail connector — REAL, narrow

`lib/integrations/googleGmailConnector.ts` makes real authenticated HTTPS calls to `gmail.googleapis.com/gmail/v1/users/me`, using real OAuth2 access tokens and composing valid RFC 2822/base64url MIME messages.

| Action | Support | Evidence |
|---|---|---|
| Create (draft) | ✅ Real | `createDraft()` → POST `/drafts` |
| Send | ✅ Real | `send()` → POST `/messages/send` — will actually deliver email with a real token |
| Read | ❌ Not implemented | Despite requesting `gmail.readonly` scope, no code path calls `messages.get`/`threads.get`/`list` anywhere |
| Update/Delete | ❌ Not implemented | — |

**Gating**: `getEmailConnector()` returns the real connector only if a tenant/user context is present, `GOOGLE_OAUTH_CLIENT_ID` is set, *and* the user has a `connected` `integration_connections` row — otherwise it silently falls back to `SimulatedEmailConnector` (deterministic fake IDs, zero network calls). This sandbox has no live Google credentials, so the simulated path is what actually runs today.

## 8.2 Google Calendar connector — REAL for event creation, simulated for slot proposal

`lib/integrations/googleCalendarConnector.ts` hits the real `googleapis.com/calendar/v3` API.

| Action | Support | Evidence |
|---|---|---|
| Read (free/busy) | ✅ Real | `createEvent()` first POSTs `/freeBusy` as a genuine safety gate |
| Create | ✅ Real | POST `/calendars/primary/events`, returns real eventId + Meet link |
| proposeSlots() | ❌ Simulated (by design) | Delegates directly to the deterministic business-hours heuristic — the interface predates async |
| Update/Delete/List | ❌ Not implemented | No such methods exist on the `CalendarConnector` interface |

Same gating pattern and fallback as Gmail. `meetingScheduling.ts` calls `getCalendarConnector()` with no context at all for slot proposal, guaranteeing the simulated path there regardless of connection status.

**Shared OAuth/security infrastructure (both connectors) is genuinely real, non-trivial engineering**: PKCE + Authorization Code flow against Google's actual endpoints, single-use server-side CSRF state, transparent token refresh with a `needs_reauth` fallback, and AES-256-GCM at-rest token encryption.

## 8.3 Document generation — REAL, stored as Postgres bytea

`pdfkit` (real dependency) generates actual PDF bytes; `pptxgenjs` generates real multi-slide .pptx buffers. Tests assert on real `%PDF-`/`PK` magic bytes. Storage is **not** Supabase Storage and **not** the filesystem — bytes are hex-encoded and stored directly in `generated_files.file_data bytea`, with a SHA-256 checksum and a CLIENT_VISIBLE/INTERNAL classification. A `storage_path` column exists only as a placeholder for a future object-store migration and is never dereferenced today.

## 8.4 Everything else: Implemented / Mock / Not Implemented

| Tool | Status | Evidence |
|---|---|---|
| Web Search / SERP / directory | **NotImplemented (explicit stub)** | `lib/sales/candidateSource.ts` doc comment: "No real web search / SERP / directory API is wired in... a documented Phase 4 follow-up." Only `ManualCandidateSource` and 3 hardcoded fixture companies exist. |
| Browser automation | **NotImplemented** | No Puppeteer/Playwright dependency or reference anywhere. |
| Slack / Microsoft Teams | **NotImplemented, explicitly out of scope** | README: "remain explicitly out of scope (per the product brief itself)." |
| LINE | **No reference found** | — |
| CRM (Salesforce/HubSpot) | **NotImplemented** | The app *is* the CRM (own leads/opportunities/proposals schema). |
| Google Analytics (GA4) | **Mock/Simulated** | KPIs with no connector are entered via `POST /api/kpis/[id]/manual-value`, tagged `source: "manual"`. No GA4 client anywhere. |
| Google Search Console | **No reference found** | — |
| Google/Meta Ads | **No reference found** (only a KPI category label "Ads(7d)") | — |
| Semrush / SEO tools | **No reference found** | — |
| WordPress | **No reference found** | — |
| Image generation API | **No reference found** | — |
| Video generation API | **No reference found** | — |
| Instagram/Threads/Meta Graph (real posting) | **NotImplemented** | The only hits are the internal `/webops` UI simulation layer — no Meta Graph API client, token flow, or fetch to `graph.facebook.com` anywhere. |

## 8.5 LLM provider — confirmed: TemplateProvider is the only implementation

Exactly one class in the repo implements `AIProvider`: `TemplateProvider` (`lib/ai/provider.ts`). `getProviderForAgent()` unconditionally returns the single shared instance regardless of the agent argument (parameter even prefixed `_` to signal it's unused) — there is no branch for any real model provider. `package.json` has no `openai`/`@anthropic-ai/sdk`/`@google/generative-ai`/LangChain-model dependency. The one incidental "openai" string in the repo is an uninstalled optional peer-dependency of a tracing exporter inside `package-lock.json` — not imported anywhere in source. `TemplateProvider.generate()` dispatches on task type to deterministic template/rule functions using a seeded FNV-style hash for reproducible pseudo-randomness — zero network calls.

## 8.6 Overall assessment

Of everything a real "AI employee" would need to actually *do* autonomous work, this codebase splits into three tiers:

- **Genuinely real and network-capable (~10-15% of the full toolkit)**: Gmail (draft+send only), Google Calendar (freebusy+create only), and PDF/PPTX generation — behind well-engineered OAuth/token-security infrastructure, though never run against live Google credentials in this sandbox.
- **Present but deliberately simulated/deterministic**: the entire "intelligence" layer (TemplateProvider), lead/candidate discovery (hand-entered or 3 fixtures), calendar slot proposals, and all KPI/analytics ingestion (manual entry only).
- **Entirely absent, often with an explicit "out of scope" note in the README**: web search, browser automation, Slack/Teams/LINE, any real CRM platform, ads/analytics APIs, SEO tooling, WordPress, image/video generation, and real social posting.

The codebase is unusually candid about every one of these gaps — each is documented as a known limitation rather than silently glossed over.
