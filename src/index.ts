#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const VERSION = '0.8.2';

// Intercom Article 型別
interface IntercomArticle {
  id: string;
  title: string;
  description?: string;
  body?: string;
  author_id: number;
  state: 'draft' | 'published';
  created_at: number;
  updated_at: number;
}

// Intercom Collection 型別
interface IntercomCollection {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  created_at: number;
  updated_at: number;
  url?: string;
  icon?: string;
  order?: number;
  default_locale?: string;
  translated_content?: any;
}


// List 回應型別
interface ListArticlesResponse {
  type: 'list';
  data: IntercomArticle[];
  pages?: {
    page: number;
    per_page: number;
    total_pages: number;
  };
}

// Search Articles 回應型別
interface SearchArticlesResponse {
  type: 'list';
  total_count: number;
  data: {
    articles: Array<{
      id: string;
      title: string;
      description?: string;
      body?: string;
      author_id: number;
      state: 'draft' | 'published';
      created_at: number;
      updated_at: number;
      url?: string;
      parent_id?: string;
      parent_type?: string;
      default_locale?: string;
      translated_content?: any;
      statistics?: any;
    }>;
  };
  pages?: {
    type: string;
    page?: number;
    per_page?: number;
    total_pages?: number;
    next?: {
      page: number;
      starting_after: string;
    };
  };
}

// Intercom Admin 型別
interface IntercomAdmin {
  type: string;
  id: string;
  name: string;
  email: string;
  away_mode_enabled?: boolean;
  away_mode_reassign?: boolean;
  has_inbox_seat?: boolean;
  team_ids?: number[];
}

interface ListCollectionsResponse {
  type: 'list';
  data: IntercomCollection[];
  pages?: {
    page: number;
    per_page: number;
    total_pages: number;
  };
}


// 從環境變數取得 token
const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const INTERCOM_ADMIN_ID = process.env.INTERCOM_ADMIN_ID;
const INTERCOM_API_BASE = 'https://api.intercom.io';

/**
 * 呼叫 Intercom API
 */
async function callIntercomAPI(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any
): Promise<any> {
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${INTERCOM_TOKEN}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14'
    }
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${INTERCOM_API_BASE}${endpoint}`, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Intercom API error: ${response.status} - ${error}`);
  }

  // Handle 204 No Content response
  if (response.status === 204) {
    return { success: true };
  }

  return response.json();
}

// ---- 回傳精簡 helpers：避免把整個 Intercom 物件灌進 tool result ----

// 對話內容只保留這些 part_type，其餘為系統事件噪音
// （assignment / open / close / language_detection_details / fin_* / operator_workflow_event / user_became_idle 等）
const MEANINGFUL_PART_TYPES = new Set(['comment', 'note', 'quick_reply']);

function simplifyAuthor(author: any) {
  if (!author) return undefined;
  return { type: author.type, id: author.id, name: author.name, email: author.email };
}

// 寫操作（reply / close / note / ticket）成功確認用——不含對話內容
function simplifyWriteResult(data: any) {
  const parts = data?.conversation_parts?.conversation_parts;
  return {
    id: data?.id,
    state: data?.state,
    open: data?.open,
    last_part_id: Array.isArray(parts) && parts.length ? parts[parts.length - 1].id : undefined,
    created_at: data?.created_at,
    updated_at: data?.updated_at
  };
}

// search_conversations 每筆列表項——不含 parts
function simplifyConversationListItem(conv: any) {
  return {
    id: conv?.id,
    state: conv?.state,
    open: conv?.open,
    title: conv?.title,
    subject: conv?.source?.subject,
    waiting_since: conv?.waiting_since,
    admin_assignee_id: conv?.admin_assignee_id,
    created_at: conv?.created_at,
    updated_at: conv?.updated_at,
    contact: simplifyAuthor(conv?.source?.author)
  };
}

// 只保留有值的 ticket custom attributes（每個 value 是 {value,type}；空欄位濾掉）
function simplifyTicketAttributes(ticket: any) {
  const attrs = ticket?.custom_attributes;
  if (!attrs || typeof attrs !== 'object') return undefined;
  const kept: any = {};
  for (const [k, v] of Object.entries(attrs)) {
    const val = (v as any)?.value;
    if (val !== null && val !== undefined && val !== '') kept[k] = val;
  }
  return Object.keys(kept).length ? kept : undefined;
}

// get_conversation——濾掉系統事件 parts，但保留 cs 分類所需的頂層欄位
// （source.delivered_as 判斷真實提問者、ticket form 真實需求、contacts、每則是否點選 quick reply）
function simplifyConversationFull(data: any) {
  const allParts: any[] = data?.conversation_parts?.conversation_parts ?? [];
  const parts = allParts
    .filter((p: any) => MEANINGFUL_PART_TYPES.has(p?.part_type))
    .map((p: any) => ({
      id: p.id,
      part_type: p.part_type,
      body: p.body,
      author: simplifyAuthor(p.author),
      // 區分「自行打字」vs「點 quick reply 選項」——cs 分類 🔵🔴 的關鍵
      from_quick_reply: !!(p.metadata && p.metadata.quick_reply_option_uuid),
      created_at: p.created_at
    }));
  const s = data?.source;
  return {
    id: data?.id,
    state: data?.state,
    open: data?.open,
    title: data?.title,
    created_at: data?.created_at,
    updated_at: data?.updated_at,
    waiting_since: data?.waiting_since,
    source: s ? {
      type: s.type,
      delivered_as: s.delivered_as,
      subject: s.subject,
      body: s.body,
      author: simplifyAuthor(s.author)
    } : undefined,
    ticket_attributes: simplifyTicketAttributes(data?.ticket),
    contacts: (data?.contacts?.contacts ?? []).map((c: any) => ({
      type: c.type, id: c.id, external_id: c.external_id, email: c.email, name: c.name
    })),
    total_parts: allParts.length,
    included_parts: parts.length,
    parts
  };
}

// create_article / update_article 用
function simplifyArticleResult(a: any) {
  return {
    id: a?.id,
    title: a?.title,
    state: a?.state,
    url: a?.url,
    parent_id: a?.parent_id,
    parent_type: a?.parent_type,
    updated_at: a?.updated_at
  };
}

/**
 * 建立 MCP Server
 */
const server = new Server({
  name: 'intercom-mcp',
  version: VERSION
}, {
  capabilities: {
    tools: {}
  }
});

/**
 * 註冊工具列表
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_conversations',
        description: 'Search Intercom conversations. Returns a SLIM list (id, state, contact, timestamps) with NO conversation parts — call get_conversation for full content. Pass a raw Intercom query object.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'object',
              description: 'Intercom search query object, e.g. {"operator":"AND","value":[{"field":"state","operator":"=","value":"open"}]}. Add {"field":"admin_assignee_id","operator":"=","value":<id>} to filter by assignee, or {"field":"source.author.email","operator":"=","value":"<email>"} by contact email.'
            },
            per_page: {
              type: 'number',
              description: 'Results per page (default 20, max 50)',
              default: 20
            },
            starting_after: {
              type: 'string',
              description: 'Pagination cursor from a previous response\'s "next" field'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'get_conversation',
        description: 'Get a single Intercom conversation by ID. SLIM: keeps triage essentials (source incl. delivered_as, ticket_attributes from ticket forms, contacts) and only meaningful parts (comment/note/quick_reply, each flagged with from_quick_reply) — system events filtered out, with total_parts/included_parts counts.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The conversation ID (required)'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'get_article',
        description: 'Get a single Intercom article by ID. Returns full article details including title, body, author, and state.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The article ID (e.g., "123456")'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'list_articles',
        description: 'List Intercom articles with pagination. Returns a list of articles with basic information.',
        inputSchema: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              description: 'Page number (default: 1)',
              default: 1
            },
            per_page: {
              type: 'number',
              description: 'Number of articles per page (default: 10, max: 50)',
              default: 10
            }
          }
        }
      },
      {
        name: 'create_article',
        description: 'Create a new Intercom Help Center article. Supports multilingual content and draft/published states.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Article title (required)'
            },
            body: {
              type: 'string',
              description: 'Article content in HTML format (required)'
            },
            author_id: {
              type: 'number',
              description: 'Author ID - must be a valid Intercom admin ID (required). Use list_admins to find valid IDs by name.'
            },
            description: {
              type: 'string',
              description: 'Article description (optional)'
            },
            state: {
              type: 'string',
              enum: ['draft', 'published'],
              description: 'Article state (optional, default: draft)'
            },
            parent_id: {
              type: 'string',
              description: 'Parent ID - collection or section ID (optional)'
            },
            parent_type: {
              type: 'string',
              enum: ['collection'],
              description: 'Parent type (optional, default: collection)'
            },
            translated_content: {
              type: 'object',
              description: 'Multilingual content. Key is locale code (e.g., "zh-TW"), value is translation object',
              additionalProperties: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: 'Translated title'
                  },
                  body: {
                    type: 'string',
                    description: 'Translated content in HTML'
                  },
                  description: {
                    type: 'string',
                    description: 'Translated description'
                  },
                  author_id: {
                    type: 'number',
                    description: 'Author ID for translation'
                  },
                  state: {
                    type: 'string',
                    enum: ['draft', 'published'],
                    description: 'Translation state'
                  }
                },
                required: ['title', 'body', 'author_id']
              }
            }
          },
          required: ['title', 'body', 'author_id']
        }
      },
      {
        name: 'update_article',
        description: 'Update an existing Intercom Help Center article. Supports partial updates and multilingual content.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Article ID (required)'
            },
            title: {
              type: 'string',
              description: 'Updated article title (optional)'
            },
            body: {
              type: 'string',
              description: 'Updated article content in HTML format (optional)'
            },
            description: {
              type: 'string',
              description: 'Updated article description (optional)'
            },
            state: {
              type: 'string',
              enum: ['draft', 'published'],
              description: 'Updated article state (optional)'
            },
            author_id: {
              type: 'number',
              description: 'Updated author ID (optional). Use list_admins to find valid IDs by name.'
            },
            translated_content: {
              type: 'object',
              description: 'Updated multilingual content. Only provided fields will be updated.',
              additionalProperties: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: 'Updated translated title'
                  },
                  body: {
                    type: 'string',
                    description: 'Updated translated content in HTML'
                  },
                  description: {
                    type: 'string',
                    description: 'Updated translated description'
                  },
                  state: {
                    type: 'string',
                    enum: ['draft', 'published'],
                    description: 'Updated translation state'
                  }
                }
              }
            }
          },
          required: ['id']
        }
      },
      {
        name: 'delete_article',
        description: 'Delete an Intercom Help Center article. WARNING: This action cannot be undone. The article will be permanently removed.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Article ID to delete (required)'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'list_collections',
        description: 'List all Intercom Help Center collections. Collections are top-level categories that contain sections and articles.',
        inputSchema: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              description: 'Page number (default: 1)',
              default: 1
            },
            per_page: {
              type: 'number',
              description: 'Number of collections per page (default: 50, max: 150)',
              default: 50
            }
          }
        }
      },
      {
        name: 'get_collection',
        description: 'Get a single Intercom Help Center collection by ID. Returns full collection details including name, description, and metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The collection ID (e.g., "123456")'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'create_collection',
        description: 'Create a new Intercom Help Center collection. Collections are top-level categories that contain sections and articles.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Collection name (required)'
            },
            description: {
              type: 'string',
              description: 'Collection description (optional)'
            },
            parent_id: {
              type: 'string',
              description: 'Parent collection ID for nesting (optional, null for top-level)'
            },
            translated_content: {
              type: 'object',
              description: 'Multilingual content. Key is locale code (e.g., "zh-TW"), value is translation object',
              additionalProperties: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Translated collection name'
                  },
                  description: {
                    type: 'string',
                    description: 'Translated collection description'
                  }
                }
              }
            }
          },
          required: ['name']
        }
      },
      {
        name: 'update_collection',
        description: 'Update an existing Intercom Help Center collection. Supports updating name, description, and multilingual translations.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Collection ID (required)'
            },
            name: {
              type: 'string',
              description: 'Updated collection name (optional, updates default language)'
            },
            description: {
              type: 'string',
              description: 'Updated collection description (optional, updates default language)'
            },
            parent_id: {
              type: 'string',
              description: 'Updated parent collection ID (optional, null for top-level)'
            },
            translated_content: {
              type: 'object',
              description: 'Updated multilingual content. Key is locale code (e.g., "zh-TW"), value is translation object',
              additionalProperties: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Translated collection name'
                  },
                  description: {
                    type: 'string',
                    description: 'Translated collection description'
                  }
                }
              }
            }
          },
          required: ['id']
        }
      },
      {
        name: 'delete_collection',
        description: 'Delete an Intercom Help Center collection. WARNING: This action cannot be undone. The collection and all its contents will be permanently removed.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Collection ID to delete (required)'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'search_articles',
        description: 'Search for Intercom Help Center articles using keywords. Returns summary fields (id, title, description, state, url, author_id, created_at, updated_at, parent_id, parent_type) for each match. Use get_article to fetch the full content of a specific article.',
        inputSchema: {
          type: 'object',
          properties: {
            phrase: {
              type: 'string',
              description: 'Search phrase/keywords to find in articles (optional)'
            },
            state: {
              type: 'string',
              enum: ['published', 'draft', 'all'],
              description: 'Filter by article state (optional, default: all)'
            },
            help_center_id: {
              type: 'string',
              description: 'Filter by specific Help Center ID (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'reply_conversation',
        description: 'Reply to an Intercom conversation as an admin. Use this to send a message visible to the customer.',
        inputSchema: {
          type: 'object',
          properties: {
            conversation_id: {
              type: 'string',
              description: 'The conversation ID to reply to (required)'
            },
            body: {
              type: 'string',
              description: 'The reply message body (required). Supports HTML.'
            },
            admin_id: {
              type: 'string',
              description: 'Admin ID to reply as (optional, defaults to INTERCOM_ADMIN_ID env var)'
            }
          },
          required: ['conversation_id', 'body']
        }
      },
      {
        name: 'add_conversation_note',
        description: 'Add an internal note to an Intercom conversation. Notes are only visible to team members, not customers.',
        inputSchema: {
          type: 'object',
          properties: {
            conversation_id: {
              type: 'string',
              description: 'The conversation ID to add a note to (required)'
            },
            body: {
              type: 'string',
              description: 'The note content (required). Supports HTML.'
            },
            admin_id: {
              type: 'string',
              description: 'Admin ID adding the note (optional, defaults to INTERCOM_ADMIN_ID env var)'
            }
          },
          required: ['conversation_id', 'body']
        }
      },
      {
        name: 'close_conversation',
        description: 'Close an Intercom conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            conversation_id: {
              type: 'string',
              description: 'The conversation ID to close (required)'
            }
          },
          required: ['conversation_id']
        }
      },
      {
        name: 'update_ticket_state',
        description: 'Update the state of an Intercom ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: {
              type: 'string',
              description: 'The ticket ID to update (required)'
            },
            state: {
              type: 'string',
              enum: ['in_progress', 'waiting_on_customer', 'resolved'],
              description: 'The new ticket state (required)'
            }
          },
          required: ['ticket_id', 'state']
        }
      },
      {
        name: 'list_admins',
        description: 'List all Intercom workspace admins/team members. Returns IDs, names, and emails. Useful for discovering valid author_id or admin_id values.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

/**
 * 註冊工具呼叫處理
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'get_article') {
      const { id } = args as { id: string };

      if (!id) {
        throw new Error('Article ID is required');
      }

      const article = await callIntercomAPI(`/articles/${id}`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(article, null, 2)
        }]
      };
    }

    if (name === 'list_articles') {
      const { page = 1, per_page = 10 } = args as {
        page?: number;
        per_page?: number;
      };

      // 確保參數在合理範圍內
      const validPage = Math.max(1, Math.floor(page));
      const validPerPage = Math.min(50, Math.max(1, Math.floor(per_page)));

      const data: ListArticlesResponse = await callIntercomAPI(
        `/articles?page=${validPage}&per_page=${validPerPage}`
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }]
      };
    }

    if (name === 'create_article') {
      const { title, body, author_id, description, state, parent_id, parent_type, translated_content } = args as {
        title: string;
        body: string;
        author_id: number;
        description?: string;
        state?: 'draft' | 'published';
        parent_id?: string;
        parent_type?: 'collection';
        translated_content?: {
          [locale: string]: {
            title: string;
            body: string;
            description?: string;
            author_id: number;
            state?: 'draft' | 'published';
          }
        }
      };

      // 驗證必填欄位
      if (!title || !body || !author_id) {
        throw new Error('title, body, and author_id are required fields');
      }

      // 建構 request payload
      const payload: any = {
        title,
        body,
        author_id
      };

      if (description) payload.description = description;
      if (state) payload.state = state;
      if (parent_id) payload.parent_id = parent_id;
      if (parent_type) payload.parent_type = parent_type;
      if (translated_content) payload.translated_content = translated_content;

      const article = await callIntercomAPI('/articles', 'POST', payload);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(simplifyArticleResult(article), null, 2)
        }]
      };
    }

    if (name === 'update_article') {
      const { id, title, body, description, state, author_id, translated_content } = args as {
        id: string;
        title?: string;
        body?: string;
        description?: string;
        state?: 'draft' | 'published';
        author_id?: number;
        translated_content?: {
          [locale: string]: {
            title?: string;
            body?: string;
            description?: string;
            state?: 'draft' | 'published';
          }
        }
      };

      // 驗證必填欄位
      if (!id) {
        throw new Error('Article ID is required');
      }

      // 建構 update payload（只包含提供的欄位）
      const payload: any = {};

      if (title) payload.title = title;
      if (body) payload.body = body;
      if (description) payload.description = description;
      if (state) payload.state = state;
      if (author_id) payload.author_id = author_id;
      if (translated_content) payload.translated_content = translated_content;

      // 確保至少有一個欄位要更新
      if (Object.keys(payload).length === 0) {
        throw new Error('At least one field must be provided for update');
      }

      const article = await callIntercomAPI(`/articles/${id}`, 'PUT', payload);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(simplifyArticleResult(article), null, 2)
        }]
      };
    }

    if (name === 'delete_article') {
      const { id } = args as { id: string };

      // 驗證必填欄位
      if (!id) {
        throw new Error('Article ID is required');
      }

      const result = await callIntercomAPI(`/articles/${id}`, 'DELETE');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }

    if (name === 'list_collections') {
      const { page = 1, per_page = 50 } = args as {
        page?: number;
        per_page?: number;
      };

      // 確保參數在合理範圍內
      const validPage = Math.max(1, Math.floor(page));
      const validPerPage = Math.min(150, Math.max(1, Math.floor(per_page)));

      const data: ListCollectionsResponse = await callIntercomAPI(
        `/help_center/collections?page=${validPage}&per_page=${validPerPage}`
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }]
      };
    }

    if (name === 'get_collection') {
      const { id } = args as { id: string };

      if (!id) {
        throw new Error('Collection ID is required');
      }

      const collection = await callIntercomAPI(`/help_center/collections/${id}`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(collection, null, 2)
        }]
      };
    }

    if (name === 'create_collection') {
      const { name: collectionName, description, parent_id, translated_content } = args as {
        name: string;
        description?: string;
        parent_id?: string;
        translated_content?: {
          [locale: string]: {
            name?: string;
            description?: string;
          }
        }
      };

      // 驗證必填欄位
      if (!collectionName) {
        throw new Error('Collection name is required');
      }

      // 建構 request payload
      const payload: any = {
        name: collectionName
      };

      if (description) payload.description = description;
      if (parent_id) payload.parent_id = parent_id;
      if (translated_content) payload.translated_content = translated_content;

      const collection = await callIntercomAPI('/help_center/collections', 'POST', payload);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(collection, null, 2)
        }]
      };
    }

    if (name === 'update_collection') {
      const { id, name: collectionName, description, parent_id, translated_content } = args as {
        id: string;
        name?: string;
        description?: string;
        parent_id?: string;
        translated_content?: {
          [locale: string]: {
            name?: string;
            description?: string;
          }
        }
      };

      // 驗證必填欄位
      if (!id) {
        throw new Error('Collection ID is required');
      }

      // 建構 update payload（只包含提供的欄位）
      const payload: any = {};

      if (collectionName !== undefined) payload.name = collectionName;
      if (description !== undefined) payload.description = description;
      if (parent_id !== undefined) payload.parent_id = parent_id;
      if (translated_content) payload.translated_content = translated_content;

      // 確保至少有一個欄位要更新
      if (Object.keys(payload).length === 0) {
        throw new Error('At least one field must be provided for update');
      }

      const collection = await callIntercomAPI(`/help_center/collections/${id}`, 'PUT', payload);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(collection, null, 2)
        }]
      };
    }

    if (name === 'delete_collection') {
      const { id } = args as { id: string };

      // 驗證必填欄位
      if (!id) {
        throw new Error('Collection ID is required');
      }

      const result = await callIntercomAPI(`/help_center/collections/${id}`, 'DELETE');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Collection ${id} has been deleted successfully`,
            ...result
          }, null, 2)
        }]
      };
    }

    if (name === 'search_articles') {
      const { phrase, state, help_center_id } = args as {
        phrase?: string;
        state?: 'published' | 'draft' | 'all';
        help_center_id?: string;
      };

      // 建構查詢參數
      const queryParams = new URLSearchParams();
      if (phrase) {
        queryParams.append('phrase', phrase);
      }

      if (state) {
        queryParams.append('state', state);
      }

      if (help_center_id) {
        queryParams.append('help_center_id', help_center_id);
      }

      const data: SearchArticlesResponse = await callIntercomAPI(
        `/articles/search?${queryParams.toString()}`
      );

      const summary = {
        total_count: data.total_count,
        articles: (data.data.articles ?? []).map(article => ({
          id: article.id,
          title: article.title,
          description: article.description,
          state: article.state,
          url: article.url,
          author_id: article.author_id,
          created_at: article.created_at,
          updated_at: article.updated_at,
          parent_id: article.parent_id,
          parent_type: article.parent_type,
        })),
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(summary, null, 2)
        }]
      };
    }

    if (name === 'search_conversations') {
      const { query, per_page = 20, starting_after } = args as {
        query: any;
        per_page?: number;
        starting_after?: string;
      };
      if (!query) throw new Error('query is required');

      // MCP clients may serialize the query object as a JSON string — normalize to an object
      // (Intercom's /conversations/search rejects a string with "Ensure query is a JSON object").
      let q: any = query;
      if (typeof q === 'string') {
        try {
          q = JSON.parse(q);
        } catch {
          throw new Error('query must be an Intercom query object (or its JSON string)');
        }
      }

      const pagination: any = { per_page: Math.min(50, Math.max(1, Math.floor(per_page))) };
      if (starting_after) pagination.starting_after = starting_after;

      const result = await callIntercomAPI('/conversations/search', 'POST', { query: q, pagination });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total_count: result.total_count,
            next: result.pages?.next?.starting_after,
            conversations: (result.conversations ?? []).map(simplifyConversationListItem)
          }, null, 2)
        }]
      };
    }

    if (name === 'get_conversation') {
      const { id } = args as { id: string };
      if (!id) throw new Error('Conversation ID is required');

      const result = await callIntercomAPI(`/conversations/${id}?display_as=plaintext`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(simplifyConversationFull(result), null, 2)
        }]
      };
    }

    if (name === 'reply_conversation') {
      const { conversation_id, body, admin_id } = args as {
        conversation_id: string;
        body: string;
        admin_id?: string;
      };

      if (!conversation_id || !body) {
        throw new Error('conversation_id and body are required');
      }

      const resolvedAdminId = admin_id || INTERCOM_ADMIN_ID;
      if (!resolvedAdminId) {
        throw new Error('admin_id is required. Set INTERCOM_ADMIN_ID env var or pass admin_id parameter.');
      }

      const result = await callIntercomAPI(`/conversations/${conversation_id}/reply`, 'POST', {
        message_type: 'comment',
        type: 'admin',
        admin_id: resolvedAdminId,
        body
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(simplifyWriteResult(result), null, 2)
        }]
      };
    }

    if (name === 'add_conversation_note') {
      const { conversation_id, body, admin_id } = args as {
        conversation_id: string;
        body: string;
        admin_id?: string;
      };

      if (!conversation_id || !body) {
        throw new Error('conversation_id and body are required');
      }

      const resolvedNoteAdminId = admin_id || INTERCOM_ADMIN_ID;
      if (!resolvedNoteAdminId) {
        throw new Error('admin_id is required. Set INTERCOM_ADMIN_ID env var or pass admin_id parameter.');
      }

      const result = await callIntercomAPI(`/conversations/${conversation_id}/reply`, 'POST', {
        message_type: 'note',
        type: 'admin',
        admin_id: resolvedNoteAdminId,
        body
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(simplifyWriteResult(result), null, 2)
        }]
      };
    }

    if (name === 'close_conversation') {
      const { conversation_id } = args as { conversation_id: string };

      if (!conversation_id) {
        throw new Error('conversation_id is required');
      }

      const resolvedAdminId = INTERCOM_ADMIN_ID;
      if (!resolvedAdminId) {
        throw new Error('admin_id is required. Set INTERCOM_ADMIN_ID env var.');
      }

      const result = await callIntercomAPI(`/conversations/${conversation_id}/reply`, 'POST', {
        message_type: 'close',
        type: 'admin',
        admin_id: resolvedAdminId
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(simplifyWriteResult(result), null, 2)
        }]
      };
    }

    if (name === 'update_ticket_state') {
      const { ticket_id, state } = args as {
        ticket_id: string;
        state: 'in_progress' | 'waiting_on_customer' | 'resolved';
      };

      if (!ticket_id || !state) {
        throw new Error('ticket_id and state are required');
      }

      const result = await callIntercomAPI(`/tickets/${ticket_id}`, 'PUT', { state });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(simplifyWriteResult(result), null, 2)
        }]
      };
    }

    if (name === 'list_admins') {
      const data = await callIntercomAPI('/admins');

      // 簡化回應，只回傳最實用的欄位
      const admins = (data.admins || []).map((admin: IntercomAdmin) => ({
        id: admin.id,
        name: admin.name,
        email: admin.email,
        has_inbox_seat: admin.has_inbox_seat,
        away_mode_enabled: admin.away_mode_enabled,
        team_ids: admin.team_ids
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            type: 'admin.list',
            admins
          }, null, 2)
        }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: `Error: ${errorMessage}`
      }],
      isError: true
    };
  }
});

/**
 * 主函數
 */
async function main() {
  // 檢查環境變數
  if (!INTERCOM_TOKEN) {
    console.error('Error: INTERCOM_ACCESS_TOKEN environment variable is required');
    console.error('Please set it in your MCP configuration or environment');
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 使用 stderr 輸出（stdio 協定使用 stdout）
  console.error(`Intercom MCP Server v${VERSION}`);
  console.error('Running on stdio transport');
  console.error('Tools available:');
  console.error('  Articles: get_article, list_articles, create_article, update_article, delete_article, search_articles');
  console.error('  Collections: list_collections, get_collection, create_collection, update_collection, delete_collection');
  console.error('  Conversations: search_conversations, get_conversation');
  console.error('  CS Tools: reply_conversation, add_conversation_note, close_conversation, update_ticket_state');
  console.error('  Admin: list_admins');
}

// 啟動伺服器
main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
