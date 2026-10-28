import assert from "node:assert/strict";
import test from "node:test";
import { urlForView, viewFromSearch } from "./App.js";

test("opens file and directory deep links using workspace-relative paths", () => {
  assert.deepEqual(
    viewFromSearch("?view=file&path=conocimiento%2Fmemory%2FEgo%2Fnota.md"),
    { kind: "file", path: "conocimiento/memory/Ego/nota.md" },
  );
  assert.deepEqual(
    viewFromSearch("?view=directory&path=proyectos%2Fserver"),
    { kind: "directory", path: "proyectos/server" },
  );
});

test("invalid and retired backlog links fall back to home", () => {
  for (const search of [
    "?view=file",
    "?view=work",
    "?view=other&path=proyectos",
    "?view=file&path=%2Fetc%2Fpasswd",
    "?view=file&path=proyectos%2F..%2Fsecret.md",
    "?view=file&path=proyectos%5Csecret.md",
    "?view=directory&path=proyectos%2F%2Fserver",
  ]) {
    assert.deepEqual(viewFromSearch(search), { kind: "home" }, search);
  }
});

test("navigation URL round-trips and removes route parameters on home", () => {
  const current = "https://workspace.lab/?source=home&view=file&path=old.md";
  const fileUrl = urlForView({ kind: "file", path: "conocimiento/memory/Ego/mi nota.md" }, current);
  assert.deepEqual(viewFromSearch(new URL(fileUrl, current).search), {
    kind: "file",
    path: "conocimiento/memory/Ego/mi nota.md",
  });
  assert.equal(urlForView({ kind: "home" }, current), "/?source=home");
});
