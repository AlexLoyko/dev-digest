/**
 * Child-process environment for the SDK. The one job here: force the subscription path.
 */

/**
 * Copy the current env with any API key removed. A key in the environment takes priority over
 * the Claude Code subscription, so without this every eval run would silently bill API tokens.
 */
export function subscriptionEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}
