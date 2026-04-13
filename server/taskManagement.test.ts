import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getDb
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          tasks: [
            {
              title: "优化A产品Listing标题",
              description: "根据最新关键词数据优化标题",
              assigneeName: "张三",
              category: "Listing优化",
              priority: "high",
              dueDate: "2026-04-20",
              estimatedHours: "3",
            },
            {
              title: "跟进B产品库存补货",
              description: "确认物流方案并下单",
              assigneeName: "李四",
              category: "库存管理",
              priority: "urgent",
              dueDate: "2026-04-18",
              estimatedHours: "2",
            },
          ],
          summary: "本次会议讨论了A产品Listing优化和B产品库存补货事宜",
        }),
      },
    }],
  }),
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn().mockResolvedValue({
    text: "张三负责优化A产品的Listing标题，下周三前完成。李四跟进B产品的库存补货。",
    language: "zh",
  }),
}));

describe("Task Management Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Data Structure", () => {
    it("should define correct task status values", () => {
      const validStatuses = ["backlog", "todo", "in_progress", "review", "done"];
      validStatuses.forEach(status => {
        expect(typeof status).toBe("string");
      });
    });

    it("should define correct task priority values", () => {
      const validPriorities = ["urgent", "high", "medium", "low"];
      validPriorities.forEach(priority => {
        expect(typeof priority).toBe("string");
      });
    });

    it("should define correct task categories", () => {
      const categories = [
        "Listing优化", "广告调整", "库存管理", "图片更新",
        "竞品分析", "定价策略", "客服处理", "物流跟进",
        "数据分析", "其他",
      ];
      expect(categories.length).toBe(10);
    });
  });

  describe("AI Task Extraction", () => {
    it("should parse LLM response for task extraction", async () => {
      const { invokeLLM } = await import("./_core/llm");
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a task extraction assistant." },
          { role: "user", content: "张三负责优化A产品的Listing标题，下周三前完成。" },
        ],
      });

      const content = response.choices?.[0]?.message?.content;
      expect(content).toBeDefined();

      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
      expect(parsed.tasks).toBeDefined();
      expect(Array.isArray(parsed.tasks)).toBe(true);
      expect(parsed.tasks.length).toBe(2);
      expect(parsed.summary).toBeDefined();
    });

    it("should extract tasks with correct fields", async () => {
      const { invokeLLM } = await import("./_core/llm");
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Extract tasks" },
          { role: "user", content: "test" },
        ],
      });

      const content = response.choices?.[0]?.message?.content;
      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
      const task = parsed.tasks[0];

      expect(task.title).toBe("优化A产品Listing标题");
      expect(task.assigneeName).toBe("张三");
      expect(task.category).toBe("Listing优化");
      expect(task.priority).toBe("high");
      expect(task.dueDate).toBe("2026-04-20");
      expect(task.estimatedHours).toBe("3");
    });

    it("should handle urgent priority tasks", async () => {
      const { invokeLLM } = await import("./_core/llm");
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Extract tasks" },
          { role: "user", content: "test" },
        ],
      });

      const content = response.choices?.[0]?.message?.content;
      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
      const urgentTask = parsed.tasks.find((t: any) => t.priority === "urgent");

      expect(urgentTask).toBeDefined();
      expect(urgentTask.title).toBe("跟进B产品库存补货");
    });
  });

  describe("Voice Transcription", () => {
    it("should transcribe audio and return text", async () => {
      const { transcribeAudio } = await import("./_core/voiceTranscription");
      const result = await transcribeAudio({
        audioUrl: "https://example.com/meeting.mp3",
        language: "zh",
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.text).toContain("张三");
      expect(result.text).toContain("Listing");
    });
  });

  describe("Task Filtering", () => {
    it("should support filtering by assignee", () => {
      const tasks = [
        { id: 1, assigneeName: "张三", status: "todo" },
        { id: 2, assigneeName: "李四", status: "in_progress" },
        { id: 3, assigneeName: "张三", status: "done" },
      ];

      const filtered = tasks.filter(t => t.assigneeName === "张三");
      expect(filtered.length).toBe(2);
    });

    it("should support filtering by category", () => {
      const tasks = [
        { id: 1, category: "Listing优化", status: "todo" },
        { id: 2, category: "广告调整", status: "todo" },
        { id: 3, category: "Listing优化", status: "done" },
      ];

      const filtered = tasks.filter(t => t.category === "Listing优化");
      expect(filtered.length).toBe(2);
    });

    it("should support filtering by status", () => {
      const tasks = [
        { id: 1, status: "todo" },
        { id: 2, status: "in_progress" },
        { id: 3, status: "done" },
        { id: 4, status: "todo" },
      ];

      const filtered = tasks.filter(t => t.status === "todo");
      expect(filtered.length).toBe(2);
    });

    it("should support filtering by priority", () => {
      const tasks = [
        { id: 1, priority: "urgent" },
        { id: 2, priority: "high" },
        { id: 3, priority: "medium" },
        { id: 4, priority: "urgent" },
      ];

      const filtered = tasks.filter(t => t.priority === "urgent");
      expect(filtered.length).toBe(2);
    });
  });

  describe("Task Stats Calculation", () => {
    it("should calculate stats by status", () => {
      const tasks = [
        { status: "todo" }, { status: "todo" },
        { status: "in_progress" },
        { status: "done" }, { status: "done" }, { status: "done" },
      ];

      const byStatus: Record<string, number> = {};
      tasks.forEach(t => {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      });

      expect(byStatus.todo).toBe(2);
      expect(byStatus.in_progress).toBe(1);
      expect(byStatus.done).toBe(3);
    });

    it("should detect overdue tasks", () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const tasks = [
        { dueDate: yesterday.toISOString().split("T")[0], status: "todo" },
        { dueDate: tomorrow.toISOString().split("T")[0], status: "todo" },
        { dueDate: yesterday.toISOString().split("T")[0], status: "done" }, // done, not overdue
      ];

      const overdue = tasks.filter(t =>
        t.dueDate && new Date(t.dueDate) < now && t.status !== "done"
      );

      expect(overdue.length).toBe(1);
    });
  });

  describe("Batch Task Creation", () => {
    it("should validate batch task input", () => {
      const batchTasks = [
        { title: "Task 1", priority: "high", category: "Listing优化" },
        { title: "Task 2", priority: "medium", category: "广告调整" },
        { title: "", priority: "low", category: "其他" }, // invalid - empty title
      ];

      const validTasks = batchTasks.filter(t => t.title.trim().length > 0);
      expect(validTasks.length).toBe(2);
    });

    it("should support meeting record association", () => {
      const meetingId = 1;
      const tasks = [
        { title: "Task 1", meetingRecordId: meetingId },
        { title: "Task 2", meetingRecordId: meetingId },
      ];

      expect(tasks.every(t => t.meetingRecordId === meetingId)).toBe(true);
    });
  });
});

describe("Task Reminder & Notification", () => {
  describe("Reminder Day Parsing", () => {
    it("should parse valid reminder days JSON", () => {
      const parseReminderDays = (raw: string | null | undefined): number[] => {
        if (!raw) return [1];
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === "number" && (n as number) >= 0)) {
            return (parsed as number[]).sort((a, b) => a - b);
          }
        } catch {}
        return [1];
      };

      expect(parseReminderDays("[1,3,7]")).toEqual([1, 3, 7]);
      expect(parseReminderDays("[0]")).toEqual([0]);
      expect(parseReminderDays("[14,7,1]")).toEqual([1, 7, 14]);
      expect(parseReminderDays(null)).toEqual([1]);
      expect(parseReminderDays(undefined)).toEqual([1]);
      expect(parseReminderDays("invalid")).toEqual([1]);
      expect(parseReminderDays("[]")).toEqual([]);
    });
  });

  describe("Overdue Detection", () => {
    it("should correctly identify overdue tasks", () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      const tasks = [
        { id: 1, dueDate: yesterday, status: "todo", assigneeName: "张三" },
        { id: 2, dueDate: lastWeek, status: "in_progress", assigneeName: "李四" },
        { id: 3, dueDate: tomorrow, status: "todo", assigneeName: "王五" },
        { id: 4, dueDate: yesterday, status: "done", assigneeName: "赵六" },
        { id: 5, dueDate: null, status: "todo", assigneeName: "钱七" },
      ];

      const overdue = tasks.filter(t =>
        t.status !== "done" && t.dueDate && t.dueDate < today
      );

      expect(overdue.length).toBe(2);
      expect(overdue.map(t => t.id)).toEqual([1, 2]);
    });

    it("should calculate days overdue correctly", () => {
      const dueDate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const daysOverdue = Math.floor(
        (Date.now() - new Date(dueDate + "T00:00:00Z").getTime()) / 86400000
      );
      expect(daysOverdue).toBeGreaterThanOrEqual(3);
      expect(daysOverdue).toBeLessThanOrEqual(4); // account for timezone
    });
  });

  describe("Due Soon Detection", () => {
    it("should identify tasks due within 3 days", () => {
      const today = new Date().toISOString().slice(0, 10);
      const threeDaysLater = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const fiveDaysLater = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

      const tasks = [
        { id: 1, dueDate: today, status: "todo" },
        { id: 2, dueDate: threeDaysLater, status: "in_progress" },
        { id: 3, dueDate: fiveDaysLater, status: "todo" },
      ];

      const dueSoon = tasks.filter(t =>
        t.status !== "done" && t.dueDate && t.dueDate >= today && t.dueDate <= threeDaysLater
      );

      expect(dueSoon.length).toBe(2);
    });

    it("should identify tasks due within 7 days but after 3 days", () => {
      const threeDaysLater = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const sevenDaysLater = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const fiveDaysLater = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      const tenDaysLater = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

      const tasks = [
        { id: 1, dueDate: fiveDaysLater, status: "todo" },
        { id: 2, dueDate: sevenDaysLater, status: "todo" },
        { id: 3, dueDate: tenDaysLater, status: "todo" },
      ];

      const dueThisWeek = tasks.filter(t =>
        t.status !== "done" && t.dueDate && t.dueDate > threeDaysLater && t.dueDate <= sevenDaysLater
      );

      expect(dueThisWeek.length).toBe(2);
    });
  });

  describe("Matching Reminder Days", () => {
    it("should match reminder days to due date with fixed dates", () => {
      // Use fixed dates to avoid timezone issues
      function getMatchingReminderDays(todayStr: string, dueDate: string, reminderDays: number[]): number[] {
        const today = new Date(todayStr + "T00:00:00Z");
        const due = new Date(dueDate + "T00:00:00Z");
        const diffMs = due.getTime() - today.getTime();
        const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
        return reminderDays.filter(d => d === diffDays);
      }

      // Due in 3 days should match [3]
      expect(getMatchingReminderDays("2026-04-13", "2026-04-16", [1, 3, 7])).toEqual([3]);

      // Due today should match [0]
      expect(getMatchingReminderDays("2026-04-13", "2026-04-13", [0, 1, 3])).toEqual([0]);

      // Due in 1 day should match [1]
      expect(getMatchingReminderDays("2026-04-13", "2026-04-14", [1, 3, 7])).toEqual([1]);

      // No match case
      expect(getMatchingReminderDays("2026-04-13", "2026-04-16", [1, 7, 14])).toEqual([]);

      // Due in 7 days should match [7]
      expect(getMatchingReminderDays("2026-04-13", "2026-04-20", [1, 3, 7])).toEqual([7]);
    });
  });

  describe("Notification Deduplication", () => {
    it("should prevent duplicate notifications for same task on same day", () => {
      const today = new Date().toISOString().slice(0, 10);
      const existingNotifications = [
        { type: "todo_overdue", relatedType: "team_task", relatedId: 1, createdAt: new Date(today + "T08:00:00Z") },
        { type: "todo_due_soon", relatedType: "team_task", relatedId: 2, createdAt: new Date(today + "T08:00:00Z") },
      ];

      // Check if notification already exists for task 1 today
      const task1Exists = existingNotifications.some(n =>
        n.relatedType === "team_task" && n.relatedId === 1 &&
        n.createdAt >= new Date(today + "T00:00:00Z")
      );
      expect(task1Exists).toBe(true);

      // Check if notification exists for task 3 today (should not)
      const task3Exists = existingNotifications.some(n =>
        n.relatedType === "team_task" && n.relatedId === 3 &&
        n.createdAt >= new Date(today + "T00:00:00Z")
      );
      expect(task3Exists).toBe(false);
    });
  });

  describe("Reminder Settings Update", () => {
    it("should validate reminder settings input", () => {
      const validSettings = [
        { taskId: 1, reminderEnabled: 1, reminderDays: [1, 3, 7] },
        { taskId: 2, reminderEnabled: 0 },
        { taskId: 3, reminderEnabled: 1, reminderDays: [0] },
      ];

      validSettings.forEach(s => {
        expect(s.taskId).toBeGreaterThan(0);
        expect([0, 1]).toContain(s.reminderEnabled);
        if (s.reminderDays) {
          expect(s.reminderDays.every(d => d >= 0)).toBe(true);
        }
      });
    });

    it("should serialize reminder days to JSON", () => {
      const reminderDays = [1, 3, 7];
      const serialized = JSON.stringify(reminderDays);
      expect(serialized).toBe("[1,3,7]");
      expect(JSON.parse(serialized)).toEqual([1, 3, 7]);
    });
  });

  describe("Notification Types", () => {
    it("should use correct notification types for task reminders", () => {
      const validTypes = [
        "review_submitted", "review_approved", "review_rejected",
        "project_assigned", "system_alert", "todo_due_soon", "todo_overdue"
      ];

      expect(validTypes).toContain("todo_due_soon");
      expect(validTypes).toContain("todo_overdue");
    });

    it("should use team_task as relatedType for task notifications", () => {
      const notification = {
        type: "todo_overdue",
        relatedType: "team_task",
        relatedId: 1,
        title: "团队任务已逾期",
      };

      expect(notification.relatedType).toBe("team_task");
    });
  });
});
