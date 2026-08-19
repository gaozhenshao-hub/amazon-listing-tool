import { describe, expect, it } from "vitest";
import { resolveS3CompatibleEndpoints } from "./storage";

describe("OSS internal and browser presign endpoint routing", () => {
  it("uses the internal endpoint for service-side calls and public endpoint for browser presigned URLs", () => {
    expect(resolveS3CompatibleEndpoints(
      "https://oss-cn-hangzhou-internal.aliyuncs.com",
      "https://oss-cn-hangzhou.aliyuncs.com",
    )).toEqual({
      serverEndpoint: "https://oss-cn-hangzhou-internal.aliyuncs.com",
      presignEndpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    });
  });

  it("keeps existing S3-compatible installations working when no public endpoint override is configured", () => {
    expect(resolveS3CompatibleEndpoints("https://s3.example.test")).toEqual({
      serverEndpoint: "https://s3.example.test",
      presignEndpoint: "https://s3.example.test",
    });
  });
});
