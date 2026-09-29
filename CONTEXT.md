# Amazon Seller Agent domain context

This is the confirmed vocabulary for the local content studio. It describes
the business model and invariants; it does not claim that every object or
workflow is already implemented.

| Term | Definition |
| --- | --- |
| Workspace | The initial local single-user boundary that owns products, assets, jobs, and records. |
| ProductRecord | A product identity and stable internal reference, including SKU context; it is not an ASIN. |
| ProductRevision | An immutable snapshot of user-supplied product fields, source notes, and edit time. Saving alone does not confirm the facts. |
| Asset | An original or derived image file with product ownership, format, dimensions, and provenance. |
| ListingContentVersion | Site/language-specific copy, keywords, and evidence bound to input revisions. Images are associated through a ContentPackage. |
| Job / JobItem | A batch request and its per-product execution record, input revisions, state, errors, and outputs. |
| Review | A human decision bound to one exact content version and its input facts. |
| ContentPackage | An immutable delivery selection of copy and image versions in a declared order, explicitly marked draft or formally approved. |
| Publication | A later platform submission record for one approved content package and its external result. |
| Source fact | A product claim supported by user-provided data or a recorded authoritative source. Generated copy is not a source fact. |
| Approved | A human review conclusion for a specific version; it does not transfer approval to later versions. |

The source of truth is the product revision and original asset history. Generated
outputs cannot overwrite source material. When a fact, copy field, image, or
image order changes, the affected content version and review binding must be
made explicit. A formal package may contain only approved content whose source
facts remain valid; a draft export must be marked as a draft.

The initial product path is local, US English, and ordinary single-product
work. Existing `ProductBrief`, `ListingCopy`, and `ListingResult` contracts
remain compatible while outer records evolve. `imageCount` in the existing
listing audit means the user-supplied count and does not prove image inspection.
