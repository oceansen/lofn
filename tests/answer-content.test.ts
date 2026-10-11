import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContent, contentToMarkdown } from "../lib/answer-content";
import { generateAccessCode, normalizeAccessCode, hashPassword, verifyPassword } from "../lib/security";
import { parseJsonLoose } from "../lib/ai/provider";

test("strips citations to contributions that don't exist", () => {
  const { content, warnings } = normalizeContent(
    { answer: "Safer crossings [C1][C42]. Lower speeds [C2] .", sections: { agreements: [{ text: "Crossings", refs: [1, 2, 99] }] } },
    new Set([1, 2]),
  );
  assert.equal(content.answer, "Safer crossings [C1]. Lower speeds [C2].");
  assert.deepEqual(content.sections.agreements[0].refs, [1, 2]);
  assert.deepEqual(content.refs, [1, 2]);
  assert.match(warnings[0], /C42/);
  assert.match(warnings[0], /C99/);
});

test("a single-source 'agreement' is demoted to an alternative perspective", () => {
  const { content } = normalizeContent({ answer: "x [C1]", sections: { agreements: [{ text: "Only one person said this", refs: [1] }] } }, new Set([1]));
  assert.equal(content.sections.agreements.length, 0);
  assert.equal(content.sections.alternatives[0].text, "Only one person said this");
});

test("tolerates string refs and missing sections", () => {
  const { content } = normalizeContent({ answer: "a", sections: { actions: [{ text: "Do it", refs: ["C3", "[C4]"] }] } }, new Set([3, 4]));
  assert.deepEqual(content.sections.actions[0].refs, [3, 4]);
  assert.deepEqual(content.sections.open_questions, []);
});

test("markdown export lists sections with refs", () => {
  const { content } = normalizeContent({ answer: "Answer [C1]", sections: { actions: [{ text: "Paint the crossing", refs: [1] }] } }, new Set([1]));
  assert.match(contentToMarkdown(content), /### Suggested actions\n\n- Paint the crossing \[C1\]/);
});

test("access codes are unambiguous and normalise from user input", () => {
  for (let i = 0; i < 200; i++) assert.match(generateAccessCode(), /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
  assert.equal(normalizeAccessCode(" k7qm 4xpa "), "K7QM-4XPA");
  assert.equal(normalizeAccessCode("K7QM-4XP"), null);
});

test("password hashing round-trips", () => {
  const h = hashPassword("correct horse battery");
  assert.ok(verifyPassword("correct horse battery", h));
  assert.ok(!verifyPassword("wrong", h));
});

test("parses JSON wrapped in prose or fences", () => {
  assert.deepEqual(parseJsonLoose('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('{"a":{"b":2}} trailing'), { a: { b: 2 } });
  assert.throws(() => parseJsonLoose("no json"));
});
