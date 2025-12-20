/**
 * Cloudflare Workers Builds → Slack Notifications
 *
 * This worker consumes build events from a Cloudflare Queue and sends
 * notifications to Slack with:
 * - Preview/Live URLs for successful builds
 * - Full build logs for failed/cancelled builds
 *
 * @see https://developers.cloudflare.com/workers/ci-cd/builds
 * @see https://developers.cloudflare.com/queues/
 * @see https://developers.cloudflare.com/queues/event-subscriptions/
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface Env {
  /** Slack incoming webhook URL */
  SLACK_WEBHOOK_URL: string;
  /** Cloudflare API token with Workers Builds Configuration: Read permission */
  CLOUDFLARE_API_TOKEN: string;
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Cloudflare Workers Builds event structure
 * @see https://developers.cloudflare.com/workers/ci-cd/builds/events/
 */
interface CloudflareEvent {
  /** Event type (e.g., "cf.workersBuilds.worker.build.succeeded") */
  type: string;
  /** Event source information */
  source: {
    type: string;
    workerName?: string;
  };
  /** Build details */
  payload: {
    buildUuid: string;
    status: string;
    buildOutcome: 'success' | 'fail' | 'cancelled' | null;
    createdAt: string;
    initializingAt?: string;
    runningAt?: string;
    stoppedAt?: string;
    buildTriggerMetadata?: {
      buildTriggerSource: string;
      branch: string;
      commitHash: string;
      commitMessage: string;
      author: string;
      buildCommand: string;
      deployCommand: string;
      rootDirectory: string;
      repoName: string;
      providerAccountName: string;
      providerType: string;
    };
  };
  /** Event metadata */
  metadata: {
    accountId: string;
    eventSubscriptionId: string;
    eventSchemaVersion: number;
    eventTimestamp: string;
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract the relevant error from build logs (last ~10 lines with error context)
 * @param logs Array of log lines
 * @returns Error text or fallback
 */
function extractBuildError(logs: string[]): string {
  if (!logs || logs.length === 0) {
    return 'No logs available. Click "View Full Logs" for details.';
  }

  // Look at last 30 lines for errors (most errors appear at end)
  const lastLines = logs.slice(-30);

  // Common error indicators
  const errorIndicators = [
    'ERROR:',
    'Error:',
    'error:',
    'FAILED:',
    'Failed:',
    'failed:',
    'error TS',
    'SyntaxError',
    'ReferenceError',
    'Module not found',
    'Cannot find module',
    'Build failed',
    'Compilation failed',
  ];

  // Find first error line
  let errorStartIdx = -1;
  for (let i = lastLines.length - 1; i >= 0; i--) {
    if (errorIndicators.some((indicator) => lastLines[i].includes(indicator))) {
      errorStartIdx = i;
      break;
    }
  }

  if (errorStartIdx >= 0) {
    // Extract error + next 10 lines for context
    const errorLines = lastLines.slice(errorStartIdx, errorStartIdx + 10);
    const errorText = errorLines.join('\n').trim();

    // Limit to 1000 chars for Slack
    return errorText.length > 1000 ? errorText.substring(0, 1000) + '\n...' : errorText;
  }

  // Fallback: return last 10 lines
  const fallback = lastLines.slice(-10).join('\n').trim();
  return fallback || 'Build failed. Click "View Full Logs" for details.';
}

/**
 * Generate dashboard URL for build logs
 */
function getDashboardUrl(event: CloudflareEvent): string {
  const workerName =
    event.source.workerName || event.payload.buildTriggerMetadata?.repoName || 'worker';
  return `https://dash.cloudflare.com/${event.metadata.accountId}/workers/services/view/${workerName}/production/builds/${event.payload.buildUuid}`;
}

/**
 * Build Block Kit message based on event type
 */
function buildSlackBlocks(
  event: CloudflareEvent,
  previewUrl: string | null,
  liveUrl: string | null,
  logs: string[]
) {
  const workerName = event.source.workerName || 'Worker';
  const buildOutcome = event.payload.buildOutcome;
  const meta = event.payload.buildTriggerMetadata;

  const isCancelled = buildOutcome === 'cancelled';
  const isFailed = event.type.includes('failed') && !isCancelled;
  const isSucceeded = event.type.includes('succeeded');

  // Build branch + commit line
  const branchCommit = meta ? `\`${meta.branch}\` • ${meta.commitHash.substring(0, 7)}` : '';

  // Success: Production build
  if (isSucceeded && liveUrl) {
    return {
      text: `✅ Build succeeded: ${workerName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *${workerName}* deployed${branchCommit ? '\n' + branchCommit : ''}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'Open Worker' },
            url: liveUrl,
          },
        },
      ],
    };
  }

  // Success: Preview build
  if (isSucceeded && previewUrl) {
    return {
      text: `✅ Preview ready: ${workerName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *${workerName}* preview ready${branchCommit ? '\n' + branchCommit : ''}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'View Preview' },
            url: previewUrl,
          },
        },
      ],
    };
  }

  // Success: No URL available
  if (isSucceeded) {
    return {
      text: `✅ Build succeeded: ${workerName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *${workerName}* deployed successfully${branchCommit ? '\n' + branchCommit : ''}`,
          },
        },
      ],
    };
  }

  // Failure
  if (isFailed) {
    const error = extractBuildError(logs);
    const dashUrl = getDashboardUrl(event);

    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `❌ Build Failed: ${workerName}` },
      },
    ];

    // Add metadata if available
    if (meta) {
      blocks.push({
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Branch:*\n${meta.branch}` },
          { type: 'mrkdwn', text: `*Commit:*\n${meta.commitHash.substring(0, 7)}` },
          { type: 'mrkdwn', text: `*Author:*\n${meta.author.split('@')[0]}` },
        ],
      });
    }

    // Add error section
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Error:*\n\`\`\`\n${error}\n\`\`\``,
      },
    });

    // Add action button
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Full Logs' },
          url: dashUrl,
          style: 'danger',
        },
      ],
    });

    return {
      text: `❌ Build failed: ${workerName}`,
      blocks,
    };
  }

  // Cancelled
  if (isCancelled) {
    const dashUrl = getDashboardUrl(event);
    const branch = meta?.branch || 'unknown';
    const author = meta?.author.split('@')[0] || 'unknown';

    return {
      text: `⚠️ Build cancelled: ${workerName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *${workerName}* build cancelled\n\`${branch}\` by ${author}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'View Build' },
            url: dashUrl,
          },
        },
      ],
    };
  }

  // Fallback for other events
  return {
    text: `${event.type}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📢 ${event.type}`,
        },
      },
    ],
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export default {
  async queue(batch: MessageBatch<CloudflareEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const event = message.body;

        // Skip started events completely
        const isStarted = event.type.includes('started') || event.type.includes('queued');
        if (isStarted) {
          message.ack();
          continue;
        }

        const isSucceeded = event.type.includes('succeeded');
        const isFailed = event.type.includes('failed');
        const buildOutcome = event.payload.buildOutcome;
        const isCancelled = buildOutcome === 'cancelled';
        const workerName = event.source.workerName || event.payload.buildTriggerMetadata?.repoName;

        // ---------------------------------------------------------------------
        // FETCH URLs FOR SUCCESSFUL BUILDS
        // ---------------------------------------------------------------------

        let previewUrl: string | null = null;
        let liveUrl: string | null = null;

        if (isSucceeded && workerName) {
          try {
            const buildRes = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${event.metadata.accountId}/builds/builds/${event.payload.buildUuid}`,
              { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
            );
            const buildData: any = await buildRes.json();

            if (buildData.result?.preview_url) {
              previewUrl = buildData.result.preview_url;
            } else {
              // Try to get live URL
              const subRes = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${event.metadata.accountId}/workers/subdomain`,
                { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
              );
              const subData: any = await subRes.json();
              if (subData.result?.subdomain) {
                liveUrl = `https://${workerName}.${subData.result.subdomain}.workers.dev`;
              }
            }
          } catch (error) {
            console.error('Failed to fetch URLs:', error);
            // Continue without URLs
          }
        }

        // ---------------------------------------------------------------------
        // FETCH LOGS FOR FAILED BUILDS
        // ---------------------------------------------------------------------

        let logs: string[] = [];

        if (isFailed && !isCancelled) {
          try {
            let cursor: string | null = null;

            do {
              const logsEndpoint = cursor
                ? `https://api.cloudflare.com/client/v4/accounts/${event.metadata.accountId}/builds/builds/${event.payload.buildUuid}/logs?cursor=${cursor}`
                : `https://api.cloudflare.com/client/v4/accounts/${event.metadata.accountId}/builds/builds/${event.payload.buildUuid}/logs`;

              const logsRes = await fetch(logsEndpoint, {
                headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
              });
              const logsData: any = await logsRes.json();

              if (logsData.result?.lines?.length > 0) {
                const lines = logsData.result.lines.map((l: [number, string]) => l[1]);
                logs = logs.concat(lines);
              }

              cursor = logsData.result?.truncated ? logsData.result?.cursor : null;
            } while (cursor);
          } catch (error) {
            console.error('Failed to fetch logs:', error);
            // Continue without logs
          }
        }

        // ---------------------------------------------------------------------
        // BUILD BLOCK KIT MESSAGE
        // ---------------------------------------------------------------------

        const slackPayload = buildSlackBlocks(event, previewUrl, liveUrl, logs);

        // ---------------------------------------------------------------------
        // SEND TO SLACK
        // ---------------------------------------------------------------------

        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackPayload),
        });

        message.ack();
      } catch (error) {
        console.error('Error processing message:', error);
        message.ack();
      }
    }
  },
};
