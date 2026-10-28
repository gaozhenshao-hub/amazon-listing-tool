import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { meetingTitle } from "@shared/meetingNotes";

export function MeetingDetailsFields({
  date,
  title,
  onTitleChange,
  participantIds,
  onParticipantsChange,
  disabled = false,
}: {
  date: string;
  title: string;
  onTitleChange: (value: string) => void;
  participantIds: number[];
  onParticipantsChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const members = trpc.taskManagement.meetingMembers.useQuery();
  const [search, setSearch] = useState("");
  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm">
        会议主题（选填）
        <Input
          aria-label="会议主题"
          value={title}
          maxLength={150}
          disabled={disabled}
          placeholder="留空时，根据会议内容自动命名"
          onChange={e => onTitleChange(e.target.value)}
        />
      </label>
      <p className="text-sm text-muted-foreground">
        会议名称：{meetingTitle(date, title)}
        {!title.trim() && "（记录完成后自动生成主题）"}
      </p>
      <fieldset disabled={disabled} className="rounded-xl border p-3 space-y-2">
        <legend className="px-1 text-sm font-medium">
          参会人员 · 已选 {participantIds.length} 人
        </legend>
        <Input
          aria-label="搜索参会人员"
          placeholder="搜索姓名"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {members.isLoading && (
          <p role="status" className="text-sm">
            正在加载人员…
          </p>
        )}
        {members.error && (
          <p role="alert" className="text-sm text-destructive">
            人员加载失败，请重新打开。
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
          {members.data
            ?.filter(m => (m.name || "").includes(search.trim()))
            .map(member => (
              <label
                key={member.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 text-sm ${participantIds.includes(member.id) ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
              >
                <input
                  type="checkbox"
                  checked={participantIds.includes(member.id)}
                  onChange={e =>
                    onParticipantsChange(
                      e.target.checked
                        ? [...participantIds, member.id]
                        : participantIds.filter(id => id !== member.id)
                    )
                  }
                />
                {member.name || "未填写姓名"}
              </label>
            ))}
        </div>
        <p className="text-xs text-muted-foreground">
          请选择实际参会人员；参会人员可查看会议，提取任务时优先匹配。
        </p>
      </fieldset>
    </div>
  );
}
