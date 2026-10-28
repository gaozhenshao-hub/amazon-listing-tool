export const meetingAudioLimit = 100 * 1024 * 1024;
export const meetingAudioSeconds = 2 * 60 * 60;
export const meetingAudioAccept = ".wav,.mp3,.m4a,.mp4,.aac,.ogg,.webm,.flac";
export type MeetingAudioState = {
  operationId: string;
  fileName: string;
  providerFileName: string;
  mime: string;
  bytes: number;
  sha256: string;
  state:
    | "queued"
    | "submitting"
    | "polling"
    | "transcribed"
    | "complete"
    | "failed"
    | "unknown";
  taskId?: string;
  providerId?: number;
  submittedAt?: number;
  leaseUntil?: number;
  token?: string;
  nextPollAt?: number;
  billableSeconds?: number;
};
