import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => {
            // Security hardening: only http:, https:, and relative (no
            // scheme — e.g. "/foo", "#anchor", "foo/bar.md") hrefs are
            // rendered as links. Any other scheme (javascript:, data:, etc.)
            // is rendered as inert text so it can never execute on click.
            const scheme = href?.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
            const isSafe = !!href && (scheme === undefined || scheme === "http" || scheme === "https");
            if (!isSafe) {
              return <span>{children}</span>;
            }
            const isExternal = scheme === "http" || scheme === "https";
            return (
              <a
                href={href}
                style={{ color: "var(--accent-text)", textDecoration: "underline" }}
                {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
