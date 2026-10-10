---
name: treaty-body-case-law
description: "Find and analyse UN treaty-body decisions on individual complaints (Views) via UNHRDB: outcome from the operative paragraph, Committee vs parties, cited by case name, symbol and paragraph."
license: PolyForm-Noncommercial-1.0.0
---

# Treaty-body case law with UNHRDB

The UNHRDB connector holds about 4,300 decisions on individual communications by eight treaty bodies (1977–2025), split into numbered paragraphs. Search them with `search_paragraphs` and `scope: "jur"`.

## Find the decisions

- Filter by committee (`committee`: CCPR, CESCR, CEDAW, CAT, CRC, CERD, CRPD, CED) and search for the right and the facts: `"article 17" privacy`, `"non-refoulement" Sri Lanka`, `"freedom of expression" journalist`. Remember that bare words are all required, there is no stemming (`detain*`), and `OR` / `"phrases"` are supported.
- The Committee's own findings use stable wording you can search for: `"disclose a violation"`, `"inadmissible under article"`, `"failed to substantiate"`, `"arbitrary interference"`.
- Every hit shows the decision symbol (e.g. `CCPR/C/50/D/488/1992`); the communication number is the part after `/D/` (488/1992).

## Read a decision

Decisions follow a fixed structure, and the paragraph number tells you who is speaking:

1. **1.x** introduction (author, State party, articles invoked); **2.x** facts as submitted by the author; **3.x** the complaint; **4.x–5.x** the State party's observations and the author's comments.
2. **Consideration of admissibility**, then **consideration of the merits**: the Committee's own reasoning.
3. **Operative paragraph(s)** at the end of the majority text: "The Committee, acting under article 5 (4) of the Optional Protocol, is of the view that the facts before it disclose a violation of…", or "The Committee therefore decides: (a) that the communication is inadmissible…". This, and nothing else, is the outcome.
4. **Separate opinions** (concurring, dissenting) after the decision; their paragraphs carry labels such as `OP1-1`, `OP1-U2`. They are not the Committee's view.

Rules:

- **Take the outcome from the operative paragraph.** Read it with `lookup_by_citation` or on the document page; do not infer it from a title, a search snippet or the facts. A decision can find a violation of one article and declare another claim inadmissible; report both.
- Attribute every point: what the author claimed, what the State party argued, what the Committee found. A sentence in 2.x–5.x is never the Committee's view.
- Admissibility decisions and discontinuances decide nothing on the merits.
- Some decisions (advance unedited versions, joined proceedings) contain two sets of numbering, so a label such as `2.1` can occur twice. Check the section and the surrounding text before citing.

## Retrieve paragraphs

Decision paragraphs are usually decimal (`8.2`). `lookup_by_citation` may not resolve decimal labels; if the reply's `¶` label differs from the one you asked for, or the lookup fails, read the document page `https://lszoszk.github.io/generalcomments/d/<doc_id>/#p8.2.` (`doc_id` comes with every result; anchor = label plus a full stop), or the official text at `https://docs.un.org/en/<symbol>`.

Older decisions (roughly before 2000) were extracted from scanned PDFs. They can contain OCR errors, a merged or missing paragraph, or a page number in the text. Before quoting anything decisive from such a decision, confirm the wording in the official PDF and say that you did.

## Cite

*Toonen v. Australia*, Human Rights Committee, communication No. 488/1992, CCPR/C/50/D/488/1992 (31 March 1994), para. 8.2. Give the body, the communication number, the symbol, the date of adoption (from the document's front matter or the official text) and the paragraph; follow the user's citation style (e.g. OSCOLA). Cite the UN symbol and paragraph, not the database's internal `para_id`.

## Summarising a case

State: the author and State party; the rights invoked; admissibility (which claims were declared inadmissible and why); the Committee's findings on the merits, with the operative paragraph quoted; remedies requested; separate opinions, if any, labelled as such. Cite each element to its paragraph.
