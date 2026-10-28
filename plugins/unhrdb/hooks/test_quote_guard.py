"""Tests for quote_guard.py. Run: python3 -m unittest plugins/unhrdb/hooks/test_quote_guard.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quote_guard.py")

GC36 = (
    "12. The Committee considers that the right to life is the supreme right [[fn:3]] "
    "from which no derogation is permitted, even in situations of armed conflict."
)


def tool_use(tid, name, inp=None):
    return {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": tid, "name": name, "input": inp or {}}]}}


def tool_result(tid, text):
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": tid, "content": [{"type": "text", "text": text}]}]}}


def prompt(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def reply(text):
    return {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "text", "text": text}]}}


LOOKUP = [tool_use("t1", "mcp__plugin_unhrdb_unhrdb__lookup_by_citation",
                   {"citation": "CCPR/C/GC/36 ¶12"}),
          tool_result("t1", GC36)]


class QuoteGuardTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.session_id = "test-" + os.path.basename(self.dir.name)
        self.transcript = os.path.join(self.dir.name, "session.jsonl")

    def tearDown(self):
        self.dir.cleanup()
        try:
            os.remove(os.path.join(tempfile.gettempdir(), f"unhrdb-quote-guard-{self.session_id}.count"))
        except OSError:
            pass

    def write(self, records, path=None):
        path = path or self.transcript
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            for r in records:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    def run_hook(self, mode="stop", **extra):
        data = {"transcript_path": self.transcript, "session_id": self.session_id, **extra}
        env = {k: v for k, v in os.environ.items() if k != "UNHRDB_QUOTE_GUARD"}
        p =subprocess.run([sys.executable, "-I", HOOK, mode], input=json.dumps(data),
                           capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(p.stderr, "")
        return json.loads(p.stdout) if p.stdout.strip() else None

    def check(self, records, **extra):
        self.write(records)
        return self.run_hook(**extra)

    # --- passes

    def test_verbatim_quote_passes(self):
        out = self.check([prompt("What does GC 36 say?"), *LOOKUP,
                          reply('GC 36 calls it "the supreme right from which no derogation is permitted".')])
        self.assertIsNone(out)

    def test_footnote_marker_and_case_ignored(self):
        out = self.check([prompt("q"), *LOOKUP,
                          reply("CCPR/C/GC/36 ¶12: “The right to life is the supreme right from which no derogation”")])
        self.assertIsNone(out)

    def test_ellipsis_and_bracketed_alteration(self):
        out = self.check([prompt("q"), *LOOKUP, reply(
            "In ¶12 the Committee holds that “[t]he right to life is the supreme right … even in "
            "situations of armed conflict”.")])
        self.assertIsNone(out)

    def test_unverified_tag_skips(self):
        out = self.check([prompt("q"), *LOOKUP, reply(
            "Possibly ¶1: “every human being has the inherent right to life” [unverified].")])
        self.assertIsNone(out)

    def test_inactive_session_is_left_alone(self):
        out = self.check([prompt("q"), reply('GC 36 ¶3 says "this is entirely made up by the model".')])
        self.assertIsNone(out)

    def test_user_message_counts_as_source(self):
        out = self.check([prompt("My draft says: the State must protect life at all times."),
                          *LOOKUP, reply('Your draft cites ¶12 for "the State must protect life at all times".')])
        self.assertIsNone(out)

    def test_hand_added_connector_name(self):
        recs = [tool_use("t1", "mcp__5862801c-fc59__lookup_by_citation"), tool_result("t1", GC36)]
        out = self.check([prompt("q"), *recs, reply('¶12: "I invented this sentence about the Committee."')])
        self.assertEqual(out["decision"], "block")

    def test_saved_large_output_counts(self):
        saved = os.path.join(self.dir.name, "tool-results", "mcp-unhrdb-search_paragraphs-1.txt")
        os.makedirs(os.path.dirname(saved))
        with open(saved, "w", encoding="utf-8") as fh:
            fh.write("A/HRC/31/57 ¶20. States must refrain from any acts of torture whatsoever.")
        recs = [tool_use("t1", "mcp__unhrdb__search_paragraphs"), tool_result(
            "t1", f"Error: result exceeds maximum allowed tokens. Output has been saved to {saved}.\n"
                  "Format: Plain text")]
        out = self.check([prompt("q"), *recs, reply('A/HRC/31/57 ¶20: "States must refrain from any acts of torture"')])
        self.assertIsNone(out)

    def test_subagent_tool_output_counts(self):
        sub = os.path.join(self.dir.name, "session", "subagents", "agent-a1.jsonl")
        self.write([prompt('Parent prompt: "quote the treaty body on detention"'),
                    tool_use("s1", "mcp__unhrdb__search_paragraphs"),
                    tool_result("s1", "Arbitrary detention is prohibited in all circumstances, the Committee said.")],
                   path=sub)
        out = self.check([prompt("q"), *LOOKUP, tool_use("a1", "Agent"),
                          tool_result("a1", "Report: the Committee said it is never allowed."),
                          reply('See para. 8: "Arbitrary detention is prohibited in all circumstances"')])
        self.assertIsNone(out)

    def test_subagent_from_an_earlier_turn_is_not_read(self):
        sub = os.path.join(self.dir.name, "session", "subagents", "agent-old.jsonl")
        self.write([tool_use("s1", "mcp__unhrdb__search_paragraphs"),
                    tool_result("s1", "Arbitrary detention is prohibited in all circumstances, the Committee said.")],
                   path=sub)
        os.utime(sub, (1_000_000_000, 1_000_000_000))
        turn_start = {**prompt("q"), "timestamp": "2026-10-20T10:00:00.000Z"}
        out = self.check([turn_start, *LOOKUP, reply('See para. 8: "Arbitrary detention is prohibited in all circumstances"')])
        self.assertEqual(out["decision"], "block")

    def test_polish_and_oscola_quotes_pass_when_verbatim(self):
        out = self.check([prompt("q"), *LOOKUP, reply(
            "Komitet (GC 36 ¶12): „the supreme right from which no derogation is permitted”. "
            "OSCOLA: ‘no derogation is permitted, even in situations’.")])
        self.assertIsNone(out)

    def test_possessive_after_single_quote_passes(self):
        out = self.check([prompt("q"), *LOOKUP, reply(
            "GC 36 ¶12: ‘the right to life is the supreme right’ frames the States’ core duties.")])
        self.assertIsNone(out)

    def test_code_is_ignored(self):
        out = self.check([prompt("q"), *LOOKUP, reply('Run `grep "a phrase that is not anywhere at all"`.')])
        self.assertIsNone(out)

    # --- blocks

    def test_fabricated_quote_blocks(self):
        out = self.check([prompt("q"), *LOOKUP, reply(
            'GC 36 says that "the right to life must be interpreted broadly in every case".')])
        self.assertEqual(out["decision"], "block")
        self.assertIn("interpreted broadly", out["reason"])

    def test_web_summary_is_not_a_source(self):
        recs = [tool_use("w1", "WebFetch", {"url": "https://docs.un.org"}),
                tool_result("w1", 'The page says "States shall ensure effective remedies for victims".')]
        out = self.check([prompt("q"), *LOOKUP, *recs, reply('E/C.12/GC/14 ¶59: "States shall ensure effective remedies for victims"')])
        self.assertEqual(out["decision"], "block")

    def test_subagent_report_is_not_a_source(self):
        recs = [tool_use("a1", "Agent"), tool_result("a1", 'Found: "the Committee requires prompt and impartial investigation".')]
        out = self.check([prompt("q"), *LOOKUP, *recs, reply('GC 31 ¶15: "the Committee requires prompt and impartial investigation"')])
        self.assertEqual(out["decision"], "block")

    def test_reading_own_file_is_not_a_source(self):
        path = os.path.join(self.dir.name, "memo.md")
        recs = [tool_use("w1", "Write", {"file_path": path, "content": "x"}), tool_result("w1", "ok"),
                tool_use("r1", "Read", {"file_path": path}),
                tool_result("r1", "1\tThe Committee firmly rejected every reservation to article six.")]
        out = self.check([prompt("q"), *LOOKUP, *recs,
                          reply('GC 24 ¶8: "The Committee firmly rejected every reservation to article six."')])
        self.assertEqual(out["decision"], "block")

    def test_oscola_single_quotes_checked(self):
        out = self.check([prompt("q"), *LOOKUP, reply("In Toonen v. Australia the Committee held that ‘States’ duties never lapse in wartime’.")])
        self.assertEqual(out["decision"], "block")

    def test_blockquote_without_quotation_marks_is_proposed_wording(self):
        out = self.check([prompt("q"), *LOOKUP, reply("> The Committee will always prefer the broadest reading [GC36 ¶12].")])
        self.assertIsNone(out)

    def test_unattributed_quotation_marks_not_checked(self):
        out = self.check([prompt("q"), *LOOKUP, reply('The section "Scholarly opposition and how the models answer it" is new.')])
        self.assertIsNone(out)

    def test_citation_far_away_on_the_line_does_not_attribute(self):
        out = self.check([prompt("q"), *LOOKUP, reply(
            "GC 36 ¶12 matters. " + "x " * 120 + 'Then someone asks "how long did all of this actually take?"')])
        self.assertIsNone(out)

    def test_turn_without_connector_is_not_checked(self):
        out = self.check([prompt("q1"), *LOOKUP, reply("ok"), prompt("q2"),
                          reply('GC 36 ¶12: "the right to life must be interpreted broadly in every case"')])
        self.assertIsNone(out)

    def test_citation_inside_quotation_is_proposed_wording(self):
        out = self.check([prompt("q"), *LOOKUP, reply(
            'Insert "(as interpreted in General Comment No. 35, ¶3)" after the first clause.')])
        self.assertIsNone(out)

    def test_polish_quotation_not_checked(self):
        out = self.check([prompt("q"), *LOOKUP, reply(
            "GC 36 ¶12: „prawo do życia jest prawem najwyższym, od którego nie wolno odstąpić”.")])
        self.assertIsNone(out)

    def test_edited_user_file_counts_as_source(self):
        path = os.path.join(self.dir.name, "chapter3.md")
        recs = [tool_use("r1", "Read", {"file_path": path}),
                tool_result("r1", "1\tAttention detection does not by itself reconstruct the form of thought."),
                tool_use("e1", "Edit", {"file_path": path, "old_string": "a", "new_string": "b"}),
                tool_result("e1", "ok")]
        out = self.check([prompt("q"), *LOOKUP, *recs, reply(
            "§II.2 says “does not by itself reconstruct the form of thought”.")])
        self.assertIsNone(out)

    def test_file_written_this_turn_is_checked(self):
        path = os.path.join(self.dir.name, "report.md")
        out = self.check([prompt("q"), *LOOKUP,
                          tool_use("w1", "Write", {"file_path": path, "content":
                                   'Per ¶12, "derogation is permitted in a public emergency".'}),
                          tool_result("w1", "File created"), reply("Report written.")])
        self.assertEqual(out["decision"], "block")
        self.assertIn("[report.md]", out["reason"])

    def test_block_feedback_does_not_become_a_source(self):
        first = [prompt("q"), *LOOKUP, reply('¶12: "the right to life must be interpreted broadly in every case"')]
        out = self.check(first)
        feedback = {"type": "user", "isMeta": True, "message": {"role": "user", "content": out["reason"]}}
        plain = prompt(out["reason"])  # same text without metadata
        out2 = self.check(first + [feedback, plain, reply('¶12: "the right to life must be interpreted broadly in every case"')],
                          stop_hook_active=True)
        self.assertEqual(out2["decision"], "block")

    def test_loop_guard_lets_reply_through_with_warning(self):
        recs = [prompt("q"), *LOOKUP, reply('GC 36 ¶99: "a quotation that nobody ever wrote anywhere"')]
        self.assertEqual(self.check(recs)["decision"], "block")
        self.assertEqual(self.check(recs, stop_hook_active=True)["decision"], "block")
        out = self.check(recs, stop_hook_active=True)
        self.assertNotIn("decision", out)
        self.assertIn("unverified", out["systemMessage"])

    def test_last_assistant_message_from_input_wins(self):
        out = self.check([prompt("q"), *LOOKUP, reply("fine")],
                         last_assistant_message='CAT/C/GC/2 ¶3: "an invented sentence about torture and States"')
        self.assertEqual(out["decision"], "block")

    # --- web note and off switch

    def test_web_note(self):
        self.write([prompt("q"), *LOOKUP])
        out = self.run_hook("web-note", tool_name="WebFetch")
        self.assertIn("not the page", out["hookSpecificOutput"]["additionalContext"])

    def test_web_note_inactive(self):
        self.write([prompt("q")])
        self.assertIsNone(self.run_hook("web-note", tool_name="WebSearch"))

    def test_off_switch(self):
        self.write([prompt("q"), *LOOKUP, reply('GC 36 ¶99: "a quotation that nobody ever wrote anywhere"')])
        p = subprocess.run([sys.executable, "-I", HOOK, "stop"],
                           input=json.dumps({"transcript_path": self.transcript}),
                           capture_output=True, text=True,
                           env={**os.environ, "UNHRDB_QUOTE_GUARD": "off"})
        self.assertEqual(p.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
