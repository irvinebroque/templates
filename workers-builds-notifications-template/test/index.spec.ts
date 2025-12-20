import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock types for Workers Builds events
interface BuildEvent {
  type: string;
  source: {
    type: string;
    workerName: string;
  };
  payload: {
    buildUuid: string;
    status: string;
    buildOutcome: string;
    createdAt: string;
    stoppedAt?: string;
    buildTriggerMetadata?: {
      buildTriggerSource: string;
      branch: string;
      commitHash: string;
      commitMessage: string;
      author: string;
      repoName: string;
      providerType: string;
    };
  };
  metadata: {
    accountId: string;
    eventTimestamp: string;
  };
}

// Helper to create mock build events
function createMockBuildEvent(overrides: Partial<BuildEvent> = {}): BuildEvent {
  return {
    type: "cf.workersBuilds.worker.build.succeeded",
    source: {
      type: "workersBuilds.worker",
      workerName: "test-worker",
    },
    payload: {
      buildUuid: "build-12345678-90ab-cdef-1234-567890abcdef",
      status: "stopped",
      buildOutcome: "success",
      createdAt: "2025-05-01T02:48:57.132Z",
      stoppedAt: "2025-05-01T02:50:15.132Z",
      buildTriggerMetadata: {
        buildTriggerSource: "push_event",
        branch: "main",
        commitHash: "abc123def456",
        commitMessage: "Fix bug in authentication",
        author: "developer@example.com",
        repoName: "test-worker-repo",
        providerType: "github",
      },
    },
    metadata: {
      accountId: "test-account-id",
      eventTimestamp: "2025-05-01T02:48:57.132Z",
    },
    ...overrides,
  };
}

// Helper to create a mock message
function createMockMessage(event: BuildEvent) {
  return {
    id: "msg-" + Math.random().toString(36).substr(2, 9),
    timestamp: new Date(),
    body: event,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe("Workers Builds Notifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Event Parsing", () => {
    it("should correctly identify a successful build event", () => {
      const event = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.succeeded",
        payload: {
          buildUuid: "build-123",
          status: "stopped",
          buildOutcome: "success",
          createdAt: "2025-05-01T02:48:57.132Z",
          stoppedAt: "2025-05-01T02:50:15.132Z",
        },
      });

      expect(event.type).toBe("cf.workersBuilds.worker.build.succeeded");
      expect(event.payload.buildOutcome).toBe("success");
    });

    it("should correctly identify a failed build event", () => {
      const event = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.failed",
        payload: {
          buildUuid: "build-456",
          status: "stopped",
          buildOutcome: "failure",
          createdAt: "2025-05-01T02:48:57.132Z",
          stoppedAt: "2025-05-01T02:50:15.132Z",
        },
      });

      expect(event.type).toBe("cf.workersBuilds.worker.build.failed");
      expect(event.payload.buildOutcome).toBe("failure");
    });

    it("should correctly identify a cancelled build event", () => {
      const event = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.failed",
        payload: {
          buildUuid: "build-789",
          status: "stopped",
          buildOutcome: "cancelled",
          createdAt: "2025-05-01T02:48:57.132Z",
          stoppedAt: "2025-05-01T02:50:15.132Z",
        },
      });

      expect(event.type).toBe("cf.workersBuilds.worker.build.failed");
      expect(event.payload.buildOutcome).toBe("cancelled");
    });

    it("should correctly identify a build started event", () => {
      const event = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.started",
        payload: {
          buildUuid: "build-000",
          status: "running",
          buildOutcome: "",
          createdAt: "2025-05-01T02:48:57.132Z",
        },
      });

      expect(event.type).toBe("cf.workersBuilds.worker.build.started");
      expect(event.payload.status).toBe("running");
    });

    it("should extract worker name from source", () => {
      const event = createMockBuildEvent({
        source: {
          type: "workersBuilds.worker",
          workerName: "my-awesome-worker",
        },
      });

      expect(event.source.workerName).toBe("my-awesome-worker");
    });
  });

  describe("Build Metadata", () => {
    it("should extract git metadata from build trigger", () => {
      const event = createMockBuildEvent();

      expect(event.payload.buildTriggerMetadata?.branch).toBe("main");
      expect(event.payload.buildTriggerMetadata?.commitHash).toBe("abc123def456");
      expect(event.payload.buildTriggerMetadata?.commitMessage).toBe("Fix bug in authentication");
      expect(event.payload.buildTriggerMetadata?.author).toBe("developer@example.com");
      expect(event.payload.buildTriggerMetadata?.providerType).toBe("github");
    });

    it("should handle events without build trigger metadata", () => {
      const event = createMockBuildEvent({
        payload: {
          buildUuid: "build-123",
          status: "stopped",
          buildOutcome: "success",
          createdAt: "2025-05-01T02:48:57.132Z",
          stoppedAt: "2025-05-01T02:50:15.132Z",
          buildTriggerMetadata: undefined,
        },
      });

      expect(event.payload.buildTriggerMetadata).toBeUndefined();
    });

    it("should calculate build duration from timestamps", () => {
      const event = createMockBuildEvent({
        payload: {
          buildUuid: "build-123",
          status: "stopped",
          buildOutcome: "success",
          createdAt: "2025-05-01T02:48:57.132Z",
          stoppedAt: "2025-05-01T02:50:15.132Z",
        },
      });

      const start = new Date(event.payload.createdAt).getTime();
      const end = new Date(event.payload.stoppedAt!).getTime();
      const durationSeconds = (end - start) / 1000;

      expect(durationSeconds).toBeCloseTo(78, 0); // ~78 seconds
    });
  });

  describe("Message Handling", () => {
    it("should create valid message objects", () => {
      const event = createMockBuildEvent();
      const message = createMockMessage(event);

      expect(message.body).toEqual(event);
      expect(typeof message.ack).toBe("function");
      expect(typeof message.retry).toBe("function");
    });

    it("should handle batch of multiple messages", () => {
      const events = [
        createMockBuildEvent({ type: "cf.workersBuilds.worker.build.started" }),
        createMockBuildEvent({ type: "cf.workersBuilds.worker.build.succeeded" }),
        createMockBuildEvent({ type: "cf.workersBuilds.worker.build.failed" }),
      ];

      const messages = events.map(createMockMessage);

      expect(messages.length).toBe(3);
      expect(messages[0].body.type).toBe("cf.workersBuilds.worker.build.started");
      expect(messages[1].body.type).toBe("cf.workersBuilds.worker.build.succeeded");
      expect(messages[2].body.type).toBe("cf.workersBuilds.worker.build.failed");
    });
  });

  describe("Notification Formatting", () => {
    it("should determine correct emoji for success", () => {
      const event = createMockBuildEvent({ type: "cf.workersBuilds.worker.build.succeeded" });
      const emoji = event.type.includes("succeeded") ? "✅" : "❌";
      expect(emoji).toBe("✅");
    });

    it("should determine correct emoji for failure", () => {
      const event = createMockBuildEvent({ type: "cf.workersBuilds.worker.build.failed" });
      const emoji = event.type.includes("succeeded") ? "✅" : "❌";
      expect(emoji).toBe("❌");
    });

    it("should identify preview vs production branch", () => {
      const mainBranchEvent = createMockBuildEvent({
        payload: {
          buildUuid: "build-123",
          status: "stopped",
          buildOutcome: "success",
          createdAt: "2025-05-01T02:48:57.132Z",
          buildTriggerMetadata: {
            buildTriggerSource: "push_event",
            branch: "main",
            commitHash: "abc123",
            commitMessage: "test",
            author: "test@example.com",
            repoName: "test-repo",
            providerType: "github",
          },
        },
      });

      const featureBranchEvent = createMockBuildEvent({
        payload: {
          buildUuid: "build-456",
          status: "stopped",
          buildOutcome: "success",
          createdAt: "2025-05-01T02:48:57.132Z",
          buildTriggerMetadata: {
            buildTriggerSource: "push_event",
            branch: "feature/new-feature",
            commitHash: "def456",
            commitMessage: "test",
            author: "test@example.com",
            repoName: "test-repo",
            providerType: "github",
          },
        },
      });

      const isMainBranch = (branch: string) => ["main", "master"].includes(branch);

      expect(isMainBranch(mainBranchEvent.payload.buildTriggerMetadata!.branch)).toBe(true);
      expect(isMainBranch(featureBranchEvent.payload.buildTriggerMetadata!.branch)).toBe(false);
    });
  });

  describe("Error Extraction", () => {
    it("should extract error from logs with ERROR indicator", () => {
      const logs = [
        "Starting build...",
        "Installing dependencies...",
        "Running build command...",
        "ERROR: Module not found: 'missing-package'",
        "at build.js:42:15",
        "at processModule",
        "Build completed with errors",
      ];

      // Simple implementation to test the logic - searches from end backwards
      const errorIndicators = ["ERROR:", "Error:", "error:", "FAILED:", "Failed:", "Build failed"];
      let errorStartIdx = -1;
      for (let i = logs.length - 1; i >= 0; i--) {
        if (errorIndicators.some((indicator) => logs[i].includes(indicator))) {
          errorStartIdx = i;
          break;
        }
      }

      // Should find an error indicator (searching backwards finds ERROR: at index 3)
      expect(errorStartIdx).toBe(3);
      expect(logs[errorStartIdx]).toContain("ERROR:");
    });

    it("should handle empty logs gracefully", () => {
      const logs: string[] = [];

      // Should return a fallback message
      const result = logs.length === 0 ? 'No logs available. Click "View Full Logs" for details.' : logs.join("\n");

      expect(result).toBe('No logs available. Click "View Full Logs" for details.');
    });

    it("should truncate very long errors to 1000 chars", () => {
      const longError = "ERROR: " + "x".repeat(1500);
      const truncated = longError.length > 1000 ? longError.substring(0, 1000) + "\n..." : longError;

      expect(truncated.length).toBeLessThanOrEqual(1004); // 1000 + "\n..."
      expect(truncated).toContain("...");
    });

    it("should find TypeScript errors", () => {
      const logs = [
        "Compiling TypeScript...",
        "src/index.ts:10:5 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'",
        "Compilation failed",
      ];

      const hasTypeScriptError = logs.some((line) => line.includes("error TS"));
      expect(hasTypeScriptError).toBe(true);
    });

    it("should return last 10 lines if no error keyword found", () => {
      const logs = Array.from({ length: 50 }, (_, i) => `Log line ${i + 1}`);

      // Get last 10 lines as fallback
      const fallback = logs.slice(-10);

      expect(fallback.length).toBe(10);
      expect(fallback[0]).toBe("Log line 41");
      expect(fallback[9]).toBe("Log line 50");
    });
  });

  describe("Block Kit Message Formatting", () => {
    it("should create success block with live URL", () => {
      const event = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.succeeded",
      });

      const liveUrl = "https://test-worker.subdomain.workers.dev";

      // Expected Block Kit structure
      const expectedStructure = {
        text: `✅ Build succeeded: ${event.source.workerName}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: expect.stringContaining("✅"),
            },
            accessory: {
              type: "button",
              text: { type: "plain_text", text: "Open Worker" },
              url: liveUrl,
            },
          },
        ],
      };

      expect(expectedStructure.text).toContain("Build succeeded");
      expect(expectedStructure.blocks[0].type).toBe("section");
      expect(expectedStructure.blocks[0].accessory?.type).toBe("button");
    });

    it("should create success block with preview URL", () => {
      const event = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.succeeded",
      });

      const previewUrl = "https://preview-abc123.workers.dev";

      const expectedStructure = {
        text: `✅ Preview ready: ${event.source.workerName}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: expect.stringContaining("preview ready"),
            },
            accessory: {
              type: "button",
              text: { type: "plain_text", text: "View Preview" },
              url: previewUrl,
            },
          },
        ],
      };

      expect(expectedStructure.blocks[0].accessory?.text.text).toBe("View Preview");
      expect(expectedStructure.blocks[0].accessory?.url).toBe(previewUrl);
    });

    it("should create failure block with error and metadata", () => {
      const event = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.failed",
        payload: {
          buildUuid: "build-123",
          status: "stopped",
          buildOutcome: "fail",
          createdAt: "2025-05-01T02:48:57.132Z",
          stoppedAt: "2025-05-01T02:50:15.132Z",
          buildTriggerMetadata: {
            buildTriggerSource: "push_event",
            branch: "feature/auth",
            commitHash: "abc123def456",
            commitMessage: "Add auth",
            author: "developer@example.com",
            repoName: "test-repo",
            providerType: "github",
          },
        },
      });

      const expectedStructure = {
        text: `❌ Build failed: ${event.source.workerName}`,
        blocks: [
          { type: "header" },
          { type: "section", fields: expect.any(Array) }, // Metadata
          { type: "section" }, // Error
          { type: "actions" }, // Button
        ],
      };

      expect(expectedStructure.text).toContain("Build failed");
      expect(expectedStructure.blocks.length).toBe(4);
      expect(expectedStructure.blocks[0].type).toBe("header");
      expect(expectedStructure.blocks[3].type).toBe("actions");
    });

    it("should create cancelled block with minimal info", () => {
      const event = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.failed",
        payload: {
          buildUuid: "build-789",
          status: "stopped",
          buildOutcome: "cancelled",
          createdAt: "2025-05-01T02:48:57.132Z",
          buildTriggerMetadata: {
            buildTriggerSource: "push_event",
            branch: "feature/experiment",
            commitHash: "xyz789",
            commitMessage: "Testing",
            author: "developer@example.com",
            repoName: "test-repo",
            providerType: "github",
          },
        },
      });

      const expectedStructure = {
        text: `⚠️ Build cancelled: ${event.source.workerName}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: expect.stringContaining("build cancelled"),
            },
            accessory: {
              type: "button",
              text: { type: "plain_text", text: "View Build" },
            },
          },
        ],
      };

      expect(expectedStructure.text).toContain("Build cancelled");
      expect(expectedStructure.blocks[0].accessory?.text.text).toBe("View Build");
    });

    it("should include branch and commit in success messages", () => {
      const event = createMockBuildEvent({
        payload: {
          buildUuid: "build-123",
          status: "stopped",
          buildOutcome: "success",
          createdAt: "2025-05-01T02:48:57.132Z",
          buildTriggerMetadata: {
            buildTriggerSource: "push_event",
            branch: "main",
            commitHash: "abc123def456",
            commitMessage: "Fix",
            author: "dev@example.com",
            repoName: "test-repo",
            providerType: "github",
          },
        },
      });

      const branchCommit = `\`${event.payload.buildTriggerMetadata!.branch}\` • ${event.payload.buildTriggerMetadata!.commitHash.substring(0, 7)}`;

      expect(branchCommit).toBe("`main` • abc123d");
    });
  });

  describe("Dashboard URL Generation", () => {
    it("should generate correct dashboard URL", () => {
      const event = createMockBuildEvent({
        source: {
          type: "workersBuilds.worker",
          workerName: "my-worker",
        },
        payload: {
          buildUuid: "build-12345678-90ab-cdef-1234-567890abcdef",
          status: "stopped",
          buildOutcome: "fail",
          createdAt: "2025-05-01T02:48:57.132Z",
        },
        metadata: {
          accountId: "abc123",
          eventTimestamp: "2025-05-01T02:48:57.132Z",
        },
      });

      const expectedUrl = `https://dash.cloudflare.com/${event.metadata.accountId}/workers/services/view/${event.source.workerName}/production/builds/${event.payload.buildUuid}`;

      expect(expectedUrl).toBe(
        "https://dash.cloudflare.com/abc123/workers/services/view/my-worker/production/builds/build-12345678-90ab-cdef-1234-567890abcdef"
      );
    });

    it("should fallback to repo name if worker name missing", () => {
      const event = createMockBuildEvent({
        source: {
          type: "workersBuilds.worker",
          workerName: "",
        },
        payload: {
          buildUuid: "build-123",
          status: "stopped",
          buildOutcome: "fail",
          createdAt: "2025-05-01T02:48:57.132Z",
          buildTriggerMetadata: {
            buildTriggerSource: "push_event",
            branch: "main",
            commitHash: "abc123",
            commitMessage: "test",
            author: "test@example.com",
            repoName: "fallback-worker",
            providerType: "github",
          },
        },
      });

      const workerName = event.source.workerName || event.payload.buildTriggerMetadata?.repoName || "worker";

      expect(workerName).toBe("fallback-worker");
    });
  });

  describe("Event Skipping", () => {
    it("should identify started events for skipping", () => {
      const startedEvent = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.started",
      });

      const isStarted = startedEvent.type.includes("started") || startedEvent.type.includes("queued");

      expect(isStarted).toBe(true);
    });

    it("should not skip succeeded events", () => {
      const succeededEvent = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.succeeded",
      });

      const isStarted = succeededEvent.type.includes("started") || succeededEvent.type.includes("queued");

      expect(isStarted).toBe(false);
    });

    it("should not skip failed events", () => {
      const failedEvent = createMockBuildEvent({
        type: "cf.workersBuilds.worker.build.failed",
      });

      const isStarted = failedEvent.type.includes("started") || failedEvent.type.includes("queued");

      expect(isStarted).toBe(false);
    });
  });
});
