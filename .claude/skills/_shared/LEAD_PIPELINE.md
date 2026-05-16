# Retell AI → Make.com → Sheets/Gmail Lead Pipeline

Reference for debugging the DoryAngel chat-lead capture flow. **Do not reintroduce any of the five fixed regressions.**

## Pipeline map

```
Retell chat "Hailey" (agent_88fd2bc14215e7210629dfafda)
  → chat ends and is analyzed
  → POST https://hook.eu1.make.com/ii1kuc8ba6gk3yvs506ggrnutp6iwz4h
  → Make.com scenario "DoryAngel Chat — New Leads" (ID 5578524)
    → filter: event_type == "chat_analyzed" only (drop chat_started, chat_ended)
    → Google Sheets append: spreadsheet 1druOTrJhRVhrbAPrGBWD8HtMNkxy-h-PiJcYEhGsuHk, tab Sheet1
    → Gmail to dror75p@gmail.com
```

Both Make connections use the `office@doryangel.com` Google account.

## Known regressions (fixed 2026-05-06) — DO NOT reintroduce

| # | Bug | Wrong value | Correct value |
|---|---|---|---|
| 1 | Column offset | Mapper keys 1-indexed → Timestamp landed in B | 0-indexed; Timestamp in column A |
| 2 | Wrong data source path | `retell_llm_dynamic_variables.*` | `chat.chat_analysis.custom_analysis_data.*` |
| 3 | Duplicate rows | Filter passed both `call_ended` AND `call_analyzed` | Filter passes `chat_analyzed` ONLY |
| 4 | Wrong event name | `call_analyzed` (voice agent format) | `chat_analyzed` (chat agent format) |
| 5 | Wrong payload root key | `1.call.call_analysis.*` (voice schema) | `1.chat.chat_analysis.*` (chat schema) |

## Correct Sheet column mapping (A–O)

| Col | Field | Make.com expression |
|-----|-------|---------------------|
| A | Timestamp | `{{now}}` |
| B | caller_role | `{{1.chat.chat_analysis.custom_analysis_data.caller_role}}` |
| C | full_name | `{{1.chat.chat_analysis.custom_analysis_data.full_name}}` |
| D | callback_phone | `{{1.chat.chat_analysis.custom_analysis_data.callback_phone}}` |
| E | email_address | `{{1.chat.chat_analysis.custom_analysis_data.email_address}}` |
| F | property_address | `{{1.chat.chat_analysis.custom_analysis_data.property_address}}` |
| G | unit_details | `{{1.chat.chat_analysis.custom_analysis_data.unit_details}}` |
| H | is_occupied | `{{1.chat.chat_analysis.custom_analysis_data.is_occupied}}` |
| I | current_mgmt | `{{1.chat.chat_analysis.custom_analysis_data.current_mgmt}}` |
| J | is_urgent | `{{1.chat.chat_analysis.custom_analysis_data.is_urgent}}` |
| K | appointment_set | `{{1.chat.chat_analysis.custom_analysis_data.appointment_set}}` |
| L | chosen_slot | `{{1.chat.chat_analysis.custom_analysis_data.chosen_slot}}` |
| M | chat_summary | `{{1.chat.chat_analysis.custom_analysis_data.chat_summary}}` |
| N | chat_successful | `{{1.chat.chat_analysis.custom_analysis_data.chat_successful}}` |
| O | user_sentiment | `{{1.chat.chat_analysis.custom_analysis_data.user_sentiment}}` |

## Important context

- **Simulation mode does NOT fire real webhooks.** Only real chat sessions on the live site trigger the Make scenario.
- The **mobile "Call AI" button** (`tel:+15167743249`) is a separate voice channel, NOT connected to this pipeline.
- The 14 lead fields are configured in Retell as **Post-Chat Data Extraction**, which is why they live under `custom_analysis_data` — not under `retell_llm_dynamic_variables`.

## Source

`/home/user/Doryangel-web-3-carousel-blog/CLAUDE.md` section "Retell AI lead capture" — read it before changing the pipeline.
