// A4.T4: applyRetention (pure) + the thin GitHub API wire, stubbed fetch, zero real
// network calls — same convention as tests/integration/resend-adapter.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyRetention,
  backupStorageConfig,
  uploadBackup,
  listBackupReleases,
  deleteBackupRelease,
  type BackupRelease,
} from "@finnor/tools";

function releaseAt(id: number, isoDate: string): BackupRelease {
  return { id, tag: `backup-${isoDate}`, createdAt: `${isoDate}T00:00:00.000Z` };
}

describe("applyRetention (A4.T4 rule, pure)", () => {
  it("keeps every release when there are fewer than the daily cap", () => {
    const releases = [releaseAt(1, "2026-07-20"), releaseAt(2, "2026-07-21"), releaseAt(3, "2026-07-22")];
    const { deleteIds } = applyRetention(releases);
    expect(deleteIds).toHaveLength(0);
  });

  it("keeps the 14 newest days as daily slots; older-still days may additionally survive as weekly slots", () => {
    const releases = Array.from({ length: 20 }, (_, i) => releaseAt(i, `2026-07-${String(i + 1).padStart(2, "0")}`));
    const { keep, deleteIds } = applyRetention(releases);
    // The 14 most recent (07-07..07-20) always fill daily slots.
    const newest14 = releases.slice(6).map((r) => r.tag); // indices 6..19 -> 07-07..07-20
    for (const tag of newest14) expect(keep).toContain(tag);
    // The remaining 6 (07-01..07-06) span at most 2 distinct ISO weeks, so at most 2 of
    // them can additionally survive as weekly slots — never all 6, never zero coverage.
    expect(keep.length).toBeGreaterThanOrEqual(14);
    expect(keep.length).toBeLessThanOrEqual(16);
    expect(keep.length + deleteIds.length).toBe(releases.length);
  });

  it("collapses multiple same-day releases into one daily slot (newest wins), doesn't waste a slot per release", () => {
    const releases = [releaseAt(1, "2026-07-22"), releaseAt(2, "2026-07-22"), releaseAt(3, "2026-07-22")];
    const { keep, deleteIds } = applyRetention(releases);
    expect(keep).toHaveLength(1);
    expect(deleteIds).toHaveLength(2);
  });

  it("keeps weekly releases beyond the daily window, up to the weekly cap", () => {
    // 14 consecutive days (fills the daily window) + 8 more, each 7 days apart (distinct
    // ISO weeks) beyond that — all 8 should survive as weekly slots.
    const daily = Array.from({ length: 14 }, (_, i) => releaseAt(i, isoDateDaysAgo(i)));
    const weekly = Array.from({ length: 8 }, (_, i) => releaseAt(100 + i, isoDateDaysAgo(14 + i * 7)));
    const { keep, deleteIds } = applyRetention([...daily, ...weekly]);
    expect(keep).toHaveLength(22);
    expect(deleteIds).toHaveLength(0);
  });

  it("deletes anything past both the daily and weekly caps", () => {
    const daily = Array.from({ length: 14 }, (_, i) => releaseAt(i, isoDateDaysAgo(i)));
    const weekly = Array.from({ length: 8 }, (_, i) => releaseAt(100 + i, isoDateDaysAgo(14 + i * 7)));
    const tooOld = [releaseAt(999, isoDateDaysAgo(14 + 8 * 7 + 30))];
    const { deleteIds } = applyRetention([...daily, ...weekly, ...tooOld]);
    expect(deleteIds).toEqual([999]);
  });
});

function isoDateDaysAgo(days: number): string {
  const d = new Date("2026-07-22T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe("GitHub backup storage wire (stubbed fetch, zero real network calls)", () => {
  const cfg = { token: "test-token", repo: "param/finnor-db-backups" };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("backupStorageConfig returns null when unset, and the real values when set", () => {
    const prevToken = process.env.BACKUP_GITHUB_TOKEN;
    const prevRepo = process.env.BACKUP_GITHUB_REPO;
    delete process.env.BACKUP_GITHUB_TOKEN;
    delete process.env.BACKUP_GITHUB_REPO;
    expect(backupStorageConfig()).toBeNull();
    process.env.BACKUP_GITHUB_TOKEN = "x";
    process.env.BACKUP_GITHUB_REPO = "a/b";
    expect(backupStorageConfig()).toEqual({ token: "x", repo: "a/b" });
    if (prevToken === undefined) delete process.env.BACKUP_GITHUB_TOKEN;
    else process.env.BACKUP_GITHUB_TOKEN = prevToken;
    if (prevRepo === undefined) delete process.env.BACKUP_GITHUB_REPO;
    else process.env.BACKUP_GITHUB_REPO = prevRepo;
  });

  it("uploadBackup creates a release then uploads the asset to the returned upload_url, zero real calls", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42, upload_url: "https://uploads.github.com/repos/a/b/releases/42/assets{?name,label}" }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 }), { status: 201 }));

    const result = await uploadBackup(cfg, "backup-test", "dump.json.gz", Buffer.from("fake gzip bytes"));
    expect(result.releaseId).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [createUrl] = fetchMock.mock.calls[0]!;
    expect(String(createUrl)).toBe("https://api.github.com/repos/param/finnor-db-backups/releases");
    const [uploadUrl] = fetchMock.mock.calls[1]!;
    expect(String(uploadUrl)).toContain("name=dump.json.gz");
  });

  it("listBackupReleases filters to only backup- tagged releases", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: 1, tag_name: "backup-2026-07-22", created_at: "2026-07-22T00:00:00Z" },
          { id: 2, tag_name: "v1.0.0", created_at: "2026-07-01T00:00:00Z" },
        ]),
        { status: 200 },
      ),
    );
    const releases = await listBackupReleases(cfg);
    expect(releases).toHaveLength(1);
    expect(releases[0]!.tag).toBe("backup-2026-07-22");
  });

  it("deleteBackupRelease tolerates an already-deleted (404) release", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(deleteBackupRelease(cfg, 999)).resolves.toBeUndefined();
  });

  it("deleteBackupRelease throws on a real failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("server error", { status: 500 }));
    await expect(deleteBackupRelease(cfg, 1)).rejects.toThrow();
  });
});
