# Evelin AlphaAgent H1 historical evidence

Six accepted AlphaAgent H1 declarations were analysed as evidence only:
1254 (`018774BC2F3A40E2F075E52625907E2C8027C2C55D0B9D56B133206A9F84912`),
1446 (`1AF1945AF01FD0EA2406BB9DB0028BFB01262C3414C0D732B8DD5E53F751C373`),
1522 (`D6A8512EC58DED29AED209948DA14CC6EB294B54C530B0547B17256E377AAB0B`),
1551 (`289C326039240FC98C70F35BED2DF65FF2369E9B565E356B397E8771616911B9`),
1557 (`6EC91F2996C45E7F94BE33E3A1B5B4FFAF7B82F6DDDA350D8539E7056AD0981D`), and
1570 (`1032E23D3BC52E6A70FCC0B8491F0D622275E75266B8A9FE20C58ACE569AF925`).

## Findings promoted into the client profile

- 137 goods-item observations, 63 distinct ten-digit HS codes, and 48 CAS values.
- The same importer (`BGC000000000ZZZZ0`), China supplier family, and N337
  previous-document convention recur across all six files.
- 45 CAS-to-HS observations are unambiguous and are now a conformance guard.
  A generated description that contains one of those CAS values with another
  ten-digit HS is an export-blocking error.

## Deliberately not automated

28 HS codes have more than one historical description; grouped goods are
normal in these declarations and an HS alone is not a product identity.
Three CAS values have contradictory historical associations: `458-37-7`,
`56-85-9`, and `94-62-2`.  They remain review-only, never automatic mappings.
The raw documents are not copied here; their hashes above preserve the exact
source evidence while avoiding a second editable copy.
