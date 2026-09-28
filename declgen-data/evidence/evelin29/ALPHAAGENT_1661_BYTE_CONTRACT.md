# Evelin H1 AlphaAgent byte contract

The canonical source is `H1_BG005100_1661_CANONICAL.XML`, copied directly
from the AlphaAgent-exported file supplied for Evelin.  It is a format
fixture, not a model example and not a hand-normalized XML file.

## Immutable reference

- UTF-8, without BOM; 43,914 bytes.
- SHA-256: `1adaa42ba0a6e0e6c8643bfa013bc2edff21a460ab637c224e3cd14cfec98800`.
- LF-only layout: 16 LF, no CR; one dense declaration body; final LF.
- Exact XML declaration followed by one blank line and the AlphaAgent comment.
- 18 `GOODITEM`, 108 `SupportingDocument`, 18 `TransportDocument`, and one
  `PreviousDocument` nest.

## Enforced serializer contract

`core/xmlio.ts` emits the established BG415A child order and escaping, and
reads the Evelin `canonical_h1.xml_preamble` from the client profile.  The
desktop build, manual H1-item update, and approved-export routes all pass the
active client profile to that serializer.  The profile cannot fall back to
the old generic preamble for Evelin.

`tests/evelin-canonical.test.ts` parses the raw fixture and asserts that a
fresh emit is byte-for-byte equal to it.  This catches changes to: preamble,
encoding marker, newline style, comment, element order, reference child order,
escaping, optional-nest handling, and trailing newline.

## Reverse-engineering evidence

The local AlphaAgent installation is a PowerBuilder deployment.  The compiled
libraries identified as relevant to XML/import processing are
`C:\alpha\bin\aa_misv_xml.pbd` (1,789,440 bytes),
`aa_xml_imex.pbd` (2,419,712 bytes), and `aa_impr.pbd` (2,666,496 bytes).
They are compiled PBD objects, so their presence establishes the local export
implementation but is not source-code-level proof of every conditional branch.
The working contract is therefore the supplied accepted AlphaAgent output,
locked by the byte-roundtrip regression test.

## Boundary

This proves byte-level reproduction of the accepted Evelin fixture and blocks
format drift in the stack.  It is not a live filing submission, and it does
not certify changing commodity facts, TARIC measures, valuation, or documents.
