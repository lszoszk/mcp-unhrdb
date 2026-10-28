#!/usr/bin/env python3
"""UNHRDB quote guard: a reply may not quote what no tool returned.

Two Claude Code hooks:

  quote_guard.py stop       Stop hook, for a turn in which Claude used the UNHRDB
                            connector or one of this plugin's skills. Every
                            quotation of QUOTE_MIN_WORDS or more words that is
                            attributed to a source, in Claude's final reply and in
                            any Markdown, text or HTML file Claude wrote during
                            the turn, must appear verbatim in raw tool output from
                            this session (main and subagent transcripts), or in
                            the user's own messages. Otherwise the reply is sent
                            back to Claude with the list of unmatched quotations.
  quote_guard.py web-note   PostToolUse hook for WebFetch and WebSearch, once the
                            connector or a skill has been used in the session.
                            Their results are summaries written by a small model,
                            so a note tells Claude that nothing in them is verbatim.

Not sources: WebFetch/WebSearch results, the report a subagent hands back (model
prose, not the text it fetched), Claude's own writes, reads of files Claude
created, and harness messages (including this hook's own feedback). A file Claude
only edited (the user's draft) still counts.

A quotation is text in "…", “…”, „…”, «…» or ‘…’ (OSCOLA). It is attributed
when a citation stands outside it, within ATTRIBUTION_WINDOW characters on the
same line: a UN symbol, ¶, §, para., a General Comment or Recommendation number,
a communication number, "v." between parties, or a page pinpoint. Not checked:
unattributed quotation marks (terms, titles, hypothetical speech), blockquotes
without quotation marks (proposed wording), quotations in Polish (UNHRDB holds
no Polish text, so they are translations or Claude's own wording), and code.
These limits come from replaying the hook over 118 real research sessions. An ellipsis or a bracketed
alteration splits a quotation into segments; every segment of SEGMENT_MIN_WORDS
or more words must match. Matching is on words, case-insensitive, punctuation
ignored, diacritics kept. A quotation whose line carries "[unverified]" is
skipped, so Claude can flag an honest recollection without claiming it checked.

Off switch: UNHRDB_QUOTE_GUARD=off. After MAX_BLOCKS consecutive blocks in a
session the reply goes through with a warning to the user.

The design follows the quotation hook in Daniel Epps's legal-research-skills
(MIT, https://github.com/danepps/legal-research-skills).
"""
import glob
import html
from datetime import datetime
import json
import os
import re
import sys
import tempfile

MARKER = "UNHRDB quote guard"
ENV_SWITCH = "UNHRDB_QUOTE_GUARD"
QUOTE_MIN_WORDS = 5
SEGMENT_MIN_WORDS = 3
MAX_BLOCKS = 2
MAX_LISTED = 8
ATTRIBUTION_WINDOW = 60
POLISH_LETTERS = re.compile(r"[ąćęłńśźżĄĆĘŁŃŚŹŻ]")
CHECKED_EXT = {".md", ".markdown", ".txt", ".html", ".htm"}

PLUGIN_SKILLS = {"un-human-rights-research", "un-citation-check", "treaty-body-case-law"}
# Tool names of the UNHRDB connector. Installed through the plugin they read
# mcp__plugin_unhrdb_unhrdb__<tool>; added by hand, mcp__unhrdb__<tool> or
# mcp__<connector id>__<tool>. The part after the last "__" identifies them.
CONNECTOR_TOOLS = {
    "search_paragraphs", "lookup_by_citation", "search_recommendations",
    "lookup_recommendation", "list_uhri_facets",
}
EXCLUDED_RESULT_TOOLS = {
    "WebFetch", "WebSearch", "Write", "Edit", "MultiEdit", "NotebookEdit",
    "Agent", "Task", "Workflow", "SendMessage", "SubagentHandback", "TodoWrite",
}
WRITE_TOOLS = {"Write", "Edit", "MultiEdit"}

_AGENT_BLOCKS = re.compile(
    r"<task-notification>.*?</task-notification>|<agent-message\b[^>]*>.*?</agent-message>",
    re.S | re.I,
)
_SAVED_OUTPUT = re.compile(r"saved to:?\s+(/\S+?\.(?:txt|json|md))(?=[.,;]?(?:\s|\\n|$))")
_CITATION = re.compile(
    r"\b[A-Z]{1,6}(?:/[A-Z0-9.()\-]+){2,}"                # CCPR/C/GC/36, A/HRC/31/57
    r"|[¶§]|\bparas?\.?\s*\d"
    r"|\b(?:GC|GR)\s*(?:No\.?\s*)?\d|General (?:Comment|Recommendation)s?\s+(?:No\.?\s*)?\d"
    r"|\b\d{1,4}/(?:19|20)\d\d\b"                       # communication 488/1992
    r"|\b[A-Z][\w'’-]+ v\.? [A-Z]"                       # Toonen v. Australia
    r"|\b(?:pp?|s)\.\s*\d"
)
_COMMAND = re.compile(r"<command-name>\s*/?(?:[\w.-]+:)?([\w-]+)\s*</command-name>", re.I)


# ---------------------------------------------------------------- transcripts

def read_records(path):
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return []
    out = []
    with fh:
        for line in fh:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if isinstance(o, dict):
                out.append(o)
    return out


def subagent_paths(transcript_path):
    base = transcript_path[: -len(".jsonl")] if transcript_path.endswith(".jsonl") else ""
    if not base:
        return []
    return sorted(glob.glob(os.path.join(base, "subagents", "**", "*.jsonl"), recursive=True))


def blocks(o):
    msg = o.get("message")
    content = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def flatten(content):
    if isinstance(content, str):
        return content
    parts = []
    for b in content if isinstance(content, list) else []:
        if isinstance(b, str):
            parts.append(b)
        elif isinstance(b, dict) and b.get("type") == "text":
            parts.append(b.get("text", ""))
        elif isinstance(b, dict) and b.get("type") == "tool_result":
            parts.append(flatten(b.get("content")))
    return "\n".join(parts)


def from_harness(o):
    """A user-role record written by the harness, a hook or another model."""
    if o.get("isMeta") or o.get("promptSource") == "system":
        return True
    origin = o.get("origin")
    return isinstance(origin, dict) and origin.get("kind") in {"task-notification", "peer"}


def is_prompt(o):
    """The person's own message (not a tool result, not a harness notice)."""
    if o.get("type") != "user" or from_harness(o):
        return False
    bs = blocks(o)
    if any(b.get("type") == "tool_result" for b in bs):
        return False
    text = _AGENT_BLOCKS.sub(" ", flatten([b for b in bs if b.get("type") == "text"]))
    return bool(text.strip()) and MARKER not in text


def tool_suffix(name):
    return str(name or "").rsplit("__", 1)[-1]


def active(records):
    """True once the connector or one of the plugin's skills has been used."""
    for o in records:
        for b in blocks(o):
            if o.get("type") == "assistant" and b.get("type") == "tool_use":
                name = b.get("name", "")
                if tool_suffix(name) in CONNECTOR_TOOLS and name.startswith("mcp__"):
                    return True
                inp = b.get("input") if isinstance(b.get("input"), dict) else {}
                if name == "Skill":
                    skill = str(inp.get("skill") or "").lstrip("/").rsplit(":", 1)[-1]
                    if skill in PLUGIN_SKILLS:
                        return True
            elif o.get("type") == "user" and b.get("type") == "text":
                if any(m.group(1) in PLUGIN_SKILLS for m in _COMMAND.finditer(b.get("text", ""))):
                    return True
    return False


class Session:
    def __init__(self, transcript_path):
        self.path = transcript_path
        self.main = read_records(transcript_path)
        self.subs, self.created, self.sources = [], set(), []

    def load_sources(self):
        """Read the sources: the main transcript, plus the subagent transcripts
        touched during this turn (a session's subagent folder can run to gigabytes)."""
        since = self.turn_started()
        for path in subagent_paths(self.path):
            try:
                if since is None or os.path.getmtime(path) >= since:
                    self.subs.append(read_records(path))
            except OSError:
                pass
        self.created = self._created_paths()
        for recs in [self.main] + self.subs:
            self._collect(recs, own_prompts=recs is self.main)

    def turn_started(self):
        for o in self.turn():
            try:
                stamp = datetime.fromisoformat(str(o["timestamp"]).replace("Z", "+00:00"))
                return stamp.timestamp() - 5
            except (KeyError, ValueError):
                continue
        return None

    def _created_paths(self):
        """Files Claude wrote without having read them first: its own texts."""
        created = set()
        for recs in [self.main] + self.subs:
            seen = set()
            for o in recs:
                for b in blocks(o):
                    if b.get("type") != "tool_use" or b.get("name") not in WRITE_TOOLS | {"Read"}:
                        continue
                    inp = b.get("input") if isinstance(b.get("input"), dict) else {}
                    path = os.path.normpath(str(inp.get("file_path") or ""))
                    if b.get("name") == "Write" and path not in seen:
                        created.add(path)
                    seen.add(path)
        return created

    def _collect(self, recs, own_prompts):
        names, reads, saved = {}, {}, []
        for o in recs:
            typ = o.get("type")
            for b in blocks(o):
                kind = b.get("type")
                if typ == "assistant" and kind == "tool_use":
                    names[b.get("id")] = b.get("name", "")
                    inp = b.get("input") if isinstance(b.get("input"), dict) else {}
                    if b.get("name") == "Read" and inp.get("file_path"):
                        reads[b.get("id")] = os.path.normpath(str(inp["file_path"]))
                elif typ == "user" and kind == "tool_result":
                    tid = b.get("tool_use_id")
                    name = names.get(tid, "")
                    if name in EXCLUDED_RESULT_TOOLS or reads.get(tid) in self.created:
                        continue
                    text = flatten(b.get("content"))
                    self.sources.append(text)
                    saved += _SAVED_OUTPUT.findall(text)
                elif typ == "user" and kind == "text" and own_prompts and not from_harness(o):
                    # In a subagent transcript the "user" is the parent model's prompt.
                    text = b.get("text", "")
                    if MARKER not in text:
                        self.sources.append(_AGENT_BLOCKS.sub(" ", text))
        for path in saved:
            try:
                with open(path, encoding="utf-8", errors="replace") as fh:
                    self.sources.append(fh.read())
            except OSError:
                pass

    def last_reply(self):
        for o in reversed(self.main):
            if is_prompt(o):
                return ""
            if o.get("type") == "assistant":
                text = "\n".join(b.get("text", "") for b in blocks(o) if b.get("type") == "text")
                if text.strip():
                    return text
        return ""

    def turn(self):
        """Records since the person's last message."""
        start = max((i for i, o in enumerate(self.main) if is_prompt(o)), default=0)
        return self.main[start:]

    def turn_files(self):
        """(path, text) for Markdown/text/HTML written since the person's last message."""
        out = []
        for o in self.turn():
            if o.get("type") != "assistant":
                continue
            for b in blocks(o):
                if b.get("type") != "tool_use" or b.get("name") not in WRITE_TOOLS:
                    continue
                inp = b.get("input") if isinstance(b.get("input"), dict) else {}
                path = str(inp.get("file_path") or "")
                if os.path.splitext(path)[1].lower() not in CHECKED_EXT:
                    continue
                if b.get("name") == "Write":
                    out.append((path, str(inp.get("content") or "")))
                elif b.get("name") == "Edit":
                    out.append((path, str(inp.get("new_string") or "")))
                else:
                    for e in inp.get("edits") or []:
                        if isinstance(e, dict):
                            out.append((path, str(e.get("new_string") or "")))
        return out


# ---------------------------------------------------------------- matching

def clean_source(s):
    s = html.unescape(s)
    s = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)  # JSON-in-text
    s = s.replace("\\n", " ").replace('\\"', '"')
    s = re.sub(r"\[\[fn:[^\]]*\]\]", " ", s)          # UNHRDB footnote markers
    s = re.sub(r"(?m)^\s*\d+(?:\t|→)", "", s)          # Read tool line numbers
    return s


def tokens(s):
    s = s.replace("­", "").replace("​", "").replace("﻿", "")
    return re.findall(r"[^\W_]+", s.casefold())


def strip_code(text):
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    return re.sub(r"`[^`\n]*`", " ", text)


_QUOTES = re.compile(
    r'„([^„”“"\n]+?)[”“"]'
    r'|"([^"\n]+?)"'
    r"|“([^“”\n]+?)”"
    r"|«([^«»\n]+?)»"
)
_SINGLE_OPEN = re.compile(r"(?<!\w)‘")
_SINGLE_CLOSE = re.compile(r"’(?!\w)")


def extract_quotes(text):
    """(readings, line, context) for each pair of quotation marks; context is up
    to ATTRIBUTION_WINDOW characters either side of the quotation, on its line.

    A closing ‘…’ cannot be told from an apostrophe ("States’ duties"), so a
    single-quoted passage yields one reading per possible closing mark, up to
    the next opening mark or the end of the line."""
    found = []
    w = ATTRIBUTION_WINDOW
    for line in strip_code(text).split("\n"):
        for m in _SINGLE_OPEN.finditer(line):
            stop = line.find("‘", m.end())
            span = line[m.end(): stop if stop != -1 else len(line)]
            ends = [c.start() for c in _SINGLE_CLOSE.finditer(span)]
            if ends:
                close = m.end() + ends[-1] + 1
                context = line[max(0, m.start() - w): m.start()] + " " + line[close: close + w]
                found.append(([span[:e] for e in ends], line, context))
        for m in _QUOTES.finditer(line):
            q = next(g for g in m.groups() if g is not None)
            context = line[max(0, m.start() - w): m.start()] + " " + line[m.end(): m.end() + w]
            found.append(([q], line, context))
    return found


def segments(quote):
    """Word lists between ellipses and bracketed alterations; a word touching a
    bracket ("[t]he", "State[s]") is dropped with it."""
    parts = re.split(r"\w*\[[^\]]*\]\w*|\.\s?\.\s?\.|…", quote)
    return [t for t in (tokens(p) for p in parts) if len(t) >= SEGMENT_MIN_WORDS]


def matches(quote, corpus):
    segs = segments(quote)
    return not segs or all(" " + " ".join(s) + " " in corpus for s in segs)


def unmatched(text, corpus, seen):
    """Quotations none of whose readings is found verbatim in the corpus."""
    out = []
    for readings, line, context in extract_quotes(text):
        if not _CITATION.search(context):
            continue
        readings = [r for r in readings
                    if len(tokens(r)) >= QUOTE_MIN_WORDS and not POLISH_LETTERS.search(r)]
        key = " ".join(tokens(readings[0])) if readings else ""
        if not key or key in seen or "[unverified]" in line.lower():
            continue
        seen.add(key)
        if not any(matches(r, corpus) for r in readings):
            out.append(readings[0].strip())
    return out


# ---------------------------------------------------------------- hooks

def disabled():
    return os.environ.get(ENV_SWITCH, "").strip().lower() in {"off", "0", "false", "no"}


def counter_path(session_id):
    safe = re.sub(r"[^\w-]", "", session_id or "na")
    return os.path.join(tempfile.gettempdir(), f"unhrdb-quote-guard-{safe}.count")


def run_stop(data):
    transcript = data.get("transcript_path") or ""
    if not transcript:
        return None
    sess = Session(transcript)
    if not active(sess.turn()):
        return None
    reply = data.get("last_assistant_message") or sess.last_reply()
    files = sess.turn_files()
    if not reply.strip() and not files:
        return None
    sess.load_sources()

    corpus = " " + " ".join(tokens(clean_source("\n".join(sess.sources)))) + " "
    seen = set()
    problems = [("reply", q) for q in unmatched(reply, corpus, seen)]
    for path, text in files:
        problems += [(os.path.basename(path), q) for q in unmatched(text, corpus, seen)]

    counter = counter_path(data.get("session_id", ""))
    if not problems:
        try:
            os.remove(counter)
        except OSError:
            pass
        return None

    count = 0
    if data.get("stop_hook_active"):
        try:
            with open(counter) as fh:
                count = int(fh.read().strip() or 0)
        except (OSError, ValueError):
            count = 0
    listed = "\n".join(
        f"{i}. [{where}] “{q[:220]}{'…' if len(q) > 220 else ''}”"
        for i, (where, q) in enumerate(problems[:MAX_LISTED], 1)
    )
    if len(problems) > MAX_LISTED:
        listed += f"\n(and {len(problems) - MAX_LISTED} more)"

    if count >= MAX_BLOCKS:
        try:
            os.remove(counter)
        except OSError:
            pass
        return {"systemMessage": f"{MARKER}: these quotations could not be matched to any "
                                 f"source text in this session; treat them as unverified.\n{listed}"}
    try:
        with open(counter, "w") as fh:
            fh.write(str(count + 1))
    except OSError:
        pass
    reason = (
        f"{MARKER}: your reply, or a file you wrote this turn, attributes words in quotation "
        "marks to a source, but no tool output in this session contains them verbatim. WebFetch and "
        "WebSearch results are summaries, not sources; neither is a file you wrote, nor a "
        "subagent's report.\n" + listed + "\n"
        "For each one: (a) fetch the exact text (lookup_by_citation with SYMBOL ¶N, "
        "search_paragraphs with the phrase in double quotes, or the official document "
        "downloaded with curl and searched with grep) and quote it word for word; or "
        "(b) drop the quotation marks and paraphrase; or (c) if you cannot check it, keep the "
        "quotation only with [unverified] on the same line. If it is your own proposed "
        "wording, not a quotation, show it without quotation marks (e.g. as a blockquote). "
        "Fix any file you wrote too, then give the corrected reply."
    )
    return {"decision": "block", "reason": reason}


def run_web_note(data):
    transcript = data.get("transcript_path") or ""
    if not transcript or not active(read_records(transcript)):
        return None
    tool = data.get("tool_name") or "WebFetch"
    note = (
        f"{MARKER}: this {tool} result is a summary written by a small model, not the page. "
        "Nothing in it is verbatim, including text in quotation marks. Before quoting, get the "
        "exact text: UNHRDB lookup_by_citation / search_paragraphs for UN documents, or download "
        "the page with curl and grep it. A reply that quotes five or more words with no verbatim "
        "match in raw tool output is sent back."
    )
    return {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": note}}


def main():
    if disabled():
        return
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return
    mode = sys.argv[1] if len(sys.argv) > 1 else "stop"
    out = run_web_note(data) if mode == "web-note" else run_stop(data)
    if out:
        print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # a hook bug must never break the session
        sys.stderr.write(f"{MARKER} error: {e}\n")
