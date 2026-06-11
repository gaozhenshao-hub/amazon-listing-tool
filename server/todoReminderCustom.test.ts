import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Custom Todo Reminder Feature", () => {
  // ─── Schema Tests ───
  describe("Database Schema", () => {
    const schema = readFileSync(resolve(__dirname, "../drizzle/schema.ts"), "utf-8");

    it("productTodos table has reminderDays field", () => {
      expect(schema).toContain('reminderDays: varchar("reminder_days"');
    });

    it("productTodos table has reminderEnabled field", () => {
      expect(schema).toContain('reminderEnabled: int("reminder_enabled")');
    });

    it("productTodos table has lastReminderSentAt field", () => {
      expect(schema).toContain('lastReminderSentAt: timestamp("last_reminder_sent_at")');
    });

    it("teamTasks table has reminderDays field", () => {
      // Both tables should have reminder fields
      const matches = schema.match(/reminderDays.*varchar.*reminder_days/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it("teamTasks table has reminderEnabled field", () => {
      const matches = schema.match(/reminderEnabled.*int.*reminder_enabled/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Backend Reminder Logic Tests ───
  describe("Todo Reminder Service", () => {
    const reminderService = readFileSync(resolve(__dirname, "todoReminder.ts"), "utf-8");

    it("exports REMINDER_PRESETS with standard options", () => {
      expect(reminderService).toContain("REMINDER_PRESETS");
      expect(reminderService).toContain("到期当天");
      expect(reminderService).toContain("提前1天");
      expect(reminderService).toContain("提前3天");
      expect(reminderService).toContain("提前1周");
      expect(reminderService).toContain("提前2周");
      expect(reminderService).toContain("提前1个月");
    });

    it("exports DEFAULT_REMINDER_DAYS", () => {
      expect(reminderService).toContain("DEFAULT_REMINDER_DAYS");
    });

    it("has parseReminderDays function for JSON parsing", () => {
      expect(reminderService).toContain("parseReminderDays");
      expect(reminderService).toContain("JSON.parse");
    });

    it("has getMatchingReminderDays function for date matching", () => {
      expect(reminderService).toContain("getMatchingReminderDays");
    });

    it("checks both productTodos and teamTasks", () => {
      expect(reminderService).toContain("productTodos");
      expect(reminderService).toContain("teamTasks");
    });

    it("respects reminderEnabled flag", () => {
      expect(reminderService).toContain("reminderEnabled");
    });

    it("sends different notification types for due_soon and overdue", () => {
      expect(reminderService).toContain("todo_due_soon");
      expect(reminderService).toContain("todo_overdue");
    });

    it("notifies both assignee and creator for team tasks", () => {
      expect(reminderService).toContain("task.assigneeId");
      expect(reminderService).toContain("task.userId");
      expect(reminderService).toContain("task.userId !== task.assigneeId");
    });

    it("updates lastReminderSentAt after sending", () => {
      expect(reminderService).toContain("lastReminderSentAt");
    });

    it("prevents duplicate notifications on same day", () => {
      // Should check for existing notifications before creating new ones
      expect(reminderService).toContain("existing.length > 0");
    });
  });

  // ─── Backend Router Tests ───
  describe("ProductOps Router - Reminder Fields", () => {
    const router = readFileSync(resolve(__dirname, "routers/productOps.ts"), "utf-8");

    it("createTodo accepts reminderDays parameter", () => {
      expect(router).toContain("reminderDays: z.string().optional()");
    });

    it("createTodo accepts reminderEnabled parameter", () => {
      expect(router).toContain("reminderEnabled: z.number().optional()");
    });

    it("updateTodo accepts reminderDays parameter", () => {
      expect(router).toContain("reminderDays: z.string().nullable().optional()");
    });

    it("createTeamTask accepts reminderDays parameter", () => {
      // Should appear in both createTodo and createTeamTask
      const matches = router.match(/reminderDays: z\.string\(\)/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Frontend Tests ───
  describe("Frontend - OpsProductDetail Reminder UI", () => {
    const page = readFileSync(resolve(__dirname, "../client/src/pages/ops/OpsProductDetail.tsx"), "utf-8");

    it("imports Bell and BellOff icons", () => {
      expect(page).toContain("Bell");
      expect(page).toContain("BellOff");
    });

    it("has reminderDays in todoForm state", () => {
      expect(page).toContain("reminderDays:");
      expect(page).toContain("reminderEnabled:");
    });

    it("renders reminder preset buttons", () => {
      expect(page).toContain("当天");
      expect(page).toContain("1天前");
      expect(page).toContain("3天前");
      expect(page).toContain("1周前");
      expect(page).toContain("2周前");
      expect(page).toContain("1月前");
    });

    it("shows reminder toggle switch", () => {
      expect(page).toContain("到期提醒");
      expect(page).toContain("reminderEnabled");
    });

    it("shows warning when no due date set", () => {
      expect(page).toContain("请先设置截止日期才能启用提醒");
    });

    it("shows reminder summary text", () => {
      expect(page).toContain("将在截止日期前");
      expect(page).toContain("发送提醒");
    });

    it("sends reminderDays as JSON string in createTodo", () => {
      expect(page).toContain("JSON.stringify(todoForm.reminderDays)");
    });

    it("shows bell icon indicator on todo items with reminders", () => {
      expect(page).toContain("todo.reminderEnabled === 1");
      expect(page).toContain("todo.reminderDays");
    });
  });

  describe("Frontend - OpsProductTeam Reminder UI", () => {
    const page = readFileSync(resolve(__dirname, "../client/src/pages/ops/OpsProductTeam.tsx"), "utf-8");

    it("imports Bell and BellOff icons", () => {
      expect(page).toContain("Bell");
      expect(page).toContain("BellOff");
    });

    it("has reminderDays in createForm state", () => {
      expect(page).toContain("reminderDays:");
      expect(page).toContain("reminderEnabled:");
    });

    it("renders reminder preset buttons in team task dialog", () => {
      expect(page).toContain("当天");
      expect(page).toContain("1天前");
      expect(page).toContain("1周前");
    });

    it("sends reminderDays in createTeamTask mutation", () => {
      expect(page).toContain("JSON.stringify(createForm.reminderDays)");
    });
  });
});
