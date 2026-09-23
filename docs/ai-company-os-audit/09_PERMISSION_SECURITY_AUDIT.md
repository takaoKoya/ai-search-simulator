# 09 — Permission / Authority / Security / Multi-Tenant Audit

Read-only security review. No exploit attempted; pure code/schema review.

## 9.1 RLS helper functions

```sql
create function public.is_tenant_member(target_tenant uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.memberships m
      where m.tenant_id = target_tenant and m.user_id = auth.uid());
$$;

create function public.has_tenant_role(target_tenant uuid, allowed_roles text[]) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.memberships m
      where m.tenant_id = target_tenant and m.user_id = auth.uid()
        and m.role = any(allowed_roles));
$$;
```

`is_tenant_member` is the universal "may this caller touch this tenant's data at all" gate; `has_tenant_role` adds a role filter for destructive/administrative operations. Both are `security definer`, letting them read `memberships` regardless of the caller's own row-visibility without exposing `memberships` directly.

## 9.2 RLS spot-check

Every table is stamped from the same generic pattern: SELECT/INSERT/UPDATE via `is_tenant_member`, DELETE via `has_tenant_role(...,['owner','ceo','admin'])`. Deliberate deviations, all correct:
- `tenants`/`memberships` — SELECT-only policies; both tables populate exclusively via a `security definer` signup trigger. No invite/role-change API route exists at all.
- `approval_requests` — UPDATE (decide) restricted to owner/ceo/admin; no DELETE policy (approvals are never deleted).
- `decision_memories` — INSERT/SELECT only, append-only by design.
- `integration_connections`/`oauth_states` — additionally scoped to `user_id = auth.uid()` (OAuth tokens aren't tenant-shared).

No table was found with RLS enabled but a CRUD policy missing by accident.

## 9.3 Approval Policy / Action Authority model

`approval_policies(tenant_id, code, conditions jsonb, steps jsonb)`, seeded per tenant: `sales_send`→manager; `estimate_amount_low` (<¥300k)→manager; `estimate_amount_high` (≥¥300k)→manager+ceo; `discount_low` (≤5%)→manager; `discount_high` (>5%)→ceo; `deal_won`→ceo; `delivery`→manager+ceo; `monthly_report`→manager+ceo; `upsell_opportunity`→manager+ceo. Amounts/roles are tenant-editable via standard RLS.

**There is only AUTO (no approval row created) vs. REQUIRES_APPROVAL (a steps chain). There is no DENY/hard-block tier.** Nothing in this model can encode "never allow this regardless of who approves."

## 9.4 Approval chain role-enforcement

`SUPERUSER_ROLES = ["owner","ceo","admin"]`; `authorizeDecision()`: a superuser role can decide **any** approval at **any** step, unconditionally, bypassing whatever multi-step chain `approval_policies` configured. This is documented as intentional legacy CEO Inbox semantics — but it means the model is additive-only: an org that wants a hard maker-checker separation ("admin may never single-handedly approve a >5% discount") cannot express it. Route-level gating (`DECISION_CAPABLE_ROLES` = owner/ceo/admin/manager) correctly prevents a plain `member` from reaching the decide endpoint at all.

## 9.5 Tenant-scoping in application code (defense in depth, confirmed real)

`getTenantContext()` derives `tenant_id`/`role` exclusively from the session's `memberships` row, with an explicit comment that tenant_id must never be accepted from a request body/param. Sampled 5 `[id]` routes — **every one** applies an explicit `.eq("tenant_id", tenantId)` in addition to `.eq("id", id)`. This is real double-checking, not reliance on RLS alone.

## 9.6 Secrets

No hardcoded API keys/tokens found repo-wide. `.env.example` holds only placeholders with generation instructions (e.g. `openssl rand -hex 32` for `TOKEN_ENCRYPTION_KEY`/`FILE_SIGNING_SECRET`). The service-role key is used only in `lib/supabase/serviceRole.ts`, restricted by its own doc comment to `/api/cron/*` and the signed-file-download route — both confirmed as the only call sites.

## 9.7 Webhook / OAuth callback verification

`google/callback` implements real CSRF/replay protection: single-use, tenant/user/provider-scoped `state`, PKCE `code_verifier` never trusted from the URL, rejected if consumed/expired/mismatched. No other webhook receiver exists in the codebase.

## 9.8 Cost/budget guardrails — confirmed: none

`ai_cost_yen` only accumulates on leads/opportunities; nothing ever reads it back and compares to a limit. No `budget`/`cost_limit`/`rate_limit` column exists on `tenants` or `agents`. Every graph-triggering route is reachable repeatedly by any tenant member with no throttle.

## 9.9 Agent-vs-human privilege parity — no bypass found

Every graph node runs with the *same* tenant-scoped, RLS-bound Supabase client the acting human's session produced (`GraphRunCtx`) — an AI graph step can never write anything the acting human's own RLS grants wouldn't already permit. Role checks (`assertRole`) are applied consistently at routes with an external/irreversible effect (send, deliver, confirm, decide), not at routes that merely start analysis/drafting — a consistent design choice, not an agent-path bypass. The one exception is `growth-loop-check`'s use of `createServiceRoleClient()` (RLS-bypassing, cron-only, `CRON_SECRET`-gated) — it still applies explicit `.eq("tenant_id", ...)` scoping, so no cross-tenant leak was found, but it is the one code path where a future missing filter wouldn't be caught by RLS.

## 9.10 Top 5 risks, ranked

1. **[Medium] No per-tenant cost/usage ceiling.** Any member can repeatedly trigger graph-running routes with no rate limit or budget check. In a real deployment with a billed LLM provider (the seam `TemplateProvider` is designed to be replaced through), this is a direct route to runaway spend from a single low-privileged or compromised account.
2. **[Medium] No hard DENY tier; superuser roles always override any configured approval chain.** A tenant cannot configure true maker-checker separation — the highest role can always single-handedly approve anything.
3. **[Low] `isCronRequestAuthorized()` compares the bearer secret with plain `===`**, not the constant-time comparison used elsewhere for file-signing (`crypto.timingSafeEqual`). Low practical exploitability over HTTPS, but inconsistent with the codebase's own better pattern.
4. **[Low] Role-vocabulary drift risk.** `memberships.role` and `approval_policies.steps` role strings evolved across separate migrations with no FK/enum tie between them; a future edit to one without the other could silently make a step's required role unsatisfiable by anyone but a superuser, with no error raised.
5. **[Informational] Two documented, narrow RLS-bypass paths exist** (`growth-loop-check` cron, `files/download` signed-link redemption), both currently self-scoping correctly — but because RLS is bypassed here, a future change that omits a scoping filter in either file would not be caught by the database's own tenant boundary the way every other route is.

## 9.11 Overall assessment

This is an unusually well-instrumented codebase for its stage: RLS is applied consistently and generically, tenant_id is never trusted from the client, application code double-checks tenant_id on top of RLS, OAuth CSRF/PKCE and signed-file-link verification are both implemented correctly, and no committed secrets were found. **The two substantive findings are architectural/design gaps (no spend ceiling, no true DENY authority tier) rather than exploitable bugs.**
