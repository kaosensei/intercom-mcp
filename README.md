# Intercom MCP Server

Intercom MCP server for Help Center content management and CS workflow automation.

## Version

**v0.8.0** - Added `search_conversations` & `get_conversation`; slimmed all action-tool responses (reply/close/note/article/ticket) to return only confirmation fields instead of the full Intercom object — prevents flooding the MCP client's context window

**v0.7.0** - Added delete_article, create_collection, list_admins; optimized search_articles response

## Features

### Articles
- ✅ `get_article` - Get a single article by ID
- ✅ `list_articles` - List articles with pagination
- ✅ `search_articles` - Search articles by keywords with highlighting support
- ✅ `create_article` - Create new articles with multilingual content
- ✅ `update_article` - Update existing articles with partial updates
- ✅ `delete_article` - Delete an article permanently

### Collections
- ✅ `list_collections` - List all Help Center collections
- ✅ `get_collection` - Get a single collection by ID
- ✅ `update_collection` - Update collection info and translations
- ✅ `delete_collection` - Delete a collection (permanent)
- ✅ `create_collection` - Create new Help Center collections

### Admin
- ✅ `list_admins` - List workspace admins (useful for finding valid author_id)

### Conversations
- ✅ `search_conversations` - Search conversations (slim list: id/state/contact/timestamps, no parts)
- ✅ `get_conversation` - Get one conversation with message history (slim: meaningful parts only — comment/note/quick_reply — system events filtered out)

### CS Workflow
- ✅ `reply_conversation` - Reply to a conversation as an admin (returns slim confirmation)
- ✅ `add_conversation_note` - Add an internal note to a conversation
- ✅ `close_conversation` - Close a conversation
- ✅ `update_ticket_state` - Update a ticket's state

## Installation

1. Clone the repository:
```bash
git clone https://github.com/kaosensei/intercom-mcp.git
cd intercom-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

### Get Intercom Access Token

1. Go to Intercom Settings → Developers → Developer Hub
2. Create a new app or use existing one
3. Get an Access Token with **Articles** and **Conversations** read and write permissions

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `INTERCOM_ACCESS_TOKEN` | ✅ Always | Your Intercom API access token |
| `INTERCOM_ADMIN_ID` | ✅ For CS tools | Admin ID used for `reply_conversation` and `add_conversation_note` when `admin_id` parameter is not provided |

### Configure with Claude Code (Recommended)

If you're using Claude Code CLI, you can easily add the MCP server:

```bash
claude mcp add --transport stdio intercom-mcp \
  --env INTERCOM_ACCESS_TOKEN=<your_token> \
  --env INTERCOM_ADMIN_ID=<your_admin_id> \
  -- node /ABSOLUTE/PATH/TO/intercom-mcp/dist/index.js
```

Replace:
- `<your_token>` with your Intercom Access Token
- `/ABSOLUTE/PATH/TO/` with your actual project path

To verify it's configured:
```bash
claude mcp list
```

### Configure Claude Desktop Manually

Alternatively, edit your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this configuration:

```json
{
  "mcpServers": {
    "intercom-mcp": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/intercom-mcp/dist/index.js"
      ],
      "env": {
        "INTERCOM_ACCESS_TOKEN": "your_intercom_access_token_here",
        "INTERCOM_ADMIN_ID": "your_admin_id_here"
      }
    }
  }
}
```

**Important**:
- Replace `/ABSOLUTE/PATH/TO/intercom-mcp` with your actual project path
- Replace `your_intercom_access_token_here` with your actual token
- Replace `your_admin_id_here` with your Intercom admin ID (required for CS tools)

### Restart Claude Desktop

Completely quit Claude Desktop and restart it.

## Usage

Once configured, you can use these commands in Claude Desktop:

### List Articles
```
List Intercom articles
```

or

```
Show me the first 20 Intercom articles
```

### Get Article Details
```
Get Intercom article with ID 9876543
```

### Search Articles
```
Search for Intercom articles about "subscription"
```

or

```
Search published articles containing "播客" with highlighted matches
```

or

```
Find articles with keyword "訂閱" in Chinese
```

### Create Article
```
Create a new Intercom article titled "Getting Started Guide" with content "Welcome to our platform" by author ID 123456, save as draft
```

### Update Article
```
Update article 9876543 and change its state to published
```

### List Collections
```
List all Intercom Help Center collections
```

### Get Collection
```
Get collection with ID 14608214
```

### Update Collection
```
Update collection 14608214 and add Japanese translation
```

### Delete Collection
```
Delete collection 16036040
```

## Use Case: Translation Management

One of the key features of v0.4.0 is the ability to manage multilingual collections efficiently.

### Add Missing Translations

You can easily add translations to collections that are missing certain languages:

```
Update collection 14608214 and add the missing Japanese translation: name "アカウント管理", description "アカウント設定を管理する"
```

### Bulk Translation Updates

Check which collections are missing translations:

```
List all collections and show me which ones are missing Japanese translations
```

Then update them one by one or create a plan to update multiple collections.

### Verify Translations

After updating, verify the changes:

```
Get collection 14608214 and show me all available translations
```

## Tools Reference

### `get_article`

Get a single article by ID.

**Parameters:**
- `id` (string, required): Article ID

**Example:**
```json
{
  "id": "9876543"
}
```

### `list_articles`

List articles with pagination.

**Parameters:**
- `page` (number, optional): Page number (default: 1)
- `per_page` (number, optional): Articles per page (default: 10, max: 50)

**Example:**
```json
{
  "page": 1,
  "per_page": 20
}
```

### `search_articles`

Search for articles using keywords. Supports full-text search across article content with multilingual support (English, Chinese, Japanese, etc.).

**Parameters:**
- `phrase` (string, optional): Search keywords/phrase to find in articles
- `state` (string, optional): Filter by article state - "published", "draft", or "all" (default: "all")
- `help_center_id` (string, optional): Filter by specific Help Center ID

**Example (Search by keyword):**
```json
{
  "phrase": "subscription"
}
```

**Example (List all drafts, no keyword needed):**
```json
{
  "state": "draft"
}
```

**Example (Chinese keyword search):**
```json
{
  "phrase": "訂閱制",
  "state": "all"
}
```

**Response includes:**
- `total_count`: Total number of matching articles
- `articles`: Array of summary fields per article (id, title, description, state, url, author_id, created_at, updated_at, parent_id, parent_type)

Use `get_article` to fetch the full content of a specific article.

**Use Cases:**
- Find all articles about a specific topic
- Search for Chinese/Japanese content in multilingual help centers
- Locate articles that need updating
- Discover related content for cross-linking

### `create_article`

Create a new article with multilingual support.

**Parameters:**
- `title` (string, required): Article title
- `body` (string, required): Article content in HTML format
- `author_id` (number, required): Author ID (must be a valid Intercom team member)
- `description` (string, optional): Article description
- `state` (string, optional): "draft" or "published" (default: "draft")
- `parent_id` (string, optional): Collection or section ID
- `parent_type` (string, optional): "collection" (default)
- `translated_content` (object, optional): Multilingual content

**Example (Simple):**
```json
{
  "title": "Getting Started Guide",
  "body": "<p>Welcome to our platform</p>",
  "author_id": 123456,
  "state": "draft"
}
```

**Example (Multilingual):**
```json
{
  "title": "Getting Started Guide",
  "body": "<p>Welcome to our platform</p>",
  "author_id": 123456,
  "state": "published",
  "translated_content": {
    "zh-TW": {
      "title": "入門指南",
      "body": "<p>歡迎使用我們的平台</p>",
      "author_id": 123456,
      "state": "published"
    },
    "ja": {
      "title": "スタートガイド",
      "body": "<p>プラットフォームへようこそ</p>",
      "author_id": 123456,
      "state": "published"
    }
  }
}
```

### `update_article`

Update an existing article. Only provided fields will be updated.

**Parameters:**
- `id` (string, required): Article ID
- `title` (string, optional): Updated title
- `body` (string, optional): Updated content
- `description` (string, optional): Updated description
- `state` (string, optional): "draft" or "published"
- `author_id` (number, optional): Updated author ID
- `translated_content` (object, optional): Updated translations

**Example (Change state):**
```json
{
  "id": "9876543",
  "state": "published"
}
```

**Example (Update content):**
```json
{
  "id": "9876543",
  "title": "Updated Title",
  "body": "<p>Updated content</p>"
}
```

**Example (Add translation):**
```json
{
  "id": "9876543",
  "translated_content": {
    "zh-TW": {
      "title": "更新的標題",
      "body": "<p>更新的內容</p>"
    }
  }
}
```

### `list_collections`

List all Help Center collections (top-level categories).

**Parameters:**
- `page` (number, optional): Page number (default: 1)
- `per_page` (number, optional): Collections per page (default: 50, max: 150)

**Example:**
```json
{
  "page": 1,
  "per_page": 50
}
```

### `get_collection`

Get a single collection by ID.

**Parameters:**
- `id` (string, required): Collection ID

**Example:**
```json
{
  "id": "14608214"
}
```

### `update_collection`

Update an existing collection. Only provided fields will be updated. Perfect for adding missing translations!

**Parameters:**
- `id` (string, required): Collection ID
- `name` (string, optional): Updated collection name (updates default language)
- `description` (string, optional): Updated description (updates default language)
- `parent_id` (string, optional): Parent collection ID (null for top-level)
- `translated_content` (object, optional): Updated translations

**Example (Update name and description):**
```json
{
  "id": "14608214",
  "name": "Account Management",
  "description": "Manage your account settings"
}
```

**Example (Add missing Japanese translation):**
```json
{
  "id": "14608214",
  "translated_content": {
    "ja": {
      "name": "アカウント管理",
      "description": "アカウント設定を管理"
    }
  }
}
```

**Example (Update multiple language translations):**
```json
{
  "id": "14608214",
  "translated_content": {
    "ja": {
      "name": "アカウント管理",
      "description": "アカウント設定を管理する"
    },
    "id": {
      "name": "Manajemen Akun",
      "description": "Kelola pengaturan akun Anda"
    }
  }
}
```

### `delete_collection`

Delete a collection permanently. **WARNING: This action cannot be undone!**

**Parameters:**
- `id` (string, required): Collection ID to delete

**Example:**
```json
{
  "id": "16036040"
}
```

**⚠️ Important Notes:**
- Deleted collections cannot be restored
- All content within the collection may be affected
- Always backup important data before deletion

### `delete_article`

Delete an article permanently. **WARNING: This action cannot be undone!**

**Parameters:**
- `id` (string, required): Article ID to delete

**Example:**
```json
{
  "id": "9876543"
}
```

### `create_collection`

Create a new Help Center collection.

**Parameters:**
- `name` (string, required): Collection name
- `description` (string, optional): Collection description
- `parent_id` (string, optional): Parent collection ID for nesting (omit for top-level)
- `translated_content` (object, optional): Multilingual content by locale code

**Example (Simple):**
```json
{
  "name": "Getting Started"
}
```

**Example (With translation):**
```json
{
  "name": "Getting Started",
  "translated_content": {
    "zh-TW": {
      "name": "入門指南",
      "description": "開始使用我們的平台"
    }
  }
}
```

### `list_admins`

List all workspace admins. Useful for finding valid `author_id` values when creating or updating articles.

**Parameters:** None

**Response includes:**
- `id`: Admin ID (use this as `author_id`)
- `name`: Display name
- `email`: Email address
- `has_inbox_seat`: Whether the admin has an inbox seat

### `reply_conversation`

Reply to a conversation as an admin. The reply is visible to the customer.

**Parameters:**
- `conversation_id` (string, required): The conversation ID to reply to
- `body` (string, required): The reply message body (supports HTML)
- `admin_id` (string, optional): Admin ID to reply as (defaults to `INTERCOM_ADMIN_ID` env var)

**Example:**
```json
{
  "conversation_id": "12345678",
  "body": "<p>Thank you for reaching out. We'll look into this right away.</p>"
}
```

### `add_conversation_note`

Add an internal note to a conversation. Notes are only visible to team members, not customers.

**Parameters:**
- `conversation_id` (string, required): The conversation ID to add a note to
- `body` (string, required): The note content (supports HTML)
- `admin_id` (string, optional): Admin ID adding the note (defaults to `INTERCOM_ADMIN_ID` env var)

**Example:**
```json
{
  "conversation_id": "12345678",
  "body": "<p>Customer has been refunded. Follow up in 3 days.</p>"
}
```

### `close_conversation`

Close a conversation.

**Parameters:**
- `conversation_id` (string, required): The conversation ID to close

**Example:**
```json
{
  "conversation_id": "12345678"
}
```

### `update_ticket_state`

Update the state of a ticket.

**Parameters:**
- `ticket_id` (string, required): The ticket ID to update
- `state` (string, required): The new ticket state — one of `in_progress`, `waiting_on_customer`, `resolved`

**Example:**
```json
{
  "ticket_id": "87654321",
  "state": "resolved"
}
```

## Development

### Build
```bash
npm run build
```

### Watch mode
```bash
npm run watch
```

## Troubleshooting

### Claude Desktop doesn't show the tools

1. Check config file path is correct
2. Verify JSON format (no trailing commas)
3. Completely restart Claude Desktop
4. Check absolute path to `dist/index.js`

### API errors

1. Verify your Access Token is correct
2. Ensure token has Articles read permissions
3. Check Intercom API status

### Build errors

1. Ensure TypeScript version >= 5.0
2. Delete `node_modules` and `dist`, then:
```bash
npm install && npm run build
```

## Project Structure

```
intercom-mcp/
├── package.json           # Project configuration
├── tsconfig.json          # TypeScript configuration
├── src/
│   └── index.ts           # Main server code
├── dist/                  # Compiled output
└── README.md             # This file
```

## Roadmap

### Completed
- ✅ Get Article (v0.1.0)
- ✅ List Articles (v0.1.0)
- ✅ Create Article (v0.2.0)
- ✅ Update Article (v0.2.0)
- ✅ Multilingual support for Articles (v0.2.0)
- ✅ List Collections (v0.3.1)
- ✅ Get Collection (v0.3.1)
- ✅ Update Collection (v0.4.0)
- ✅ Delete Collection (v0.4.0)
- ✅ Multilingual support for Collections (v0.4.0)
- ✅ Search Articles with keyword matching and highlighting (v0.5.0)
- ✅ Reply to conversations (v0.6.0)
- ✅ Add internal notes to conversations (v0.6.0)
- ✅ Close conversations (v0.6.0)
- ✅ Update ticket state (v0.6.0)
- ✅ Delete Article (v0.7.0)
- ✅ Create Collection (v0.7.0)
- ✅ List Admins (v0.7.0)
- ✅ Optimized search_articles response (v0.7.0)

### Planned
- 🔜 Batch operations
- 🔜 Better error handling
- 🔜 Modular file structure

## Resources

- [Intercom Articles API](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/articles)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Documentation](https://modelcontextprotocol.io/)

## License

MIT
