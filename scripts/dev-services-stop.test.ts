import { describe, expect, it, vi } from "vitest";
import { devReadyTimeoutMs, signalOwnedProcess, stopOwnedProcesses } from "./dev-services";

// A failed or interrupted start used to leave the API's Vite server, Worker runtime and Electron helpers
// running on Windows, holding their ports, because only the top process was signalled.
describe("stopping owned processes", () => {
  it("ends the whole tree on Windows, not only the top process", () => {
    const killProcess = vi.fn(() => true);
    const killTree = vi.fn();
    signalOwnedProcess({ pid: 4242, exitCode: null }, "SIGTERM", "win32", killProcess, "group", killTree);
    expect(killTree).toHaveBeenCalledWith(4242);
    expect(killProcess).not.toHaveBeenCalled();
  });

  it("leaves a child that this runner already reaped alone on Windows", () => {
    const killTree = vi.fn();
    signalOwnedProcess({ pid: 4242, exitCode: 0 }, "SIGTERM", "win32", vi.fn(), "group", killTree);
    expect(killTree).not.toHaveBeenCalled();
  });

  it("still signals the process group elsewhere", () => {
    const killProcess = vi.fn(() => true);
    const killTree = vi.fn();
    signalOwnedProcess({ pid: 4242, exitCode: null }, "SIGTERM", "linux", killProcess, "group", killTree);
    expect(killProcess).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(killTree).not.toHaveBeenCalled();
  });

  it("escalates through the same tree kill when a child outlives the first signal", async () => {
    const killTree = vi.fn();
    const child: { pid: number; exitCode: number | null } = { pid: 99, exitCode: null };
    await stopOwnedProcesses([child], "SIGTERM", {
      platform: "win32",
      killTree,
      timeoutMs: 10,
      pollIntervalMs: 5,
      wait: async () => undefined,
      now: (() => {
        let tick = 0;
        return () => (tick += 20);
      })(),
    });
    expect(killTree).toHaveBeenCalledTimes(2);
    expect(killTree).toHaveBeenNthCalledWith(1, 99);
    expect(killTree).toHaveBeenNthCalledWith(2, 99);
  });
});

describe("the readiness wait", () => {
  it("defaults to four minutes, because a first start bundles dependencies", () => {
    expect(devReadyTimeoutMs({})).toBe(240_000);
  });

  it("takes an override in milliseconds", () => {
    expect(devReadyTimeoutMs({ OPENBOT_DEV_READY_TIMEOUT_MS: "90000" })).toBe(90_000);
  });

  it("ignores a value that is not a number or is below the 30 s floor", () => {
    expect(devReadyTimeoutMs({ OPENBOT_DEV_READY_TIMEOUT_MS: "soon" })).toBe(240_000);
    expect(devReadyTimeoutMs({ OPENBOT_DEV_READY_TIMEOUT_MS: "5000" })).toBe(240_000);
  });
});
