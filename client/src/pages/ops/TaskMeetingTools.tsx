import { MeetingDetailsFields } from "./MeetingDetailsFields";
import { useState } from "react";
import { MeetingRecorder } from "./MeetingRecorder";
import {
  CalendarDays,
  FileText,
  Plus,
  Sparkles,
  FlaskConical,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

import { MEETING_ROLES, readMeetingNotes } from "@shared/meetingNotes";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ProductTaskActions,
  type ProductTaskActionOwner,
} from "./ProductTaskActions";

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function OwnedMeetingTools({ owner }: { owner: ProductTaskActionOwner }) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(""),
    [participantIds, setParticipantIds] = useState<number[]>([]);
  const [offset, setOffset] = useState(0),
    [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false),
    [date, setDate] = useState(today),
    [text, setText] = useState("");
  const [error, setError] = useState("");
  const meetings = trpc.taskManagement.listMeetingRecords.useQuery(
    {
      limit: 10,
      offset,
    },
    { refetchInterval: 10000 }
  );
  const detail = trpc.taskManagement.getMeetingRecord.useQuery(
    { id: selectedId! },
    { enabled: selectedId !== null, refetchInterval: 10000 }
  );
  const save = trpc.taskManagement.saveMeetingNotes.useMutation({
    retry: false,
  });
  const analyze = trpc.taskManagement.analyzeMeetingNotes.useMutation({
    retry: false,
  });
  const resumeAudio = trpc.taskManagement.resumeMeetingAudio.useMutation({
    retry: false,
    onSuccess: () => {
      void detail.refetch();
      void meetings.refetch();
    },
    onError: e => setError(e.message),
  });
  const busy = save.isPending || analyze.isPending;
  const data = readMeetingNotes(detail.data?.extractedTasks);
  async function analyzeRecord(id: number, mode: "summary" | "tasks") {
    setError("");
    try {
      await analyze.mutateAsync({ id, mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "整理未完成，可稍后重试");
    } finally {
      await Promise.all([
        meetings.refetch(),
        utils.taskManagement.getMeetingRecord.invalidate({ id }),
      ]);
    }
  }
  async function saveRecord() {
    setError("");
    try {
      const result = await save.mutateAsync({
        date,
        text,
        title,
        participantIds,
      });
      setCreating(false);
      setText("");
      setTitle("");
      setParticipantIds([]);
      setSelectedId(result.id);
      setOffset(0);
      await meetings.refetch();
      await analyzeRecord(result.id, "summary");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "保存未完成，请保留原文并刷新确认后重试"
      );
    }
  }
  function sample() {
    setDate(today());
    setTitle("测试运营会");
    setParticipantIds([]);
    setText(
      "【测试会议，仅用于验证会议纪要与任务建议，不代表实际工作安排】\n议题一：洗衣机盖板 B0GFHHGC7Y。李宇航负责核对商品页面的尺寸说明，明天完成并反馈。\n议题二：充气沙发 B0GLMKM61J。张晨洋负责检查广告搜索词，下周一提交调整建议。\n议题三：本周需要整理包装破损情况，负责人和完成时间尚未确定；关联产品也需要进一步确认。\n会议决定：以上都是待核对的测试建议，正式任务必须经人工确认后保存。"
    );
    setError("");
    setCreating(true);
  }
  const status = (record: { status: string; extractedTasks: string | null }) =>
    ["uploading", "transcribing"].includes(record.status)
      ? "正在转写录音"
      : record.status === "extracting"
        ? "正在整理"
        : record.status === "error"
          ? "整理待重试"
          : readMeetingNotes(record.extractedTasks)?.summary
            ? "纪要已生成"
            : "待生成纪要";
  return (
    <section
      aria-label="运营会议记录"
      className="rounded-2xl border bg-card p-5 shadow-sm space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <FileText className="h-5 w-5 text-primary" />
            会议记录
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            保存会议原文，自动整理纪要，核对后将行动项加入任务看板。
          </p>
        </div>
        <div className="flex gap-2">
          <MeetingRecorder
            onUploaded={id => {
              setSelectedId(id);
              setOffset(0);
              void meetings.refetch();
            }}
          />
          <Button variant="outline" onClick={sample} disabled={busy}>
            <FlaskConical className="mr-2 h-4 w-4" />
            试用示例
          </Button>
          <Button
            onClick={() => {
              setDate(today());
              setText("");
              setTitle("");
              setParticipantIds([]);
              setError("");
              setCreating(true);
            }}
            disabled={busy}
          >
            <Plus className="mr-2 h-4 w-4" />
            新建会议记录
          </Button>
        </div>
      </div>
      {meetings.error && <p role="alert">会议列表暂时无法加载，请刷新重试。</p>}
      {meetings.isLoading ? (
        <p role="status">正在读取会议记录…</p>
      ) : !meetings.data?.length ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          还没有会议记录，点击右上角新建，或用示例体验。
        </div>
      ) : (
        <div className="divide-y rounded-xl border">
          {meetings.data.map(record => (
            <button
              key={record.id}
              onClick={() => {
                setError("");
                setSelectedId(record.id);
              }}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/50"
            >
              <span className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-muted-foreground" />
                <span>
                  <span className="block font-medium">
                    {record.title || "运营会议"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {readMeetingNotes(record.extractedTasks)?.date ||
                      new Date(record.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {readMeetingNotes(record.extractedTasks)
                      ?.participants?.map(member => member.name)
                      .join("、")}
                  </span>
                </span>
              </span>
              <span className="rounded-full bg-muted px-3 py-1 text-xs">
                {status(record)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void meetings.refetch()}
        >
          刷新会议列表
        </Button>
        {offset > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset - 10)}
          >
            上一页
          </Button>
        )}
        {meetings.data?.length === 10 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + 10)}
          >
            下一页
          </Button>
        )}
      </div>
      <Dialog
        open={creating}
        onOpenChange={value => {
          if (!busy) setCreating(value);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新建会议记录</DialogTitle>
            <DialogDescription>
              保存后自动生成会议纪要，原文会单独保留。
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-sm">
            会议日期
            <Input
              aria-label="会议日期"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              disabled={busy}
            />
          </label>
          <MeetingDetailsFields
            date={date}
            title={title}
            onTitleChange={setTitle}
            participantIds={participantIds}
            onParticipantsChange={setParticipantIds}
            disabled={busy}
          />
          <Textarea
            aria-label="会议原文"
            placeholder="粘贴或填写会议内容，包括讨论产品、负责人和完成时间…"
            rows={12}
            maxLength={18000}
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button
            onClick={() => void saveRecord()}
            disabled={
              busy || text.trim().length < 10 || !date || !participantIds.length
            }
          >
            {save.isPending ? "正在保存…" : "保存并生成会议纪要"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={selectedId !== null}
        onOpenChange={value => {
          if (!value && !busy) setSelectedId(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail.data?.title || "会议记录"}</DialogTitle>
            <DialogDescription>
              纪要与任务建议来自会议原文，正式任务需逐项确认。
            </DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <p role="status">正在读取会议…</p>
          ) : detail.error ? (
            <p role="alert">会议读取失败，请重新打开。</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                参会人员：
                {data?.participants?.map(member => member.name).join("、") ||
                  "历史会议未登记"}
              </p>
              {data?.audio && (
                <div className="rounded-xl border p-3 space-y-2">
                  <p className="text-sm font-medium">
                    会议录音 · Paraformer-v2
                  </p>
                  <audio
                    controls
                    preload="none"
                    src={`/api/meeting-audio/${selectedId}`}
                    className="w-full"
                  />
                  <a
                    className="text-sm text-primary underline"
                    href={`/api/meeting-audio/${selectedId}?download=1`}
                  >
                    下载原录音
                  </a>
                  {["uploading", "transcribing"].includes(
                    detail.data?.status || ""
                  ) && (
                    <p role="status" className="text-sm text-muted-foreground">
                      录音已保存，正在转写并整理纪要，可以离开此页面，稍后回来查看。
                    </p>
                  )}
                  {detail.data?.errorMessage && (
                    <p role="alert" className="text-sm text-destructive">
                      {detail.data.errorMessage}
                    </p>
                  )}
                  {data.audio.state === "failed" &&
                    !detail.data?.transcript && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={resumeAudio.isPending}
                        onClick={() => resumeAudio.mutate({ id: selectedId! })}
                      >
                        继续语音识别
                      </Button>
                    )}
                </div>
              )}
              <section className="rounded-xl bg-muted/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">会议纪要</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      !detail.data?.transcript ||
                      detail.data?.status === "extracting"
                    }
                    onClick={() => void analyzeRecord(selectedId!, "summary")}
                  >
                    <Sparkles className="mr-1 h-4 w-4" />
                    {data?.summary ? "重新整理" : "生成纪要"}
                  </Button>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-7">
                  {data?.summary ||
                    (analyze.isPending
                      ? "正在整理会议纪要…"
                      : "尚未生成纪要。会议原文已保留，可点击重试。")}
                </p>
              </section>
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  查看会议原文
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7">
                  {detail.data?.transcript || "暂无文字记录"}
                </p>
              </details>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">待确认任务</h3>
                <Button
                  disabled={
                    busy ||
                    !!data?.tasksExtracted ||
                    !detail.data?.transcript ||
                    detail.data?.status === "extracting"
                  }
                  onClick={() => void analyzeRecord(selectedId!, "tasks")}
                >
                  {analyze.isPending
                    ? "正在整理…"
                    : data?.tasksExtracted
                      ? "任务已提取"
                      : "从会议记录提取任务"}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                自动匹配明确的负责人和产品；未提到的内容保留待完善，不会自动分配或创建任务。
              </p>
              {data?.tasksExtracted && !data.tasks.length && (
                <p>没有识别到明确的行动项。</p>
              )}
              {data?.tasks.map(task => (
                <article
                  key={task.operationId}
                  className="rounded-xl border p-4 space-y-2"
                >
                  <h4 className="font-medium">
                    {task.title || "待补充任务内容"}
                  </h4>
                  <p className="text-sm whitespace-pre-wrap">
                    {task.description}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    负责人：{task.assigneeName || "待完善"} · 完成时间：
                    {task.dueDate || "待完善"} · 产品：
                    {task.productHint || "待确认"}
                  </p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      查看原文依据
                    </summary>
                    <blockquote className="mt-2 border-l-2 pl-3">
                      {task.evidence}
                    </blockquote>
                  </details>
                  {task.taskId ? (
                    <p className="text-sm text-green-700">已加入任务看板</p>
                  ) : (
                    <ProductTaskActions
                      owner={owner}
                      initialTitle={task.title}
                      meetingSuggestion={{
                        ...task,
                        meetingId: selectedId!,
                        suggestionId: task.operationId,
                        participantIds:
                          data.participants?.map(member => member.id) ?? [],
                      }}
                      onCreated={() => {
                        void detail.refetch();
                        void meetings.refetch();
                      }}
                    />
                  )}
                </article>
              ))}
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
export default function TaskMeetingTools() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || !MEETING_ROLES.includes(user.role) || !user.defaultWorkspaceId)
    return null;
  return (
    <OwnedMeetingTools
      key={`${user.id}:${user.defaultWorkspaceId}:${user.role}`}
      owner={{
        userId: user.id,
        workspaceId: user.defaultWorkspaceId,
        role: user.role,
      }}
    />
  );
}
