# Slice 07 — A QC-held lot reads un-sellable on Inventory + Dispatch

**Story:** US-07 · **Job:** J3 · **Release:** 3 · **Effort:** ≤1 day

## Learning hypothesis
Surfacing `getQcStatus().held` wherever a lot can be reserved or shipped will stop the owner from
committing a held lot — validating J3 for the QC-hold guard across the sell path.

## Thinnest end-to-end vertical
Read the hold state → show "no vendible" banner + block the Reserve control on Inventory; flag on Dispatch.

## In scope
- Hold banner on Inventory + Dispatch for held lots.
- Block the Reserve control (UI) on top of the DB hold/oversell guard.
- Releasing the hold restores the control.

## Out of scope
- Changing the DB hold enforcement (stays SSOT). Dispatch send logic.

## Production-data AC
- [ ] A held lot (JC-680) shows "en QC-hold · no vendible" on Inventory and is flagged on Dispatch.
- [ ] Its Reserve control is blocked while held; restored when released.
- [ ] Render test (banner for a held lot) + behavior test (held → blocked; released → available).

## Dogfood moment
Andres places JC-680 on hold in QC and watches it become un-reservable on Inventory.
