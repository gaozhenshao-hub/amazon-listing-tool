import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultDesignParams,
  DESIGN_IMAGE_MODEL,
  DESIGN_BANANA_MODEL,
  designParameterKeys,
  designReferenceLimit,
  designParamsSchema,
  designRequestSchema,
  sameDesignParams,
  changeDesignOption,
} from "../../../shared/designStudio";
const f = vi.hoisted(() => ({
  execute: vi.fn(),
  ownAsset: vi.fn(),
  ownConversation: vi.fn(),
  permission: vi.fn(),
  request: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
  chatRequest: vi.fn(),
}));
vi.mock("./repository", async original => ({
  ...(await original<any>()),
  execute: f.execute,
  ownAsset: f.ownAsset,
  ownConversation: f.ownConversation,
  transaction: (cb: any) => cb({}),
}));
vi.mock("../../repositories/auth/authRepository", () => ({
  getRolePermission: f.permission,
}));
vi.mock("./assets", () => ({
  assetDirectory: vi.fn().mockResolvedValue("/private/design"),
  assetBytes: vi.fn().mockResolvedValue(Buffer.from("image")),
  saveAsset: f.save,
}));
vi.mock("./provider", async original => ({
  ...(await original<any>()),
  designModel: vi.fn().mockResolvedValue({ id: 7, key: "test" }),
  providerRequest: f.request,
  downloadResult: f.download,
}));
vi.mock("./chatProvider", async original => ({
  ...(await original<any>()),
  designChatModel: vi.fn().mockResolvedValue({ id: 8, key: "chat-test" }),
  requestDesignChat: f.chatRequest,
}));
import { authorizeDesign, designRoleAllows } from "./access";
import {
  designGenerationPayload,
  designModel,
  parseProviderTaskId,
  resultUrls,
  ProviderRejected,
  unwrapProviderResponse,
} from "./provider";
import { recoveryStatus, runDesignStep } from "./worker";
import { designStudioRouter } from "./router";
import { parseDesignChatResponse } from "./chatProvider";
import { buildChatHistory, runDesignChatStep } from "./chatWorker";
import { collectChatReferences } from "./chatReferences";
import { assetBytes } from "./assets";
import sharp from "sharp";

it("compares persisted JSON parameters independently of MySQL key ordering", () => {
  const stored = Object.fromEntries(
    Object.entries(defaultDesignParams).sort(([a], [b]) => a.localeCompare(b))
  );
  expect(sameDesignParams(stored, defaultDesignParams)).toBe(true);
  expect(
    sameDesignParams({ ...stored, resolution: "4K" }, defaultDesignParams)
  ).toBe(false);
  expect(sameDesignParams({}, defaultDesignParams)).toBe(false);
});

const id = "11111111-1111-4111-8111-111111111111";
const user = {
  id: 2,
  role: "designer",
  status: "active",
  defaultWorkspaceId: 3,
};
const payload = {
  conversationId: id,
  requestId: "22222222-2222-4222-8222-222222222222",
  prompt: "一张蓝色杯子的白底图",
  params: defaultDesignParams,
  references: [],
};
const confirm = {
  conversationId: id,
  requestId: payload.requestId,
  planId: id,
};
const planTurn = {
  id,
  status: "succeeded",
  params: defaultDesignParams,
  plan: { ready: true, prompt: payload.prompt, referenceIds: [] },
};
const job = (status: string) => ({
  id,
  workspaceId: 3,
  userId: 2,
  status,
  params: defaultDesignParams,
  referenceIds: [],
  providerId: 7,
  providerTaskId: status === "running" ? "123" : null,
  prompt: payload.prompt,
  submittedAt: new Date(),
});
beforeEach(() => {
  vi.clearAllMocks();
  f.permission.mockResolvedValue(null);
  f.ownConversation.mockResolvedValue({ id, title: "新对话" });
  f.ownAsset.mockResolvedValue(undefined);
  f.save.mockResolvedValue({ id: "asset-one" });
  f.download.mockResolvedValue(Buffer.from("image"));
  f.execute.mockImplementation(async (q: string) => {
    if (
      q.startsWith("SELECT id FROM workspace_memberships") ||
      q.startsWith("SELECT id FROM users")
    )
      return [{ id: 2 }];
    if (
      q.startsWith("SELECT * FROM design_chat_turns") &&
      q.includes("FOR UPDATE")
    )
      return [planTurn];
    if (q.startsWith("SELECT")) return [];
    return { affectedRows: 1 };
  });
});
describe("input contracts", () => {
  it("accepts default image options", () =>
    expect(designParamsSchema.parse(defaultDesignParams)).toEqual(
      defaultDesignParams
    ));
  it("rejects mismatched automatic ratio/resolution", () =>
    expect(() =>
      designParamsSchema.parse({ ...defaultDesignParams, resolution: "auto" })
    ).toThrow());
  it("rejects duplicate reference IDs and excessive references", () => {
    expect(
      designRequestSchema.safeParse({ ...payload, references: [id, id] })
        .success
    ).toBe(false);
    expect(
      designRequestSchema.safeParse({
        ...payload,
        references: Array(17).fill(id),
      }).success
    ).toBe(false);
  });
  it("rejects blank prompts", () =>
    expect(
      designRequestSchema.safeParse({ ...payload, prompt: " " }).success
    ).toBe(false));
});
describe("permissions and isolation", () => {
  it("allows designers but not unrelated roles by default", () => {
    expect(designRoleAllows("designer", null, "edit")).toBe(true);
    expect(designRoleAllows("finance", null, "read")).toBe(false);
  });
  it("honors configured module denial and read-only overrides", () => {
    expect(designRoleAllows("designer", { modules: "[]" }, "read")).toBe(false);
    const permission = {
      modules: '["design"]',
      detailedPermissions: JSON.stringify([
        {
          moduleId: "design",
          operations: ["read"],
          subModules: [{ subModuleId: "design_images", operations: ["read"] }],
        },
      ]),
    };
    expect(designRoleAllows("designer", permission, "read")).toBe(true);
    expect(designRoleAllows("designer", permission, "edit")).toBe(false);
  });
  it("denies disabled users and missing membership", async () => {
    await expect(
      authorizeDesign({ ...user, status: "disabled" }, "read")
    ).rejects.toThrow("请先登录");
    f.execute.mockResolvedValue([]);
    await expect(authorizeDesign(user, "read")).rejects.toThrow("工作空间");
  });
  it("scopes history by workspace and owner", async () => {
    const caller = designStudioRouter.createCaller({ user } as any);
    await caller.history({ id });
    expect(f.ownConversation).toHaveBeenCalledWith(
      id,
      { workspaceId: 3, userId: 2 },
      undefined,
      false
    );
    expect(
      f.execute.mock.calls.some(
        ([q, values]) =>
          q.includes("FROM design_generations") &&
          values[1] === 3 &&
          values[2] === 2
      )
    ).toBe(true);
    f.ownConversation.mockResolvedValue(undefined);
    await expect(caller.history({ id })).rejects.toThrow("无权访问");
  });
  it("rejects other users' reference images", async () => {
    await expect(
      designStudioRouter
        .createCaller({ user } as any)
        .chat({ ...payload, references: [id] })
    ).rejects.toThrow("参考图不存在");
    expect(
      f.execute.mock.calls.some(([q]) =>
        q.startsWith("INSERT INTO design_generations")
      )
    ).toBe(false);
  });
  it("deduplicates retried submissions before creating a paid task", async () => {
    f.execute.mockImplementation(async (q: string) =>
      q.startsWith("SELECT id FROM design_generations")
        ? [{ id: "existing" }]
        : q.startsWith("SELECT")
          ? [{ id: 2 }]
          : { affectedRows: 1 }
    );
    const result = await designStudioRouter
      .createCaller({ user } as any)
      .generate(confirm);
    expect(result.id).toBe("existing");
    expect(f.execute.mock.calls.some(([q]) => q.startsWith("INSERT"))).toBe(
      false
    );
  });
  it("does not delete a running conversation", async () => {
    f.execute.mockImplementation(async (q: string) =>
      q.startsWith("SELECT") ? [{ id }] : { affectedRows: 1 }
    );
    await expect(
      designStudioRouter
        .createCaller({ user } as any)
        .remove({ id, kind: "conversation" })
    ).rejects.toThrow("等待");
  });
});
describe("chat and explicit confirmation", () => {
  const caller = () => designStudioRouter.createCaller({ user } as any);
  it("a chat message creates no image job, even when the user asks to generate", async () => {
    await caller().chat({ ...payload, prompt: "直接生成吧" });
    expect(
      f.execute.mock.calls.some(([q]) =>
        q.startsWith("INSERT INTO design_chat_turns")
      )
    ).toBe(true);
    expect(
      f.execute.mock.calls.some(([q]) =>
        q.startsWith("INSERT INTO design_generations")
      )
    ).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
  });
  it("rejects a stale or unfinished plan before any image submission", async () => {
    await expect(
      caller().generate({ ...confirm, planId: payload.requestId })
    ).rejects.toThrow("最新方案");
    expect(
      f.execute.mock.calls.some(([q]) =>
        q.startsWith("INSERT INTO design_generations")
      )
    ).toBe(false);
  });
  it("keeps stored plan fallback for clients without an edited draft", async () => {
    await caller().generate({
      ...confirm,
      prompt: "injected",
      references: [id],
    } as any);
    const insert = f.execute.mock.calls.find(([q]) =>
      q.startsWith("INSERT INTO design_generations")
    )!;
    expect(insert[1][5]).toBe(payload.prompt);
    expect(insert[1][7]).toBe("[]");
  });
  it("confirms edited prompt, parameters and replaced references and saves the accepted plan", async () => {
    f.ownAsset.mockResolvedValue({ bytes: 100 });
    const draft = {
      prompt: "修改为绿色横图",
      params: {
        ...defaultDesignParams,
        aspect_ratio: "16:9" as const,
        resolution: "1K" as const,
      },
      references: [id],
    };
    await caller().generate({ ...confirm, draft });
    const insert = f.execute.mock.calls.find(([q]) =>
      q.startsWith("INSERT INTO design_generations")
    )!;
    expect(insert[1][5]).toBe(draft.prompt);
    expect(JSON.parse(insert[1][6])).toEqual(draft.params);
    expect(JSON.parse(insert[1][7])).toEqual([id]);
    expect(f.ownAsset).toHaveBeenCalledWith(id, { workspaceId: 3, userId: 2 });
    const update = f.execute.mock.calls.find(([q]) =>
      q.startsWith("UPDATE design_chat_turns SET generationId")
    )!;
    expect(JSON.parse(update[1][1])).toEqual({
      ready: true,
      prompt: draft.prompt,
      promptTranslation: "",
      referenceIds: [id],
    });
  });
  it("clearing plan references is respected instead of inheriting the old ones", async () => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (q: string, ...rest: any[]) =>
      q.startsWith("SELECT * FROM design_chat_turns")
        ? [{ ...planTurn, plan: { ...planTurn.plan, referenceIds: [id] } }]
        : original(q, ...rest)
    );
    await caller().generate({
      ...confirm,
      draft: { prompt: payload.prompt, params: payload.params, references: [] },
    });
    const insert = f.execute.mock.calls.find(([q]) =>
      q.startsWith("INSERT INTO design_generations")
    )!;
    expect(insert[1][7]).toBe("[]");
    expect(f.ownAsset).not.toHaveBeenCalled();
  });
  it.each(["confirm", "direct"])(
    "%s rejects inaccessible references before creating image jobs",
    async mode => {
      const action =
        mode === "direct"
          ? caller().generateDirect({ ...payload, references: [id] })
          : caller().generate({
              ...confirm,
              draft: { ...payload, references: [id] },
            });
      await expect(action).rejects.toThrow("参考图不存在");
      expect(
        f.execute.mock.calls.some(([q]) =>
          q.startsWith("INSERT INTO design_generations")
        )
      ).toBe(false);
    }
  );
  it("direct generation creates only an image job without consulting GEM or old reference context", async () => {
    await caller().generateDirect(payload);
    const insert = f.execute.mock.calls.find(([q]) =>
      q.startsWith("INSERT INTO design_generations")
    )!;
    expect(insert[1][5]).toBe(payload.prompt);
    expect(insert[1][7]).toBe("[]");
    expect(
      f.execute.mock.calls.some(
        ([q]) =>
          q.startsWith("INSERT INTO design_chat_turns") ||
          q.startsWith("SELECT referenceIds")
      )
    ).toBe(false);
    expect(f.chatRequest).not.toHaveBeenCalled();
  });
  it("a retry of direct generation returns its existing image job", async () => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (q: string, ...rest: any[]) =>
      q.startsWith("SELECT id FROM design_generations")
        ? [{ id: "existing-direct" }]
        : original(q, ...rest)
    );
    expect(await caller().generateDirect(payload)).toEqual({
      id: "existing-direct",
    });
    expect(f.execute.mock.calls.some(([q]) => q.startsWith("INSERT"))).toBe(
      false
    );
  });
  it.each(["confirm", "direct"])(
    "%s enforces active image limits",
    async mode => {
      const original = f.execute.getMockImplementation()!;
      f.execute.mockImplementation(async (q: string, ...rest: any[]) =>
        q.startsWith("SELECT conversationId FROM design_generations")
          ? [{ conversationId: id }]
          : original(q, ...rest)
      );
      await expect(
        mode === "direct"
          ? caller().generateDirect(payload)
          : caller().generate(confirm)
      ).rejects.toThrow("正在生成");
      expect(f.execute.mock.calls.some(([q]) => q.startsWith("INSERT"))).toBe(
        false
      );
    }
  );
  it("read-only users cannot use direct generation", async () => {
    f.permission.mockResolvedValue({
      modules: '["design"]',
      detailedPermissions: JSON.stringify([
        {
          moduleId: "design",
          operations: ["read"],
          subModules: [{ subModuleId: "design_images", operations: ["read"] }],
        },
      ]),
    });
    await expect(caller().generateDirect(payload)).rejects.toThrow();
    expect(f.execute.mock.calls.some(([q]) => q.startsWith("INSERT"))).toBe(
      false
    );
  });
  it("keeps automatic ratio and resolution paired in both editors", () => {
    expect(
      changeDesignOption(defaultDesignParams, "resolution", "auto")
    ).toMatchObject({ resolution: "auto", aspect_ratio: "auto" });
    expect(
      changeDesignOption(
        { ...defaultDesignParams, resolution: "auto", aspect_ratio: "auto" },
        "aspect_ratio",
        "16:9"
      )
    ).toMatchObject({ resolution: "2K", aspect_ratio: "16:9" });
  });
  it("a second confirmation returns the existing generation despite a different request UUID", async () => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (q: string, ...rest: any[]) =>
      q.startsWith("SELECT * FROM design_chat_turns")
        ? [{ ...planTurn, generationId: "already-generated" }]
        : original(q, ...rest)
    );
    expect(await caller().generate(confirm)).toEqual({
      id: "already-generated",
    });
    expect(f.execute.mock.calls.some(([q]) => q.startsWith("INSERT"))).toBe(
      false
    );
  });
  it("keeps reference images for text-only follow-up messages", async () => {
    const original = f.execute.getMockImplementation()!;
    f.ownAsset.mockResolvedValue({ bytes: 100 });
    f.execute.mockImplementation(async (q: string, ...rest: any[]) =>
      q.startsWith("SELECT referenceIds")
        ? [{ referenceIds: [id] }]
        : original(q, ...rest)
    );
    await caller().chat(payload);
    const insert = f.execute.mock.calls.find(([q]) =>
      q.startsWith("INSERT INTO design_chat_turns")
    )!;
    expect(JSON.parse(insert[1][6])).toEqual([id]);
  });
  it("validates complete JSON, reference selection, and excludes hidden thinking", () => {
    const body = (plan: any) => ({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { text: "hidden", thought: true },
              { text: JSON.stringify(plan) },
            ],
          },
        },
      ],
    });
    const plan = {
      reply: "方案已整理，请确认",
      ready: true,
      prompt: "白底产品图",
      referenceIndexes: [1],
    };
    expect(parseDesignChatResponse(body(plan), [id]).plan.referenceIds).toEqual(
      [id]
    );
    expect(() => parseDesignChatResponse(body(plan), [])).toThrow();
    expect(() =>
      parseDesignChatResponse(body({ ...plan, prompt: "" }), [id])
    ).toThrow();
    expect(() =>
      parseDesignChatResponse(
        { candidates: [{ finishReason: "MAX_TOKENS" }] },
        []
      )
    ).toThrow();
  });
  it("never repeats a chat request interrupted during provider submission", async () => {
    f.execute.mockImplementation(async q =>
      q.startsWith("SELECT * FROM design_chat_turns")
        ? [{ id, status: "submitting" }]
        : { affectedRows: 1 }
    );
    await runDesignChatStep();
    expect(f.chatRequest).not.toHaveBeenCalled();
    expect(
      f.execute.mock.calls.some(([q]) => q.includes("status='failed'"))
    ).toBe(true);
  });
});
describe("provider boundaries and durable execution", () => {
  it("accepts the documented nested task creation envelope and flat status", () => {
    const created = {
      code: 200,
      msg: "任务创建成功",
      data: { task_id: 181134263, 任务ids: [181134263] },
    };
    expect(parseProviderTaskId(created)).toBe("181134263");
    expect(unwrapProviderResponse(created)).toEqual(created.data);
    const status = { task_id: 181134263, is_final: true, state: "success" };
    expect(unwrapProviderResponse(status)).toBe(status);
    expect(unwrapProviderResponse({ data: status })).toBe(status);
  });
  it("validates provider IDs and rejects private/untrusted image endpoints", () => {
    expect(parseProviderTaskId({ task_id: 123 })).toBe("123");
    expect(() => parseProviderTaskId({})).toThrow();
    for (const url of [
      "http://tos.lingkeai.vip/a.png",
      "https://127.0.0.1/a.png",
      "https://tos.lingkeai.vip.evil.test/a.png",
      "https://key@tos.lingkeai.vip/a.png",
    ])
      expect(() => resultUrls({ result_url: url })).toThrow();
    expect(
      resultUrls({
        result_urls: [
          "https://tos.lingkeai.vip/a.png",
          "https://tos.lingkeai.vip/a.png",
        ],
      })
    ).toHaveLength(1);
  });
  it("never re-submits an interrupted POST", async () => {
    f.execute.mockImplementation(async q =>
      q.startsWith("SELECT * FROM design_generations")
        ? [job("submitting")]
        : { affectedRows: 1 }
    );
    await runDesignStep();
    expect(f.request).not.toHaveBeenCalled();
    expect(recoveryStatus("submitting", null)).toBe("unknown");
    expect(
      f.execute.mock.calls.some(
        ([q, v]) => q.includes("status=?") && v[0] === "unknown"
      )
    ).toBe(true);
  });
  it("persists the provider task before polling", async () => {
    f.execute.mockImplementation(async q =>
      q.startsWith("SELECT * FROM design_generations")
        ? [job("queued")]
        : q.startsWith("SELECT id FROM users")
          ? [{ id: 2 }]
          : { affectedRows: 1 }
    );
    f.request.mockResolvedValue({ task_id: 123 });
    await runDesignStep();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request.mock.calls[0][1]).toBe("generate");
    expect(
      f.execute.mock.calls.some(
        ([q, v]) => q.includes("providerTaskId=?") && v[0] === "123"
      )
    ).toBe(true);
  });
  it("marks an ambiguous timeout unknown instead of resubmitting", async () => {
    f.execute.mockImplementation(async q =>
      q.startsWith("SELECT * FROM design_generations")
        ? [job("queued")]
        : q.startsWith("SELECT id FROM users")
          ? [{ id: 2 }]
          : { affectedRows: 1 }
    );
    f.request.mockRejectedValue(new Error("timeout"));
    await runDesignStep();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(
      f.execute.mock.calls.some(
        ([q, v]) => q.includes("status=?") && v[0] === "unknown"
      )
    ).toBe(true);
  });
  it("keeps a clear rejection distinct from an unknown result", async () => {
    f.execute.mockImplementation(async q =>
      q.startsWith("SELECT * FROM design_generations")
        ? [job("queued")]
        : q.startsWith("SELECT id FROM users")
          ? [{ id: 2 }]
          : { affectedRows: 1 }
    );
    f.request.mockRejectedValue(new ProviderRejected("额度不足"));
    await runDesignStep();
    expect(
      f.execute.mock.calls.some(
        ([q, v]) => q.includes("status=?") && v[0] === "failed"
      )
    ).toBe(true);
  });
  it("resumes a running job with GET and saves image privately before success", async () => {
    f.execute.mockImplementation(async q =>
      q.startsWith("SELECT * FROM design_generations")
        ? [job("running")]
        : { affectedRows: 1 }
    );
    f.request.mockResolvedValue({
      is_final: true,
      state: "success",
      result_url: "https://tos.lingkeai.vip/result.png",
    });
    await runDesignStep();
    expect(f.request.mock.calls[0][1]).toBe("status?task_id=123");
    expect(f.request.mock.calls[0]).toHaveLength(2);
    expect(f.save).toHaveBeenCalledWith(
      { workspaceId: 3, userId: 2 },
      expect.any(Buffer),
      expect.any(String),
      "generated"
    );
    expect(
      f.execute.mock.calls.some(([q]) => q.includes("status='succeeded'"))
    ).toBe(true);
  });
  it("retries saving results without starting another paid generation", async () => {
    f.execute.mockImplementation(async q =>
      q.startsWith("SELECT * FROM design_generations")
        ? [job("running")]
        : { affectedRows: 1 }
    );
    f.request.mockResolvedValue({
      is_final: true,
      state: "success",
      result_url: "https://tos.lingkeai.vip/result.png",
    });
    f.save.mockRejectedValue(new Error("disk full"));
    await runDesignStep();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(
      f.execute.mock.calls.some(([q]) => q.includes("status='succeeded'"))
    ).toBe(false);
    expect(
      f.execute.mock.calls.some(([q]) => q.includes("INTERVAL 15 SECOND"))
    ).toBe(true);
  });
});

describe("switchable image models", () => {
  const banana = {
    ...defaultDesignParams,
    model: DESIGN_BANANA_MODEL,
    thinking: "high" as const,
  };
  it("old saved parameters continue to use Image 2.5", () => {
    const { model, thinking, ...legacy } = defaultDesignParams;
    expect(designParamsSchema.parse(legacy)).toEqual(defaultDesignParams);
  });
  it("maps banana parameters without leaking Image 2.5 fields", () => {
    expect(
      designGenerationPayload("blue", banana, ["data:image/png;base64,a"])
    ).toEqual({
      model: DESIGN_BANANA_MODEL,
      prompt: "blue",
      params: {
        aspectRatio: "1:1",
        imageSize: "2K",
        thinkingLevel: "high",
        n: 1,
        web_search: false,
        images: ["data:image/png;base64,a"],
      },
    });
    expect(designGenerationPayload("blue", defaultDesignParams, [])).toEqual({
      model: DESIGN_IMAGE_MODEL,
      prompt: "blue",
      params: {
        version: "flare",
        aspect_ratio: "1:1",
        resolution: "2K",
        quality: "auto",
        background: "opaque",
      },
    });
  });
  it("normalizes incompatible model options and shows only supported controls", () => {
    expect(
      changeDesignOption(
        { ...defaultDesignParams, aspect_ratio: "auto", resolution: "auto" },
        "model",
        DESIGN_BANANA_MODEL
      )
    ).toMatchObject({ aspect_ratio: "1:1", resolution: "2K" });
    expect(
      changeDesignOption(
        { ...banana, aspect_ratio: "1:8" },
        "model",
        DESIGN_IMAGE_MODEL
      ).aspect_ratio
    ).toBe("1:1");
    expect(designParameterKeys(banana)).toEqual([
      "model",
      "count",
      "aspect_ratio",
      "resolution",
      "thinking",
    ]);
    expect(designReferenceLimit(banana)).toBe(14);
    expect(
      designParamsSchema.safeParse({ ...banana, aspect_ratio: "2:1" }).success
    ).toBe(false);
    expect(
      designParamsSchema.safeParse({
        ...defaultDesignParams,
        aspect_ratio: "1:8",
      }).success
    ).toBe(false);
  });
  it("rejects fifteen reference images for banana but accepts them for Image 2.5", () => {
    const references = Array.from(
      { length: 15 },
      (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`
    );
    expect(
      designRequestSchema.safeParse({ ...payload, params: banana, references })
        .success
    ).toBe(false);
    expect(
      designRequestSchema.safeParse({ ...payload, references }).success
    ).toBe(true);
  });
  it("selects banana credentials for direct submission", async () => {
    await designStudioRouter
      .createCaller({ user } as any)
      .generateDirect({ ...payload, params: banana });
    expect(designModel).toHaveBeenCalledWith(
      { workspaceId: 3, userId: 2 },
      undefined,
      DESIGN_BANANA_MODEL
    );
  });
  it("worker uses the persisted provider and selected model after selection changes elsewhere", async () => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (q: string, ...rest: any[]) =>
      q.startsWith("SELECT * FROM design_generations")
        ? [{ ...job("queued"), params: banana, providerId: 9 }]
        : original(q, ...rest)
    );
    f.request.mockResolvedValue({ task_id: 123 });
    await runDesignStep();
    expect(designModel).toHaveBeenCalledWith(
      { workspaceId: 3, userId: 2 },
      9,
      DESIGN_BANANA_MODEL
    );
    expect(f.request.mock.calls[0][2].model).toBe(DESIGN_BANANA_MODEL);
  });
  it("resolves the requested model key and rejects untrusted endpoints", async () => {
    const actual =
      await vi.importActual<typeof import("./provider")>("./provider");
    f.execute.mockResolvedValue([
      {
        id: 9,
        baseUrl: "https://api.lk888.ai/v1",
        apiKeyRef: "banana-test-key",
      },
    ]);
    expect(
      await actual.designModel(
        { workspaceId: 3, userId: 2 },
        9,
        DESIGN_BANANA_MODEL
      )
    ).toMatchObject({
      id: 9,
      key: "banana-test-key",
      modelId: DESIGN_BANANA_MODEL,
    });
    expect(f.execute.mock.calls.at(-1)?.[1]).toEqual([
      DESIGN_BANANA_MODEL,
      3,
      9,
    ]);
    f.execute.mockResolvedValue([
      { id: 9, baseUrl: "https://untrusted.example/v1", apiKeyRef: "test" },
    ]);
    await expect(
      actual.designModel({ workspaceId: 3, userId: 2 }, 9, DESIGN_BANANA_MODEL)
    ).rejects.toThrow("配置");
  });
});

describe("multi-image batches", () => {
  const inserts = () =>
    f.execute.mock.calls.filter(([q]) =>
      q.startsWith("INSERT INTO design_generations")
    );
  it.each(["1", "2", "4", "8"] as const)(
    "queues %s independent images atomically with unchanged prompts and references",
    async count => {
      f.ownAsset.mockResolvedValue({ bytes: 100 });
      const result = await designStudioRouter
        .createCaller({ user } as any)
        .generateDirect({
          ...payload,
          params: { ...payload.params, count },
          references: [id],
        });
      expect(inserts()).toHaveLength(Number(count));
      expect(new Set(inserts().map(([, v]) => v[0])).size).toBe(Number(count));
      expect(new Set(inserts().map(([, v]) => v[4])).size).toBe(Number(count));
      expect(inserts()[0][1][0]).toBe(result.id);
      expect(inserts()[0][1][4]).toBe(payload.requestId);
      inserts().forEach(([, values], index) => {
        expect(values[5]).toBe(payload.prompt);
        expect(JSON.parse(values[7])).toEqual([id]);
        const params = JSON.parse(values[6]);
        expect(params.count).toBe("1");
        if (count !== "1")
          expect(params.batch).toEqual({
            id: result.id,
            index: index + 1,
            total: Number(count),
          });
        else expect(params.batch).toBeUndefined();
      });
      expect(f.request).not.toHaveBeenCalled();
    }
  );
  it("uses edited confirmation count and persists the batch selection", async () => {
    await designStudioRouter.createCaller({ user } as any).generate({
      ...confirm,
      draft: { ...payload, params: { ...payload.params, count: "4" } },
    });
    expect(inserts()).toHaveLength(4);
    const update = f.execute.mock.calls.find(([q]) =>
      q.startsWith("UPDATE design_chat_turns SET generationId")
    )!;
    expect(JSON.parse(update[1][2]).count).toBe("4");
  });
  it("allows a second batch when eight pending images belong to one other conversation", async () => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (q, ...rest) =>
      q.startsWith("SELECT conversationId FROM design_generations")
        ? Array.from({ length: 8 }, () => ({ conversationId: "other" }))
        : original(q, ...rest)
    );
    await designStudioRouter.createCaller({ user } as any).generateDirect({
      ...payload,
      params: { ...payload.params, count: "8" },
    });
    expect(inserts()).toHaveLength(8);
  });
  it("blocks a third active conversation", async () => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (q, ...rest) =>
      q.startsWith("SELECT conversationId FROM design_generations")
        ? [{ conversationId: "other" }, { conversationId: "another" }]
        : original(q, ...rest)
    );
    await expect(
      designStudioRouter.createCaller({ user } as any).generateDirect(payload)
    ).rejects.toThrow("已有两个");
    expect(inserts()).toHaveLength(0);
  });
  it("deduplicates the entire batch on repeated request ID", async () => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (q, ...rest) =>
      q.startsWith("SELECT id FROM design_generations")
        ? [{ id: "existing-batch" }]
        : original(q, ...rest)
    );
    const result = await designStudioRouter
      .createCaller({ user } as any)
      .generateDirect({
        ...payload,
        params: { ...payload.params, count: "8" },
      });
    expect(result.id).toBe("existing-batch");
    expect(inserts()).toHaveLength(0);
  });
  it("defaults old records to one and rejects unsupported image counts", () => {
    const { count, ...old } = defaultDesignParams;
    expect(designParamsSchema.parse(old).count).toBe("1");
    for (const count of ["0", "3", "9", "100", 8, null])
      expect(designParamsSchema.safeParse({ ...old, count }).success).toBe(
        false
      );
  });
  it("does not forward batch size to providers and multiply generation again", () => {
    const params = {
      ...defaultDesignParams,
      model: DESIGN_BANANA_MODEL,
      count: "8" as const,
    };
    expect(designGenerationPayload("cup", params, []).params).toMatchObject({
      n: 1,
    });
    expect(
      designGenerationPayload(
        "cup",
        { ...params, model: DESIGN_IMAGE_MODEL },
        []
      ).params
    ).not.toHaveProperty("count");
  });
});

describe("conversation-wide reference images and translated prompts", () => {
  const second = "33333333-3333-4333-8333-333333333333";
  const third = "44444444-4444-4444-8444-444444444444";
  const insertedChat = () =>
    f.execute.mock.calls.find(([q]) =>
      q.startsWith("INSERT INTO design_chat_turns")
    )![1];
  const withHistory = (rows: any[], image?: any) => {
    const original = f.execute.getMockImplementation()!;
    f.ownAsset.mockResolvedValue({ bytes: 100 });
    f.execute.mockImplementation(async (q, ...rest) =>
      q.startsWith("SELECT referenceIds")
        ? rows
        : q.startsWith("SELECT assetIds")
          ? image
            ? [image]
            : []
          : original(q, ...rest)
    );
  };
  it("recovers multiple images from existing conversations and appends new images without duplication", async () => {
    withHistory([{ referenceIds: [second] }, { referenceIds: [id] }]);
    await designStudioRouter
      .createCaller({ user } as any)
      .chat({ ...payload, references: [second, third] });
    expect(JSON.parse(insertedChat()[6])).toEqual([id, second, third]);
    expect(JSON.parse(insertedChat()[7]).chatNewReferenceIds).toEqual([
      second,
      third,
    ]);
    expect(f.ownAsset).toHaveBeenCalledWith(id, { userId: 2, workspaceId: 3 });
  });
  it("retains all images through text-only follow-ups", async () => {
    withHistory([{ referenceIds: [id, second] }, { referenceIds: [id] }]);
    await designStudioRouter.createCaller({ user } as any).chat(payload);
    expect(JSON.parse(insertedChat()[6])).toEqual([id, second]);
  });
  it("explicit reset can clear every reference, including a newer generated image", async () => {
    withHistory([{ referenceIds: [id], createdAt: "2026-01-01" }], {
      assetIds: [second],
      createdAt: "2026-01-02",
    });
    await designStudioRouter
      .createCaller({ user } as any)
      .chat({ ...payload, referenceMode: "replace" });
    expect(JSON.parse(insertedChat()[6])).toEqual([]);
    expect(JSON.parse(insertedChat()[7]).chatReferenceReset).toBe(true);
  });
  it("does not resurrect references before an explicit reset and includes confirmation-edited images", () => {
    expect(
      collectChatReferences(
        [
          {
            referenceIds: [second],
            params: { chatReferenceReset: true },
            plan: { referenceIds: [third] },
          },
          { referenceIds: [id] },
        ],
        [third]
      )
    ).toEqual([second, third]);
    expect(
      collectChatReferences([{ referenceIds: [id] }], [second], true)
    ).toEqual([second]);
  });
  it("rejects excessive combined references instead of silently dropping earlier images", async () => {
    withHistory([
      {
        referenceIds: Array.from(
          { length: 16 },
          (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`
        ),
      },
    ]);
    await expect(
      designStudioRouter
        .createCaller({ user } as any)
        .chat({ ...payload, references: [second] })
    ).rejects.toThrow("仅使用本次参考图");
    expect(f.chatRequest).not.toHaveBeenCalled();
    expect(f.execute.mock.calls.some(([q]) => q.startsWith("INSERT"))).toBe(
      false
    );
  });
  it("revalidates inherited ownership and total bytes", async () => {
    withHistory([{ referenceIds: [id, second] }]);
    f.ownAsset.mockResolvedValue(undefined);
    await expect(
      designStudioRouter.createCaller({ user } as any).chat(payload)
    ).rejects.toThrow("无权使用");
    withHistory([{ referenceIds: [id, second, third, payload.requestId] }]);
    f.ownAsset.mockResolvedValue({ bytes: 9 * 1024 * 1024 });
    await expect(
      designStudioRouter.createCaller({ user } as any).chat(payload)
    ).rejects.toThrow("30MB");
  });
  it("labels earlier uploads with their current shared image numbers", () => {
    const history = buildChatHistory(
      [
        {
          userText: "用这张图的结构",
          referenceIds: [second],
          params: { chatNewReferenceIds: [second] },
          plan: { referenceIds: [second] },
        },
      ],
      [id, second]
    );
    expect(history[0].parts[0].text).toContain("本次统一编号）：2");
    expect(JSON.parse(history[1].parts[0].text).planReferenceIndexes).toEqual([
      2,
    ]);
  });
  it("sends both image bytes to the vision model and persists the exact selected IDs and Chinese translation", async () => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (q, ...rest) =>
      q.startsWith("SELECT * FROM design_chat_turns")
        ? [
            {
              ...job("queued"),
              conversationId: id,
              userText: "两张一起参考",
              referenceIds: [id, second],
            },
          ]
        : original(q, ...rest)
    );
    f.ownAsset.mockResolvedValue({ bytes: 100 });
    vi.mocked(assetBytes)
      .mockResolvedValueOnce(
        await sharp({
          create: { width: 2, height: 2, channels: 3, background: "red" },
        })
          .png()
          .toBuffer()
      )
      .mockResolvedValueOnce(
        await sharp({
          create: { width: 2, height: 2, channels: 3, background: "blue" },
        })
          .png()
          .toBuffer()
      );
    f.chatRequest.mockResolvedValue({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: "已整理",
                  ready: true,
                  prompt: "Use both references. Keep the logo.",
                  promptTranslation: "同时参考两张图片，保留标志。",
                  referenceIndexes: [1, 2],
                }),
              },
            ],
          },
        },
      ],
    });
    await runDesignChatStep();
    const contents = f.chatRequest.mock.calls[0][1];
    const images = contents.at(-1).parts.filter((p: any) => p.inlineData);
    expect(images).toHaveLength(2);
    expect(images[0].inlineData.data).not.toEqual(images[1].inlineData.data);
    const result = f.execute.mock.calls.find(([q]) =>
      q.includes("status='succeeded',reply=")
    )!;
    expect(JSON.parse(result[1][1])).toMatchObject({
      referenceIds: [id, second],
      promptTranslation: "同时参考两张图片，保留标志。",
    });
  });
  it.each([false, true])(
    "preserves translation only when accepted prompt is unchanged (edited=%s)",
    async edited => {
      const original = f.execute.getMockImplementation()!;
      f.execute.mockImplementation(async (q, ...rest) =>
        q.startsWith("SELECT * FROM design_chat_turns")
          ? [
              {
                ...planTurn,
                params: { ...defaultDesignParams, chatReferenceReset: true },
                plan: { ...planTurn.plan, promptTranslation: "中文对照" },
              },
            ]
          : original(q, ...rest)
      );
      await designStudioRouter
        .createCaller({ user } as any)
        .generate({
          ...confirm,
          draft: {
            ...payload,
            prompt: edited ? "new English prompt" : payload.prompt,
          },
        });
      const saved = f.execute.mock.calls.find(([q]) =>
        q.startsWith("UPDATE design_chat_turns SET generationId")
      )!;
      expect(JSON.parse(saved[1][1]).promptTranslation).toBe(
        edited ? "" : "中文对照"
      );
      expect(JSON.parse(saved[1][2]).chatReferenceReset).toBe(true);
    }
  );
});
