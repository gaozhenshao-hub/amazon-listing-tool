import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const required = [
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const key = `deployment-verification/oss-e2e-${Date.now()}.txt`;
const body = "amz-listing-tool OSS e2e verification";
const options = {
  region: process.env.S3_REGION!,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
};
const serverClient = new S3Client({ ...options, endpoint: process.env.S3_ENDPOINT! });
const browserClient = new S3Client({ ...options, endpoint: process.env.S3_PUBLIC_ENDPOINT! });

async function main() {
  await serverClient.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: key,
    Body: body,
    ContentType: "text/plain; charset=utf-8",
  }));

  try {
    const url = await getSignedUrl(
      browserClient,
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }),
      { expiresIn: 60 },
    );
    const response = await fetch(url);
    const text = await response.text();
    if (!response.ok || text !== body) {
      throw new Error(`Presigned download verification failed: HTTP ${response.status}`);
    }
    console.log("oss_e2e=passed upload=server_endpoint download=public_presign cleanup=pending");
  } finally {
    await serverClient.send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
    }));
  }
}

void main();
