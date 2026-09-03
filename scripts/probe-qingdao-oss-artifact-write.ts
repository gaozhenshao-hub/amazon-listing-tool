import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function requiredEnv(name: "S3_BUCKET" | "S3_REGION" | "S3_ENDPOINT" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少对象存储运行配置：${name}`);
  }
  return value;
}

function errorSummary(error: unknown) {
  const candidate = error as {
    Code?: unknown;
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };

  return {
    code: typeof candidate?.Code === "string" ? candidate.Code : null,
    name: typeof candidate?.name === "string" ? candidate.name : "UnknownError",
    httpStatusCode: typeof candidate?.$metadata?.httpStatusCode === "number"
      ? candidate.$metadata.httpStatusCode
      : null,
  };
}

async function main() {
  const bucket = requiredEnv("S3_BUCKET");
  const region = requiredEnv("S3_REGION");
  const endpoint = requiredEnv("S3_ENDPOINT");
  const accessKeyId = requiredEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("S3_SECRET_ACCESS_KEY");
  const key = `system-probes/oss-artifact-write/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.json`;
  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify({ probe: "artifact_write", version: 1 }),
      ContentType: "application/json",
    }));
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

    console.log(JSON.stringify({
      mode: "oss_artifact_write_probe",
      put: "success",
      head: "success",
      cleanup: "success",
    }));
  } catch (error) {
    console.log(JSON.stringify({
      mode: "oss_artifact_write_probe",
      result: "failed",
      error: errorSummary(error),
    }));
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
}

void main();
