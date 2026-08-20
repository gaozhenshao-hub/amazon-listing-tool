import {
  assertForgeCapabilityAvailable,
  ForgeCapabilityUnavailableError,
  type ForgeCapability,
} from "../server/_core/forgeCapability";
import { transcribeAudio } from "../server/_core/voiceTranscription";

const capabilities: ForgeCapability[] = [
  "image_generation",
  "voice_transcription",
  "maps",
  "data_api",
  "heartbeat",
];

for (const capability of capabilities) {
  try {
    assertForgeCapabilityAvailable(capability);
    throw new Error(`${capability} unexpectedly reported as available`);
  } catch (error) {
    if (!(error instanceof ForgeCapabilityUnavailableError)) throw error;
    console.log(`${capability}=explicitly_unavailable`);
  }
}

const transcription = await transcribeAudio({
  audioUrl: "https://invalid.example.test/fixture.mp3",
  language: "en",
});
if (!("error" in transcription) || transcription.details !== "INDEPENDENT_CAPABILITY_UNAVAILABLE") {
  throw new Error("voice_transcription did not return the independent capability boundary");
}

console.log("voice_transcription_return=explicitly_unavailable");
process.exit(0);
