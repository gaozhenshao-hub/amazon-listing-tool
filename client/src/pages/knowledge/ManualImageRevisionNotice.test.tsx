// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ManualImageRevisionNotice from "./ManualImageRevisionNotice";
afterEach(cleanup);
const complete = { mode: "manual_revision", status: "verified", revisionVersion: 3, confirmedSnapshotId: 41, kept: 2, excluded: 3, total: 5 };
describe("manual image version source notice", () => {
  it("does not alter the default direct-ingestion presentation", () => { const { container } = render(<ManualImageRevisionNotice manual={false} coverage={complete} />); expect(container).toBeEmptyDOMElement(); });
  it("distinguishes human exclusion from download failures and preserves old images", () => {
    render(<ManualImageRevisionNotice manual coverage={complete} />);
    expect(screen.getByText(/人工确认修订 v3/)).toBeVisible(); expect(screen.getByText(/本修订保留 2 张，主动排除 3 张/)).toBeVisible();
    expect(screen.getByText(/此修订排除不删除旧版图片、标签或 AI 分析/)).toBeVisible();
  });
  it.each([undefined, null, { mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" }, { ...complete, kept: 1 }, { ...complete, secret: "do not echo" }])("unverified or malformed metadata is never a fake zero or partial direct import", coverage => {
    render(<ManualImageRevisionNotice manual coverage={coverage} />); expect(screen.getByText("人工版本覆盖范围暂不可核验")).toBeVisible();
    expect(screen.getByText(/暂不展示该版本图片/)).toBeVisible();
    expect(screen.queryByText(/本修订保留/)).toBeNull(); expect(screen.queryByText(/do not echo/)).toBeNull();
  });
});
