# Preventive Maintenance & Compliance Calendar — Runbook

> Recorded 2026-05-12. Diagnosis of "welcome email never arrives" issue
> on the free Compliance Calendar registration form, and the durable fix.

## What this is

The free tool lives in a **separate repo**:
**`dror75p-ops/Doryangel-preventive-maintenance-schedule.automation`**
served at <https://dror75p-ops.github.io/Doryangel-preventive-maintenance-schedule.automation/>.

It is a single static `index.html`. The "Get My Free Calendar Now" form
collects `fname`, `femail`, optional `faddress`, and POSTs JSON to a
Make.com webhook. There is no server-side code.

## End-to-end pipeline

```
User submits form (index.html line ~1273-1284, handler line ~2002)
      │  JSON: { fname, femail, faddress }
      ▼
Make.com webhook  hook.eu1.make.com/tqmgkkgubkr409v3ygd4ohpmxpvx8iw2
  (hook id 2958713, name "Doryangel Compliance Calendar Signup")
      ▼
Scenario 5546593  "Doryangel Compliance Calendar — Signup & Welcome Email"
  ├─ Module 1  gateway:CustomWebHook (trigger)
  ├─ Module 2  google-email:sendAnEmail  → welcome HTML to {{1.femail}}
  │           FILTER: femail contains "@" AND fname not empty
  ├─ Module 3  google-email:sendAnEmail  → notify office@doryangel.com
  └─ Module 4  google-sheets:addRow      → spreadsheet 1KbVggQNhKbX9370zq-thBzHmN1j1R4g9YI8gKm8_R-o, tab Sheet1
```

Connections used:
- `__IMTCONN__ 5113797` — Gmail OAuth (office@doryangel.com), expires 2026-11-08
- `__IMTCONN__ 5113631` — Google OAuth (office@doryangel.com), no expiry

## What was broken (2026-05-12 incident)

The form code was healthy. The Make.com scenario was disabled and in an invalid state:

- `isActive: false`, `isinvalid: true`
- `executions: 33`, `errors: 23` (70% error rate)
- 4 real-user signups stuck in the webhook queue

Root cause was a chain of three different defects:

1. **Originally** the scenario had a `datastore:AddRecord` dedup module that crashed on every repeat email with `DataError: Duplicate key error`. Because the AddRecord was *before* the email modules, the entire pipeline halted on duplicates → no welcome email ever sent.
2. **After datastore was removed**, an empty-payload test (manual webhook test or a misformed real request) produced `[400] Recipient address required` from the Gmail module — because `{{1.femail}}` resolved to empty and the email API requires a non-empty `to`.
3. **Make.com auto-disabled** the scenario after hitting its error threshold. The webhook stayed enabled, so submissions kept queueing — but nothing consumed them.

The form's JavaScript made all this *invisible to the user*:
```js
fetch(WEBHOOK, {...}).catch(() => {}).finally(() => { showSuccess(); });
```
- `fetch` only rejects on network errors, not HTTP 4xx/5xx, so a dead webhook still
  showed "Calendar Unlocked!"
- The bare `.catch(() => {})` swallows any actual network failure with no log,
  no error UI, no fallback channel.

## The fix (applied 2026-05-12 ~17:39 UTC)

### Make.com side — applied via API

1. Cleaned up the blueprint: webhook → user-email → owner-email → Sheet row
   (datastore removed).
2. **Added a filter on module 2** so the pipeline only runs for valid payloads:
   ```json
   {
     "name": "Has valid email & name",
     "conditions": [[
       { "a": "{{1.femail}}", "o": "text:contains", "b": "@" },
       { "a": "{{1.fname}}",  "o": "text:notempty" }
     ]]
   }
   ```
   Because the flow is linear, this gates modules 3 and 4 too — so a bad
   payload now means "scenario does nothing", never "scenario crashes &
   gets auto-disabled".
3. Reactivated the scenario. Stuck queue drained automatically.

### Form-side — pending

The form in the other repo still silently lies on failure. The hardened
replacement for the `handleSubmit` JS block (and the honeypot field) is in
[`preventive-maintenance-form-snippet.md`](./preventive-maintenance-form-snippet.md).
That file is intended to be pasted by hand or applied once the other repo
is added to this session's allow-list.

## Monitoring & verification checklist

Whenever this pipeline is suspected of breaking:

1. Make.com → Scenarios → "Doryangel Compliance Calendar — Signup & Welcome Email"
   - `isActive` should be true; `isinvalid` should be false
2. Webhook queue (`hook.eu1.make.com/tqmgkkgubkr409v3ygd4ohpmxpvx8iw2`)
   - `queueCount` should be 0 most of the time; a non-zero value that's
     not draining is the canonical "consumer dead" signal
3. Spreadsheet `1KbVggQNhKbX9370zq-thBzHmN1j1R4g9YI8gKm8_R-o`, tab `Sheet1`
   - one row per successful signup
4. Gmail (office@doryangel.com)
   - sent items contains the welcome email
   - inbox contains the owner-notification email

To force a smoke test without touching the live form:
```bash
curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"fname":"QA Test","femail":"YOUR-EMAIL@example.com","faddress":"Test St"}' \
  https://hook.eu1.make.com/tqmgkkgubkr409v3ygd4ohpmxpvx8iw2
```
Expected response: `Accepted` (HTTP 200). Welcome email should arrive within
~1 minute and a new row should appear in Sheet1.

## Known foot-guns (do NOT do these again)

- **Don't insert a datastore dedup module before the email module.** If
  you want deduplication, use `datastore:SearchRecord` with a router so a
  duplicate skips silently to "end" instead of erroring.
- **Don't rely on a single `.catch(() => {})` for error handling in the
  form.** It hides everything. See the hardened snippet.
- **Don't change the form's field names** (`fname`, `femail`, `faddress`)
  without also updating the scenario's mappers and the filter — the names
  are the contract between the two systems.

## Scenario IDs reference

| Make.com scenario | ID | Webhook hookId | Purpose |
|---|---|---|---|
| Doryangel Compliance Calendar — Signup & Welcome Email | 5546593 | 2958713 | This signup form |
| Doryangel Compliance Calendar — Monthly Broadcast | 5546729 | (scheduled, no webhook) | Monthly reminder emails |
| DoryAngel Digest — New Subscriber | 5549170 | 2959797 | Digest signup form |
| DoryAngel Digest — Send Post Notification | 5549246 | 2959799 | Notify subscribers on new post |
| DoryAngel Blog Publish Notification | 5349573 | 2871253 | Internal notification when bot publishes |
| DoryAngel Chat — New Leads | 5578524 | 2970970 | Retell chat-analyzed webhook |
