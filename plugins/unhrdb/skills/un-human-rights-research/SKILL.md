---
name: un-human-rights-research
description: "Research UN human rights law via the UNHRDB connector: General Comments, treaty-body Views, Special Procedures and UPR recommendations, answered with verbatim, paragraph-cited UN text."
license: PolyForm-Noncommercial-1.0.0
---

# Researching UN human rights law with UNHRDB

The UNHRDB connector gives five read-only tools over two separate corpora. Results are the UN's own wording, keyed to a UN document symbol and printed paragraph number, so every statement can be quoted and cited exactly.

| Corpus | Tools | What it holds |
|---|---|---|
| Paragraphs | `search_paragraphs`, `lookup_by_citation` | General Comments / General Recommendations of all treaty bodies (~190 documents); decisions on individual communications of 8 treaty bodies (~4,300); thematic reports of all Special Procedures mandates (~1,600). |
| UHRI recommendations | `search_recommendations`, `lookup_recommendation`, `list_uhri_facets` | 270,000+ recommendations and observations addressed to individual States by treaty bodies, the UPR and Special Procedures (2006–). |

The corpora are never mixed: a paragraph search cannot return a recommendation and vice versa. If the connector is not available, say so and point the user to the hosted endpoint `https://150.254.115.204/unhrdb-mcp-rpc/mcp` (add it as a custom connector) or to the web interface https://lszoszk.github.io/generalcomments/. Do not answer from memory as if you had checked the sources.

## 1. Decide which sources answer the question

Keep their legal character apart, and say which one you are relying on:

- **General Comments / General Recommendations** (`scope: "gc"`): the treaty body's authoritative interpretation of its treaty. Best source for "what does article X require".
- **Decisions on individual communications** (`scope: "jur"`): the treaty applied to a case. Views on the merits find a violation or no violation; admissibility decisions say nothing on the merits. For case-law questions use the `treaty-body-case-law` skill.
- **Special Procedures reports** (`scope: "sp"`): the independent expert opinion of a mandate-holder. Persuasive, not binding; never present it as what a treaty requires.
- **UHRI recommendations**: what a body asked a specific State to do. Evidence of practice and concerns about a country, not interpretation of the treaty. Use the `uhri-recommendations` skill.

Committee codes: CCPR (ICCPR), CESCR (ICESCR), CERD, CEDAW, CAT, CRC, CMW, CRPD, CED.

## 2. Search well

`search_paragraphs` takes `query`, `scope` (`gc` / `jur` / `sp` / `all`), `committee`, `year`, `limit` (≤ 20) and `page`.

- **Bare words are all required (AND).** A long natural-language query usually returns nothing. Use two to four key terms.
- Use the query syntax: `"reasonable accommodation"` (phrase), `privacy OR "private life"` (synonyms), `discriminat*` (prefix), `torture NOT "ill-treatment"`. There is no stemming: `child` does not match `children`; write `child*` or `child OR children`.
- Run several searches: synonyms, the treaty's own wording, the article number in words ("article 17"), narrower and broader terms.
- The header gives the total and the split by collection (gc / jur / sp). Page through with `page` when the first 20 hits are not enough; say how far you read.
- Treat a result as a lead, not an answer. Read the paragraphs around it before relying on it (next section).

## 3. Read in context and pin the paragraph

`lookup_by_citation` resolves `SYMBOL ¶N` to the verbatim paragraph: e.g. `CRC/C/GC/25 ¶12`, `A/HRC/61/42 para 10`. Without a paragraph number it returns the document's metadata and its official source link.

- Use the exact symbol a search result shows. Older General Comments are filed under compilations or annual reports, not `…/GC/N`: e.g. Human Rights Committee general comment No. 16 is `HRI/GEN/1/Rev.9 (Vol. I) p. 191`; many CEDAW and CERD General Recommendations sit under `A/…` report symbols. Nicknames such as "ICCPR GC34" do not resolve; search first (`scope: "gc"`, `committee`, a distinctive term) and take the symbol from the hit.
- **Check that the paragraph returned is the one you asked for.** The reply starts with `SYMBOL ¶n`. If `n` differs from your request, the label was not found and you got another paragraph: do not use it.
- Decimal paragraph numbers (`¶8.3`, common in decisions) and opinion labels (`OP1-2`) may not resolve through `lookup_by_citation`. Use the document page instead: `https://lszoszk.github.io/generalcomments/d/<doc_id>/#p8.3.` (`doc_id` is shown with every result; the anchor is the label followed by a full stop), or the official text at `https://docs.un.org/en/<symbol>`.
- Read the paragraphs before and after (`¶n-1`, `¶n+1`): a sentence can be the State party's argument or the author's claim rather than the Committee's own view, especially in decisions.
- `[[fn:N]]` in a text marks a footnote reference. Footnote texts are not returned by the tools; when a footnote matters (e.g. a cross-reference to a General Comment), check it in the official document.

## 4. Answer

- Quote the UN text verbatim and keep quotations short; never present a paraphrase as a quotation.
- Cite every statement to the document and paragraph: *Human Rights Committee, general comment No. 36 (2018), CCPR/C/GC/36, para. 12*. For decisions: *Toonen v. Australia, CCPR/C/50/D/488/1992 (1994), para. 8.2*. Follow the citation style the user asks for (e.g. OSCOLA).
- Cite the UN document, not the database's internal `para_id`; those ids may change between database versions.
- Say which kind of source each point rests on (interpretation, case, expert opinion, recommendation), and distinguish what a body *found* from what a party *argued*.
- State the limits of the search: what you searched, which collections, and anything you could not verify. If no UN source addresses the point, say so rather than stretching a source.
- When you rely on the database itself, it can be cited as: Szoszkiewicz, Ł., & Kowalska, Z. (2026). *UNHRDB — UN Human Rights Database*. Zenodo. https://doi.org/10.5281/zenodo.10495719

## Coverage

Thematic Special Procedures reports only (no country-visit reports or communications). Decisions are English texts. Some older decisions were extracted from scanned PDFs and may contain OCR errors or miss a paragraph; for anything decisive in a pre-2000 decision, confirm the wording against the official PDF.
