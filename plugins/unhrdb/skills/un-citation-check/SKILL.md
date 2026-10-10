---
name: un-citation-check
description: "Check UN human rights citations in a text against UNHRDB: confirms that each cited General Comment, treaty-body decision or Special Procedures paragraph exists and says what is claimed."
license: PolyForm-Noncommercial-1.0.0
---

# Checking UN citations against UNHRDB

Goal: for every UN citation in the text, establish whether the cited paragraph exists and says what the text claims. Report what you checked and how; never mark a citation as verified without having read the paragraph through the connector or the official document.

## 1. Extract the citations

List every reference to a UN document with a paragraph: symbol forms such as `CCPR/C/GC/36, para. 12`, `E/C.12/GC/14 ¶ 43`, `CRPD/C/GC/1, paras 25-26`, `A/HRC/31/57, para. 20`, decisions such as `Toonen v. Australia (488/1992), para. 8.2`, and informal forms such as "General Comment 34, para. 22". For each, note what the text attributes to it: a quotation (exact words) or a proposition (a paraphrased claim).

Paragraph ranges (`paras 25-26`) are checked paragraph by paragraph. Citations without a paragraph can only be checked at document level; say so.

## 2. Find the exact symbol

`lookup_by_citation` needs the UN symbol as the database stores it.

- Formal symbols usually work as written: `CRC/C/GC/25 ¶12`.
- Informal names do not ("ICCPR GC34", "GR 35"). Search with `search_paragraphs` (`scope: "gc"`, the `committee` code, and a distinctive word from the cited passage) and take the symbol from the hit. Older General Comments are filed under compilation or report symbols, e.g. `HRI/GEN/1/Rev.9 (Vol. I) p. 191` (Human Rights Committee, general comment No. 16), `A/…` report symbols for many CEDAW and CERD General Recommendations.
- For a decision cited by case name or communication number, search `scope: "jur"` with the author's name or `"488/1992"` and the committee.

## 3. Retrieve and compare

Call `lookup_by_citation` with `SYMBOL ¶N`.

- **Check the label in the reply.** It starts with `SYMBOL ¶n`; if `n` is not the paragraph you asked for, the label was not found and the text belongs to another paragraph. Treat it as "not found", not as the cited paragraph.
- Decimal labels (`8.2`, `10.4`) and separate-opinion labels (`OP1-3`) may fail to resolve. Then read the document page `https://lszoszk.github.io/generalcomments/d/<doc_id>/#p8.2.` (`doc_id` comes with every search result; anchor = label plus a full stop) or the official text at `https://docs.un.org/en/<symbol>`.
- If the paragraph is not where the text says, search for the quoted words (`"exact phrase"` with `search_paragraphs`) to find where they really are; a neighbouring paragraph or a different document is a common error.
- Compare:
  - **quotation**: word for word, apart from typographic quotes, and with omissions marked by an ellipsis;
  - **proposition**: does the paragraph support the claim, or does it only report a party's argument, a different right, or a narrower point?
- `[[fn:N]]` marks a footnote reference; footnote texts are not returned. When the citation is to a footnote, check it in the official document.

## 4. Report

One row per citation:

| # | Citation in text | Resolved to | Status | Note |
|---|---|---|---|---|
| 1 | GC 34, para. 22 | CCPR/C/GC/34 ¶22 | ✓ verified | quote matches |
| 2 | CCPR/C/GC/36, para. 12 | CCPR/C/GC/36 ¶12 | ≈ supports, not a quote | text paraphrases ¶12 |
| 3 | E/C.12/GC/14, para. 34 | E/C.12/GC/14 ¶43 | ✗ wrong paragraph | the passage is in ¶43 |
| 4 | CEDAW GR 19, para. 7 | — | ? not found | no matching document |

Status values: **✓ verified** (paragraph exists and matches), **≈ supports** (paraphrase faithful to the paragraph), **⚠ partly** (wording altered, context changes the meaning, or it is a party's argument presented as the Committee's view), **✗ wrong** (wrong paragraph, wrong document, or not in the source), **? unverifiable** (document not in UNHRDB or not retrievable). For ✗ and ⚠ quote the actual paragraph text and give the correct citation where you found it.

End with a short summary (n checked, n verified, n problems) and the date of the check. Coverage gaps (country-visit Special Procedures reports, documents outside the database) are "? unverifiable", not errors; suggest checking them at https://docs.un.org.
