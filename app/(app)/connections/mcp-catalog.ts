// Curated one-click MCP servers — a small gallery of known-good, remote
// (Streamable-HTTP) MCP servers an owner can add without hunting for a URL.
// Every entry here was verified to connect + list tools with our own client.
// No-auth entries connect in one click; auth entries pre-fill the manual form.

export type McpCatalogEntry = {
  id: string;
  name: string;
  description: string;
  url: string;
  authType: "none" | "apikey" | "oauth" | "identity";
  category: string;
};

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "context7",
    name: "Context7",
    description: "Up-to-date documentation and code examples for thousands of libraries.",
    url: "https://mcp.context7.com/mcp",
    authType: "none",
    category: "Docs",
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    description: "Ask questions about any public GitHub repository and read its wiki.",
    url: "https://mcp.deepwiki.com/mcp",
    authType: "none",
    category: "Docs",
  },
  {
    id: "microsoft-learn",
    name: "Microsoft Learn",
    description: "Search Microsoft & Azure documentation and code samples.",
    url: "https://learn.microsoft.com/api/mcp",
    authType: "none",
    category: "Docs",
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    description: "Search Cloudflare's developer documentation.",
    url: "https://docs.mcp.cloudflare.com/mcp",
    authType: "none",
    category: "Docs",
  },
  {
    id: "aws-knowledge",
    name: "AWS Knowledge",
    description: "Search AWS docs, regions, and service availability.",
    url: "https://knowledge-mcp.global.api.aws",
    authType: "none",
    category: "Docs",
  },
  {
    id: "hugging-face",
    name: "Hugging Face",
    description: "Search models, datasets, and Spaces on the Hugging Face Hub.",
    url: "https://huggingface.co/mcp",
    authType: "none",
    category: "AI",
  },
];
