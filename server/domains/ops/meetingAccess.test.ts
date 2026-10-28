import { describe, it, expect } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { canReadMeeting, meetingReadCondition } from "./meetingAccess";
import { meetingParticipantIdsSchema } from "../../../shared/meetingNotes";

describe("meeting visibility", () => {
  const record = {
    userId: 1,
    extractedTasks: JSON.stringify({
      version: 2,
      date: "2026-10-22",
      tasks: [],
      participants: [{ id: 2, name: "运营乙" }],
    }),
  };
  it("allows administrators, authors and attendees but not other operators", () => {
    expect(canReadMeeting({ id: 9, role: "admin" }, record)).toBe(true);
    expect(canReadMeeting({ id: 1, role: "ops_specialist" }, record)).toBe(
      true
    );
    expect(canReadMeeting({ id: 2, role: "ops_specialist" }, record)).toBe(
      true
    );
    expect(canReadMeeting({ id: 3, role: "ops_manager" }, record)).toBe(false);
    expect(
      canReadMeeting(
        { id: 3, role: "ops_specialist" },
        { ...record, extractedTasks: "broken" }
      )
    ).toBe(false);
  });
  it("scopes all database reads before pagination including admin reads", () => {
    const dialect = new MySqlDialect();
    const admin = dialect.sqlToQuery(
      meetingReadCondition({ id: 1, role: "admin" }, 7)!
    );
    expect(admin.params).toEqual([7]);
    expect(admin.sql).toContain("workspaceId");
    const member = dialect.sqlToQuery(
      meetingReadCondition({ id: 2, role: "ops_specialist" }, 7)!
    );
    expect(member.params).toEqual([7, 2, 2]);
    expect(member.sql).toContain("$.participants");
    expect(member.sql).toContain("JSON_VALID");
  });
  it("requires at least one attendee and deduplicates IDs", () => {
    expect(meetingParticipantIdsSchema.safeParse([]).success).toBe(false);
    expect(meetingParticipantIdsSchema.parse([1, 1, 2])).toEqual([1, 2]);
    expect(meetingParticipantIdsSchema.safeParse([-1]).success).toBe(false);
  });
});
