# Room write authority plan — R2

## Proven direct write paths

| source/path | table | operation | target | current caller | required replacement |
|---|---|---|---|---|---|
| `createRoom` | rooms | INSERT | new room | host device | authenticated INSERT bootstrap |
| `createRoom` | participants | INSERT | own new host row | host device | authenticated owner INSERT |
| `joinRoom` / QR / deep-link | rooms | SELECT | requested room | guest | anon/authenticated SELECT by code |
| `joinRoom` / QR / deep-link | participants | SELECT/INSERT/UPDATE | own participant; room visibility | guest | SELECT visibility; authenticated owner DML |
| `startGame`, countdown, round reset, result publication | rooms/participants | UPDATE | room or multiple participant rows | host device | authenticated owner-host direct path for this compatibility gate; narrow RPC is a later hardening gate |
| choice/ready | participants | UPDATE | own row | participant | authenticated owner UPDATE |
| leave/cleanup | participants | DELETE | own row or host cleanup rows | participant/host | authenticated owner or owner-host DELETE |
| room destruction | rooms/participants | UPDATE/DELETE | room and members | host | authenticated owner-host UPDATE/DELETE |
| account/game stats | history/stat tables | INSERT/UPDATE | account-owned rows | authenticated account | unchanged; outside room authority |

## Minimal safe option

Keep room-code SELECT public to the two API roles, require authenticated Auth for room and participant creation, revoke anon room DML, remove both unrestricted policies, and authorize room UPDATE/DELETE through `participant_caller_is_room_host(id)`. This is the smallest compatible Identity Gate patch because existing host-authoritative game code writes room envelopes and other participant rows directly.

## Compatibility and gate placement

This preserves current gameplay writes for an authenticated owner-host but does not yet field-restrict every room column or move host writes into RPCs. That narrower server-authority design belongs in the Lifecycle Gate / later hardening phase. The current Identity Gate must still be locally DB-tested before any Seoul apply.

## Bootstrap

Room INSERT is permitted to authenticated callers before the host participant exists; the immediate participant INSERT binds the host row to the same `auth.uid()`. A failed participant insert must fail closed in the client and must not create an unowned local fallback. Room UPDATE/DELETE is only possible after the bound host participant exists.
