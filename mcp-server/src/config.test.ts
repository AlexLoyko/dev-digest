import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('returns documented defaults when no env vars are set', () => {
    const config = loadConfig({});

    expect(config.apiUrl).toBe('http://127.0.0.1:3001');
    expect(config.runTimeoutMs).toBe(240_000);
    expect(config.pollIntervalMs).toBe(2_000);
    expect(config.maxFindings).toBe(20);
    expect(config.debug).toBeUndefined();
    expect(config.apiToken).toBeUndefined();
  });

  it('applies explicit overrides', () => {
    const config = loadConfig({
      DEVDIGEST_API_URL: 'http://localhost:4000',
      DEVDIGEST_MCP_RUN_TIMEOUT_MS: '120000',
      DEVDIGEST_MCP_POLL_INTERVAL_MS: '1000',
      DEVDIGEST_MCP_MAX_FINDINGS: '5',
      DEVDIGEST_MCP_DEBUG: '1',
      DEVDIGEST_API_TOKEN: 'sekret-token',
    });

    expect(config.apiUrl).toBe('http://localhost:4000');
    expect(config.runTimeoutMs).toBe(120_000);
    expect(config.pollIntervalMs).toBe(1_000);
    expect(config.maxFindings).toBe(5);
    expect(config.debug).toBe('1');
    expect(config.apiToken).toBe('sekret-token');
  });

  it('treats empty-string env vars as unset and falls back to defaults', () => {
    expect(loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: '' }).runTimeoutMs).toBe(240_000);
    expect(loadConfig({ DEVDIGEST_API_URL: '' }).apiUrl).toBe('http://127.0.0.1:3001');
    expect(loadConfig({ DEVDIGEST_MCP_POLL_INTERVAL_MS: '' }).pollIntervalMs).toBe(2_000);
    expect(loadConfig({ DEVDIGEST_MCP_MAX_FINDINGS: '' }).maxFindings).toBe(20);
    expect(loadConfig({ DEVDIGEST_MCP_DEBUG: '' }).debug).toBeUndefined();
    expect(loadConfig({ DEVDIGEST_API_TOKEN: '' }).apiToken).toBeUndefined();
  });

  it('throws an error naming the offending env var on an invalid value', () => {
    expect(() => loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: 'not-a-number' })).toThrow(
      /DEVDIGEST_MCP_RUN_TIMEOUT_MS/,
    );
    expect(() => loadConfig({ DEVDIGEST_MCP_MAX_FINDINGS: '-5' })).toThrow(
      /DEVDIGEST_MCP_MAX_FINDINGS/,
    );
    expect(() => loadConfig({ DEVDIGEST_MCP_POLL_INTERVAL_MS: '0' })).toThrow(
      /DEVDIGEST_MCP_POLL_INTERVAL_MS/,
    );
  });
});
