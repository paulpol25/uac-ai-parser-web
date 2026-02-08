# How to Use UAC AI

This guide walks you through the complete workflow of using UAC AI for forensic analysis.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [User Authentication](#user-authentication)
3. [Managing Investigations](#managing-investigations)
4. [Uploading UAC Archives](#uploading-uac-archives)
5. [AI Analysis](#ai-analysis)
6. [Timeline Analysis](#timeline-analysis)
7. [Log Search](#log-search)
8. [Exporting Data](#exporting-data)
9. [Tips & Best Practices](#tips--best-practices)

---

## Getting Started

### Prerequisites

Before using UAC AI, ensure you have:

1. **Backend running** at `http://localhost:8080`
2. **Frontend running** at `http://localhost:3000`
3. **Ollama running** with at least one model pulled

### Starting the Application

```bash
# Terminal 1 - Start Backend
cd backend
python run.py

# Terminal 2 - Start Frontend
cd frontend
npm run dev

# Ensure Ollama is running
ollama serve
```

Navigate to `http://localhost:3000` in your browser.

---

## User Authentication

### Creating an Account

1. Click **Sign Up** on the login page
2. Enter your details:
   - **Username**: Your unique identifier
   - **Email**: Your email address
   - **Password**: At least 8 characters
3. Click **Create Account**

### Logging In

1. Enter your **username** and **password**
2. Click **Sign In**
3. You'll be redirected to the Dashboard

### Session Management

- Sessions persist across browser refreshes
- Click your avatar in the header to access **Sign Out**
- Sessions expire after extended inactivity

---

## Managing Investigations

Investigations are containers for organizing your forensic cases.

### Creating an Investigation

1. Navigate to **Investigations** in the sidebar
2. Click the **New Investigation** button
3. Fill in the details:
   - **Name**: Descriptive name (e.g., "Ransomware Incident - Server01")
   - **Case Number** (optional): Your internal tracking ID
   - **Description** (optional): Additional context
4. Click **Create**

### Investigation List

The investigations page shows:
- Investigation name and case number
- Creation date
- Status (Active, Closed)
- Number of uploads/sessions

### Managing Investigations

- **View**: Click an investigation to see details and sessions
- **Edit**: Click the edit icon to modify name/description
- **Delete**: Click delete to remove (this permanently deletes all data)
- **Archive**: Mark as closed when investigation is complete

---

## Uploading UAC Archives

### Supported Formats

- `.tar.gz` - Standard UAC output
- `.zip` - Compressed archives

### Upload Process

1. From the **Dashboard**, select an investigation from the dropdown
2. The upload zone appears below
3. **Drag and drop** your UAC archive, or click to browse
4. Wait for the upload to complete

### Parsing Progress

After upload, parsing begins automatically:

1. **Extracting**: Archive is extracted to a temporary location
2. **Processing**: Files are categorized and analyzed
3. **Indexing**: Data is indexed into the vector database
4. **Complete**: Investigation is ready for analysis

Progress is shown in real-time with percentage and status.

### Viewing Sessions

Each upload creates a "session" within the investigation:
- Sessions are listed on the investigation detail page
- Each session shows the original filename and upload date
- Click a session to use it in AI Analysis

---

## AI Analysis

The AI Analysis page is where you interact with your forensic data using natural language.

### Selecting Context

1. Navigate to **AI Analysis** in the sidebar
2. Use the **Investigation** dropdown to select your case
3. Use the **Session** dropdown to select which upload to analyze

### Chat Interface

The chat interface has three main areas:

#### Left Panel - Context Preview
Shows what data the AI will use to answer your question:
- Relevant document chunks
- Source files
- Confidence scores

#### Center - Chat Area
- **Message history**: Your conversation with the AI
- **Input area**: Type your questions here
- **Actions dropdown**: Quick analysis actions

#### Right Panel - Query History
- Previous queries in this session
- Click to re-run or view past answers

### Asking Questions

Simply type your question and press **Enter** or click **Send**:

**Example questions:**
- "What suspicious processes were running?"
- "Show me all SSH connections"
- "Are there any indicators of persistence?"
- "What users logged in during the incident timeframe?"
- "Explain the cron jobs on this system"

### Agent Mode vs Fast Mode

Toggle between modes in the settings:

**Agent Mode** (recommended for complex analysis):
- Multi-step reasoning
- Shows "thinking" process
- Better for investigative questions
- Slower but more thorough

**Fast Mode**:
- Single-pass response
- Good for simple lookups
- Faster response times

### Actions Dropdown

Quick-access analysis actions:

#### Generate Summary
Creates an executive summary including:
- System overview
- Key findings
- Indicators of compromise
- Recommended actions

#### Detect Anomalies
AI-powered anomaly detection:
- Suspicious processes
- Unusual network activity
- File system anomalies
- Authentication irregularities
- Each with a severity score

#### Extract IOCs
Extracts indicators of compromise:
- IP addresses
- Domain names
- File hashes (MD5, SHA256)
- File paths
- Registry keys

### Suggested Questions

The AI generates contextually relevant questions based on your data. Click any suggestion to ask it automatically.

---

## Timeline Analysis

The Timeline page visualizes events chronologically.

### Viewing the Timeline

1. Navigate to **Timeline** in the sidebar
2. Select an investigation and session
3. Events load in chronological order

### Filtering Events

Use the filter panel to narrow down events:

**Category Filters:**
- Process events
- Network events
- File system events
- Authentication events
- System events

**Severity:**
- All
- High only
- Medium and above
- Custom threshold

**Date Range:**
- Quick presets (Last hour, Last 24h, etc.)
- Custom date/time range

### Event Details

Click any event to see:
- Full timestamp
- Event type and category
- Source file
- Detailed description
- Raw data

### Ask AI About Events

See something suspicious? Click **Ask AI** on any event to:
- Get context about the event
- Understand what happened before/after
- Check if it's malicious
- Get investigation recommendations

---

## Log Search

The Search page provides full-text search across all parsed artifacts.

### Basic Search

1. Navigate to **Search** in the sidebar
2. Enter your search term
3. Press **Enter** or click **Search**

### Advanced Search

Use filters to refine results:

**File Types:**
- Log files
- Configuration files
- Process data
- Network data

**Categories:**
- live_response
- bodyfile
- logs
- etc.

### Search Operators

- **Exact phrase**: `"failed password"`
- **OR search**: `ssh OR rdp`
- **Exclude**: `login -success`

### Results

Results show:
- File path
- Matching line content
- Context (lines before/after)
- Timestamp if available

Click a result to see more context or **Ask AI** for analysis.

---

## Exporting Data

Export your analysis results in various formats.

### Export Options

Navigate to **Export** or use the export button in relevant pages:

#### JSONL (Timesketch)
```json
{"message":"User login","datetime":"2024-01-15T10:30:00","timestamp_desc":"Login event"}
```
- Compatible with Timesketch
- One event per line
- Includes all metadata

#### JSON
- Structured format
- Good for programmatic processing
- Includes full event details

#### Markdown
- Human-readable reports
- Great for documentation
- Formatted with headers and tables

#### CSV
- Spreadsheet-compatible
- Easy filtering in Excel
- Timeline export format

### Exporting AI Analysis

From the AI Analysis page:
1. Complete your analysis session
2. Click **Export** in the chat area
3. Choose format (MD, JSON, etc.)
4. Download the file

---

## Tips & Best Practices

### Effective Questioning

**Be specific:**
- ❌ "What happened?"
- ✅ "What network connections were made to external IPs after 10:00 AM?"

**Provide context:**
- ❌ "Is this malicious?"
- ✅ "Is there evidence of lateral movement from the compromised user account 'admin'?"

**Ask follow-ups:**
- Build on previous answers
- The AI maintains conversation context

### Organizing Investigations

- Use clear, descriptive names
- Include case numbers for tracking
- Create separate investigations for unrelated cases
- Archive completed investigations

### Performance Tips

1. **Start with summaries**: Run "Generate Summary" first to understand the data
2. **Use Fast Mode for lookups**: Quick questions don't need Agent Mode
3. **Filter timelines**: Don't load all events at once for large datasets
4. **Export regularly**: Save your analysis as you go

### Troubleshooting

**"No context found"**
- Ensure the session is properly parsed
- Try a more specific question
- Check if the data exists in the archive

**"AI not responding"**
- Verify Ollama is running (`ollama serve`)
- Check the model is loaded (`ollama list`)
- Check backend logs for errors

**Slow responses**
- Large archives take longer
- Agent Mode is slower than Fast Mode
- Consider using a smaller LLM model

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift + Enter` | New line in message |
| `Ctrl + /` | Toggle sidebar |
| `Esc` | Close modals |

---

## Getting Help

- Check the [Architecture Docs](architecture.md) for technical details
- Review the [Design System](design-system.md) for UI guidelines
- File issues on GitHub for bugs or feature requests

---

Happy investigating! 🔍
