import assert from "node:assert/strict";
import test from "node:test";
import { groupWorkItems, urlForView, viewFromSearch } from "./App.js";
import type { WorkItem } from "../shared/contracts.js";

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

test("invalid deep links fall back to home", () => {
  for (const search of [
    "?view=file",
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

test("work view has a shareable route without file path", () => {
  assert.deepEqual(viewFromSearch("?view=work"), { kind: "work" });
  assert.equal(urlForView({ kind: "work" }, "https://workspace.lab/?path=old.md"), "/?view=work");
});

function workItem(id: string, status: string, project = "Demo"): WorkItem {
  return {
    id, project, status, title: id, nextAction: "Revisar", blocker: null, owner: null,
    updatedAt: "2026-09-16T12:00:00Z", sourcePath: "proyectos/demo/Docs/app/seguimiento/example.md",
    href: "?view=file&path=proyectos%2Fdemo%2FDocs%2Fapp%2Fseguimiento%2Fexample.md",
  };
}

test("board keeps managed statuses in fixed order and legacy documents outside managed columns", () => {
  const grouped = groupWorkItems([
    workItem("LEGACY-123", "unclassified"), workItem("DEMO-2", "blocked"),
    workItem("DEMO-1", "open"), workItem("DEMO-3", "done"),
  ]);
  assert.deepEqual(grouped.columns.map(({ status, label, items }) => [status, label, items.length]), [
    ["open", "Por hacer", 1], ["in_progress", "En curso", 0],
    ["blocked", "Bloqueado", 1], ["review", "En revisión", 0], ["done", "Hecho", 1],
  ]);
  assert.deepEqual(grouped.unclassified.map((item) => item.id), ["LEGACY-123"]);
  assert.equal(grouped.managed.length, 3);
  assert.deepEqual(grouped.lanes.map((lane) => [lane.status, lane.items.length]), [
    ["unclassified", 1], ["open", 1], ["in_progress", 0],
    ["blocked", 1], ["review", 0], ["done", 1],
  ]);
});

test("project filter applies to board and unclassified legacy documents", () => {
  const grouped = groupWorkItems([
    workItem("DEMO-1", "review", "Demo"), workItem("LEGACY-1", "unclassified", "Demo"),
    workItem("OTHER-1", "open", "Other"), workItem("CANDIDATE-2", "unclassified", "Other"),
  ], "Demo");
  assert.equal(grouped.selected.length, 2);
  assert.equal(grouped.columns.find((column) => column.status === "review")?.items.length, 1);
  assert.equal(grouped.columns.find((column) => column.status === "open")?.items.length, 0);
  assert.deepEqual(grouped.unclassified.map((item) => item.id), ["LEGACY-1"]);
});

test("seven legacy documents populate only Por clasificar, not Por hacer", () => {
  const grouped = groupWorkItems(Array.from({ length: 7 }, (_, index) => workItem(`LEGACY-${index + 1}`, "unclassified")));
  assert.equal(grouped.selected.length, 7);
  assert.equal(grouped.managed.length, 0);
  assert.equal(grouped.lanes[0].label, "Por clasificar");
  assert.equal(grouped.lanes[0].items.length, 7);
  assert.ok(grouped.lanes.slice(1).every((lane) => lane.items.length === 0));
});

test("candidate and legacy share Por clasificar without becoming open work", () => {
  const grouped = groupWorkItems([
    workItem("LEGACY-1", "unclassified"), workItem("CANDIDATE-1", "unclassified"),
    workItem("DEMO-1", "open"),
  ]);
  assert.deepEqual(grouped.lanes[0].items.map((item) => item.id), ["LEGACY-1", "CANDIDATE-1"]);
  assert.deepEqual(grouped.columns[0].items.map((item) => item.id), ["DEMO-1"]);
});
