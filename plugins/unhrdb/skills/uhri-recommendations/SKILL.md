---
name: uhri-recommendations
description: "Search UN recommendations to States (UPR, treaty bodies, Special Procedures) via UNHRDB's UHRI tools: country, body, theme and year filters, careful counts, cited by UN document symbol."
license: PolyForm-Noncommercial-1.0.0
---

# UN recommendations to States (UHRI) with UNHRDB

The UHRI tools of the UNHRDB connector search more than 270,000 recommendations and observations that UN mechanisms addressed to individual Member States since 2006 (Universal Human Rights Index, OHCHR). They are a separate corpus from the General Comments, decisions and Special Procedures reports: `search_recommendations` never returns those, and `search_paragraphs` never returns recommendations.

A recommendation is what a body asked a particular State to do. It records concerns about that State; it is not an interpretation of the treaty. For what a right requires, use the General Comments (`un-human-rights-research` skill).

## 1. Get the exact filter values first

Call `list_uhri_facets` before filtering:

- `kind: "countries"` for country names as the UN writes them (e.g. "United Kingdom of Great Britain and Northern Ireland", "Türkiye").
- `kind: "bodies"` for issuing-body codes (`UPR`, `CCPR`, `CESCR`, `CAT`, `CRC`, `CEDAW`, `CERD`, `CRPD`, `CMW`, `CED`, Special Procedures mandates).
- `kind: "types"` for annotation types (typically "Recommendations" and "Observations").
- `kind: "all"` for a summary including regions and the year span.

Theme and affected-person labels are long, exact strings: read them off a first, unfiltered result and reuse them verbatim.

## 2. Search

`search_recommendations` takes `query` (free text, optional), `countries`, `bodies`, `themes`, `affected_persons`, `sdgs`, `annotation_type`, `year_start`, `year_end`, `limit` (≤ 20) and `page`. Several values in one filter are combined with OR; different filters with AND.

- Start broad (country + body, or a short query) and narrow down; browse by filters alone when the question is "everything the CAT said to X".
- Use `annotation_type: "Recommendations"` when the user wants what the State was asked to do, and "Observations" for the concerns noted.
- `lookup_recommendation` with an `annotation_id` returns the full text and every label of one record.

## 3. Counting and comparing

- The search header reports the total for the filters used. Quote it as "N recommendations matching these filters", not as the number of times a topic was raised: one paragraph of a report can hold several recommendations, and UPR recommendations repeat across States and cycles.
- Theme and group labels were assigned by OHCHR and are not exhaustive; combine a label filter with a text query and say which you used.
- For comparisons across countries or years, give the filters, the year span and the date of the search, so the figures can be reproduced.

## 4. Cite

Quote recommendations verbatim. Cite each by issuing body, State, UN document symbol and year: e.g. *Committee against Torture, concluding observations on Poland, CAT/C/POL/CO/7 (2019), para. 20*. When the record gives no paragraph, cite the symbol and keep the `annotation_id` for traceability. UPR recommendations are cited to the Working Group report of the State (`A/HRC/…`), with the recommending State where the text names it.
