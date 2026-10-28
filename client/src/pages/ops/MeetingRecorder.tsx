import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Upload, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  meetingAudioAccept,
  meetingAudioLimit,
  meetingAudioSeconds,
} from "@shared/meetingAudio";
import { MeetingDetailsFields } from "./MeetingDetailsFields";

export function MeetingRecorder({
  onUploaded,
}: {
  onUploaded: (id: number) => void;
}) {
  const [title, setTitle] = useState(""),
    [participantIds, setParticipantIds] = useState<number[]>([]);
  const [open, setOpen] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  );
  const [state, setState] = useState<
      "idle" | "starting" | "recording" | "paused"
    >("idle"),
    [seconds, setSeconds] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    mounted = useRef(true),
    operationId = useRef("");
  const config = trpc.taskManagement.meetingAudioStatus.useQuery(undefined, {
    enabled: open,
    refetchOnWindowFocus: true,
  });
  const recording = state !== "idle";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      stream.current?.getTracks().forEach(t => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);
  useEffect(() => {
    if (
      seconds >= meetingAudioSeconds &&
      recorder.current?.state !== "inactive"
    )
      recorder.current?.stop();
  }, [seconds]);
  useEffect(() => {
    if (!recording && !file && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording, file, busy]);
  async function start() {
    setError("");
    setState("starting");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw Error("当前浏览器不支持录音，请用 Chrome / Edge，或上传手机录音");
      const input = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (!mounted.current) {
        input.getTracks().forEach(t => t.stop());
        return;
      }
      stream.current = input;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find(t => MediaRecorder.isTypeSupported(t));
      const current = new MediaRecorder(input, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 64000,
      });
      recorder.current = current;
      const chunks: BlobPart[] = [];
      let bytes = 0;
      current.ondataavailable = e => {
        if (e.data.size) {
          chunks.push(e.data);
          bytes += e.data.size;
          if (
            bytes > meetingAudioLimit - 1024 * 1024 &&
            current.state !== "inactive"
          )
            current.stop();
        }
      };
      current.onerror = () => {
        if (mounted.current)
          setError("录音中断，已录制的部分会保留，请先下载备份");
        if (current.state !== "inactive") current.stop();
      };
      current.onstop = () => {
        input.getTracks().forEach(t => t.stop());
        if (!mounted.current) return;
        const type = current.mimeType || "audio/webm",
          extension = type.includes("mp4")
            ? "m4a"
            : type.includes("ogg")
              ? "ogg"
              : "webm";
        if (bytes) {
          setFile(new File(chunks, `会议录音.${extension}`, { type }));
          operationId.current = crypto.randomUUID();
        }
        setState("idle");
      };
      setSeconds(0);
      current.start(1000);
      setState("recording");
    } catch (e) {
      stream.current?.getTracks().forEach(t => t.stop());
      setState("idle");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "麦克风未授权，请允许浏览器使用麦克风，或上传已有录音"
          : e instanceof Error
            ? e.message
            : "无法启动录音"
      );
    }
  }
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!operationId.current) operationId.current = crypto.randomUUID();
      const body = new FormData();
      body.append("audio", file);
      const response = await fetch(
        `/api/meeting-audio/upload?date=${encodeURIComponent(date)}&operationId=${operationId.current}&title=${encodeURIComponent(title)}&participantIds=${encodeURIComponent(JSON.stringify(participantIds))}`,
        { method: "POST", body, credentials: "same-origin" }
      );
      const result = await response.json();
      if (!response.ok || !Number.isInteger(result.id))
        throw Error(
          result.error || "上传未完成，录音已在本页保留，可下载备份后重试"
        );
      setFile(null);
      setTitle("");
      setParticipantIds([]);
      setOpen(false);
      onUploaded(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传未完成，请保留录音并重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Mic className="mr-2 h-4 w-4" />
        录音 / 上传音频
      </Button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!recording && !busy) setOpen(value);
        }}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>录音会议</DialogTitle>
            <DialogDescription>
              结束录音后，自动转成文字并整理会议纪要。录音期间请保持此页面打开。
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm space-y-2">
            会议日期
            <Input
              aria-label="录音会议日期"
              type="date"
              value={date}
              disabled={busy || recording}
              onChange={e => setDate(e.target.value)}
            />
          </label>
          <MeetingDetailsFields
            date={date}
            title={title}
            onTitleChange={setTitle}
            participantIds={participantIds}
            onParticipantsChange={setParticipantIds}
            disabled={busy || recording}
          />
          {config.data?.configured === false && (
            <p className="rounded-lg bg-amber-50 text-amber-900 p-3 text-sm">
              请先到
              <a className="underline" href="/emperor/models">
                大模型管理
              </a>
              配置“会议语音识别 Paraformer-v2”。
            </p>
          )}
          <div className="rounded-xl bg-muted/50 p-5 text-center space-y-3">
            <p className="font-mono text-3xl tabular-nums" aria-live="off">
              {String(Math.floor(seconds / 3600)).padStart(2, "0")}:
              {String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")}
            </p>
            <p className="text-sm text-muted-foreground">
              {state === "recording"
                ? "正在录音…"
                : state === "paused"
                  ? "录音已暂停"
                  : file
                    ? "录音已准备好，可试听后上传"
                    : "单次最多两小时、100MB；更长会议请分段录制"}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {!recording ? (
                <Button
                  onClick={() => void start()}
                  disabled={busy || !!file || !participantIds.length}
                >
                  <Mic className="mr-2 h-4 w-4" />
                  开始录音
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    disabled={state === "starting"}
                    onClick={() => {
                      if (state === "recording") {
                        recorder.current?.pause();
                        setState("paused");
                      } else {
                        recorder.current?.resume();
                        setState("recording");
                      }
                    }}
                  >
                    {state === "paused" ? (
                      <Play className="mr-2 h-4 w-4" />
                    ) : (
                      <Pause className="mr-2 h-4 w-4" />
                    )}
                    {state === "paused" ? "继续录音" : "暂停"}
                  </Button>
                  <Button
                    disabled={state === "starting"}
                    onClick={() => recorder.current?.stop()}
                  >
                    <Square className="mr-2 h-4 w-4" />
                    结束录音
                  </Button>
                </>
              )}
              {!recording && (
                <label
                  className={`inline-flex cursor-pointer items-center rounded-md border bg-background px-4 text-sm ${busy ? "pointer-events-none opacity-50" : ""}`}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  选择音频
                  <input
                    aria-label="选择会议音频"
                    type="file"
                    className="sr-only"
                    accept={meetingAudioAccept}
                    disabled={busy}
                    onChange={e => {
                      const picked = e.target.files?.[0];
                      e.target.value = "";
                      if (!picked) return;
                      if (picked.size > meetingAudioLimit) {
                        setError("文件不能超过100MB");
                        return;
                      }
                      setError("");
                      setFile(picked);
                      setSeconds(0);
                      operationId.current = crypto.randomUUID();
                    }}
                  />
                </label>
              )}
            </div>
          </div>
          {file && (
            <div className="space-y-2">
              <p className="text-sm break-all">
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
              </p>
              <audio controls src={preview} className="w-full" />
              <div className="flex items-center gap-4 text-sm">
                <a
                  className="inline-flex items-center text-primary underline"
                  href={preview}
                  download={file.name}
                >
                  <Download className="mr-1 h-4 w-4" />
                  下载录音备份
                </a>
                <button
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    setSeconds(0);
                  }}
                  className="text-muted-foreground"
                >
                  重新选择 / 录制
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            disabled={
              !file ||
              busy ||
              recording ||
              !date ||
              !participantIds.length ||
              !config.data?.configured
            }
            onClick={() => void upload()}
          >
            {busy ? "正在上传并处理音频，请稍候…" : "上传并生成会议记录"}
          </Button>
          <p className="text-xs text-muted-foreground">
            上传后使用阿里云 Paraformer-v2
            识别，会议纪要另用文字模型整理。语音费用按百炼实际账单结算。
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
