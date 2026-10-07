import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveCurrentBusinessArtifact: vi.fn(),
}));

vi.mock("../dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("../../domains/ai_os/services/businessArtifactRegistry", () => ({
  registerAdStructureArtifact: vi.fn(),
  registerListingArtifact: vi.fn(),
  resolveCurrentBusinessArtifact: mocks.resolveCurrentBusinessArtifact,
}));

import { getActiveListingByProject, getListingById } from "./listingRepository";

const currentListing = {
  id: 401,
  projectId: 17,
  version: 4,
  isActive: 1,
  title: "Real approved Listing",
  bulletPoints: JSON.stringify([
    "one",
    "two",
    "candidate-applied",
    "four",
    "five",
  ]),
};

function activeListingDb(row = currentListing) {
  const limit = vi.fn().mockResolvedValue([row]);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, where, orderBy, limit };
}

describe("getActiveListingByProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the committed Listing row even when a stale listing.content Artifact exists", async () => {
    const db = activeListingDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.resolveCurrentBusinessArtifact.mockResolvedValue({
      content: {
        listing: {
          version: 3,
          title: "Stale artifact Listing",
          bulletPoints: JSON.stringify(["one", "two", "old", "four", "five"]),
        },
      },
    });

    await expect(getActiveListingByProject(17)).resolves.toEqual(
      currentListing
    );
    expect(mocks.resolveCurrentBusinessArtifact).not.toHaveBeenCalled();
  });

  it("returns the committed Listing row for a direct edit lookup without consulting stale projected content", async () => {
    const db = activeListingDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.resolveCurrentBusinessArtifact.mockResolvedValue({
      content: { listing: { version: 3, title: "Stale artifact Listing" } },
    });

    await expect(getListingById(401)).resolves.toEqual(currentListing);
    expect(mocks.resolveCurrentBusinessArtifact).not.toHaveBeenCalled();
  });
});
