// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import OperationsJournal from "./OperationsJournal";
import { journalToday, journalMonday, shiftJournalDate } from "@shared/operationsJournal";
const controls = vi.hoisted(() => ({ options: vi.fn(), read: vi.fn(), save: vi.fn(), client: {} as any }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: controls.client }) } }));
let saved: any[];
beforeEach(() => {
  vi.clearAllMocks(); saved = [];
  controls.client = { operationsJournal: { options: { query: controls.options }, read: { query: controls.read }, save: { mutate: controls.save } } };
  controls.options.mockResolvedValue({ members: [{ id: 3, name: "本人" }, { id: 4, name: "搭档" }] });
  controls.read.mockImplementation(async (input: any) => ({ ownerId: input.ownerId, canEdit: input.ownerId === 3, daily: saved.filter(r => r.content.kind === "daily" && r.date >= input.from && r.date <= input.to), weekly: saved.find(r => r.content.kind === "weekly" && r.date === input.week) ?? null }));
  controls.save.mockImplementation(async (input: any) => { const row = { date: input.date, revision: input.expectedRevision + 1, content: input.content, updatedAt: "2026-10-21" }; saved = [...saved.filter(r => r.date !== row.date || r.content.kind !== row.content.kind), row]; return row; });
});
afterEach(cleanup);
it("saves a daily report and reloads it on revisit", async () => {
  const view = render(<OperationsJournal userId={3} workspaceId={7} />);
  await screen.findByRole("button", { name: "编辑周计划" });
  fireEvent.click(screen.getAllByRole("button", { name: "填写日报" })[2]);
  fireEvent.change(screen.getByLabelText("今日完成"), { target: { value: "检查广告并调整预算" } });
  fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(controls.save).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 3, expectedRevision: 0, date: journalToday() }));
  view.unmount(); render(<OperationsJournal userId={3} workspaceId={7} />);
  expect(await screen.findByText("检查广告并调整预算")).toBeVisible();
});
it("moves the daily timeline and weekly period independently", async () => {
  render(<OperationsJournal userId={3} workspaceId={7} />); await screen.findByRole("button", { name: "编辑周计划" });
  fireEvent.click(screen.getByRole("button", { name: "查看更早日报" }));
  await waitFor(() => expect(controls.read).toHaveBeenLastCalledWith(expect.objectContaining({ to: shiftJournalDate(journalToday(), -3), week: journalMonday(journalToday()) }), expect.anything()));
  fireEvent.click(screen.getByRole("button", { name: "下一周计划" }));
  await waitFor(() => expect(controls.read).toHaveBeenLastCalledWith(expect.objectContaining({ to: shiftJournalDate(journalToday(), -3), week: shiftJournalDate(journalMonday(journalToday()), 7) }), expect.anything()));
});
it("saves all seven days and shows partner records as read only", async () => {
  render(<OperationsJournal userId={3} workspaceId={7} />); fireEvent.click(await screen.findByRole("button", { name: "编辑周计划" }));
  fireEvent.change(screen.getByLabelText("周日安排"), { target: { value: "周末复盘" } });
  fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("周末复盘")).toBeVisible();
  expect(controls.save.mock.calls[0][0].content.days).toHaveLength(7);
  fireEvent.change(screen.getByLabelText("运营"), { target: { value: "4" } });
  fireEvent.click((await screen.findAllByRole("button", { name: "查看日报" }))[0]);
  expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("今日完成")).toBeDisabled();
});
it("keeps the same request identity after uncertain save", async () => {
  controls.save.mockRejectedValueOnce(new Error("network"));
  render(<OperationsJournal userId={3} workspaceId={7} />); await screen.findByRole("button", { name: "编辑周计划" });
  fireEvent.click(screen.getAllByRole("button", { name: "填写日报" })[0]);
  fireEvent.change(screen.getByLabelText("今日完成"), { target: { value: "已完成" } });
  fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(controls.save).toHaveBeenCalledTimes(2));
  expect(controls.save.mock.calls[0][0]).toEqual(controls.save.mock.calls[1][0]);
});
